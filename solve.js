// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// run(input) returns exactly csv-reader 1.0.0's answer for {text, header}:
// {columns, rows, errors}. Written from the published spec, not from the
// reference's code: a hand-tuned single-pass parser.
//
// Semantics (the spec):
// - U+FEFF at the very start is dropped.
// - A record ends at LF or CRLF; a line left with no characters is no record.
// - Outside quotes a CR not followed by LF is dropped (error stray_cr).
// - A field opening with a quote runs to the next quote that is not doubled;
//   "" inside it is one quote; each CRLF or lone CR inside it reads as LF.
//   What follows its closing quote, up to the next comma or line break, is
//   appended as it stands (quote_junk, when the field ends).
// - A quote that never closes is a literal character, and the text after it
//   is read again as unquoted (unterminated_quote).
// - A quote inside an unquoted field is a literal character.
// - Fields stay strings, never trimmed or converted.
// - columns is the first record when header is true, else null; rows holds
//   the records after it, each padded with "" (short_row, with fields: its
//   field count) or cut (long_row, with extra: the cut fields) to the first
//   record's width.
// - Each error is {code, line, row}, in the order met; line is the 1-based
//   line its record starts on, counting every LF, CRLF and lone CR inside
//   quotes; row is its record's index in rows, null for the header.
//
// Speed: the common case -- a record whose line holds no CR and no quote at
// a field start -- is taken whole: one slice and one split(','). Everything
// else goes through an indexOf-driven slow path that jumps from one
// delimiter, quote or line break to the next instead of stepping a
// character at a time. No regex, no per-character function calls in the
// hot path, no intermediate objects per field.

const COMMA = 0;
const LINE = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and its index in rows
  // (null: the header).
  let recordLine = 1;
  let recordRow = null;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `init` up to the next comma or line
  // break; a CR not followed by LF is dropped (stray_cr). Returns the field,
  // how it ended, and how many characters were kept beyond `init`.
  function readUnquoted(init) {
    let value = init;
    let added = 0;
    while (pos < len) {
      const cComma = text.indexOf(',', pos);
      const cNl = text.indexOf('\n', pos);
      const cCr = text.indexOf('\r', pos);
      let m = -1;
      let kind = -1; // 0 comma, 1 LF, 2 CR
      if (cComma !== -1) {
        m = cComma;
        kind = 0;
      }
      if (cNl !== -1 && (m === -1 || cNl < m)) {
        m = cNl;
        kind = 1;
      }
      if (cCr !== -1 && (m === -1 || cCr < m)) {
        m = cCr;
        kind = 2;
      }
      if (m === -1) {
        if (pos < len) {
          value += text.slice(pos, len);
          added += len - pos;
          pos = len;
        }
        return { value, ended: END, added };
      }
      if (kind === 0) {
        if (m > pos) {
          value += text.slice(pos, m);
          added += m - pos;
        }
        pos = m + 1;
        return { value, ended: COMMA, added };
      }
      if (kind === 1) {
        if (m > pos) {
          value += text.slice(pos, m);
          added += m - pos;
        }
        pos = m + 1;
        line += 1;
        return { value, ended: LINE, added };
      }
      // A CR: with a following LF it ends the record; alone it is dropped.
      if (text.charCodeAt(m + 1) === 10) {
        if (m > pos) {
          value += text.slice(pos, m);
          added += m - pos;
        }
        pos = m + 2;
        line += 1;
        return { value, ended: LINE, added };
      }
      if (m > pos) {
        value += text.slice(pos, m);
        added += m - pos;
      }
      error('stray_cr');
      pos = m + 1;
    }
    return { value, ended: END, added };
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    let closed = false;
    while (pos < len) {
      const cQ = text.indexOf('"', pos);
      const cCr = text.indexOf('\r', pos);
      const cNl = text.indexOf('\n', pos);
      let m = -1;
      let kind = -1; // 0 quote, 1 LF, 2 CR
      if (cQ !== -1) {
        m = cQ;
        kind = 0;
      }
      if (cCr !== -1 && (m === -1 || cCr < m)) {
        m = cCr;
        kind = 2;
      }
      if (cNl !== -1 && (m === -1 || cNl < m)) {
        m = cNl;
        kind = 1;
      }
      if (m === -1) {
        value += text.slice(pos, len);
        pos = len;
        break;
      }
      if (kind === 0) {
        if (text.charCodeAt(m + 1) === 34) {
          // A doubled quote is one quote.
          value += text.slice(pos, m);
          value += '"';
          pos = m + 2;
          continue;
        }
        value += text.slice(pos, m);
        pos = m + 1;
        closed = true;
        break;
      }
      if (kind === 2) {
        // CRLF and a lone CR inside quotes are each one LF.
        value += text.slice(pos, m);
        value += '\n';
        line += 1;
        pos = text.charCodeAt(m + 1) === 10 ? m + 2 : m + 1;
        continue;
      }
      value += text.slice(pos, m);
      value += '\n';
      line += 1;
      pos = m + 1;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      error('unterminated_quote');
      return readUnquoted('"');
    }
    if (pos >= len) return { value, ended: END, added: 0 };
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      return { value, ended: COMMA, added: 0 };
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      return { value, ended: LINE, added: 0 };
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value, ended: LINE, added: 0 };
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    const junk = readUnquoted(value);
    if (junk.added > 0) error('quote_junk');
    return junk;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: the record is one line, and the line holds no CR and no
    // quote at a field start (a quote elsewhere in a field is literal, and
    // split(',') reads it exactly as the unquoted reader would). Then the
    // record is one slice and one split.
    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? len : nl;
    let segEnd = lineEnd;
    if (nl !== -1 && lineEnd > pos && text.charCodeAt(lineEnd - 1) === 13) {
      segEnd = lineEnd - 1; // CRLF: the CR belongs to the line break
    }
    let fast = true;
    const crAt = text.indexOf('\r', pos);
    if (crAt !== -1 && crAt < segEnd) {
      fast = false;
    } else {
      let q = text.indexOf('"', pos);
      while (q !== -1 && q < segEnd) {
        if (q === pos || text.charCodeAt(q - 1) === 44) {
          fast = false;
          break;
        }
        q = text.indexOf('"', q + 1);
      }
    }
    if (fast) {
      const fields = text.slice(pos, segEnd).split(',');
      if (width < 0) width = fields.length;
      if (header && columns === null) {
        columns = fields;
      } else {
        if (fields.length < width) {
          errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
          while (fields.length < width) fields.push('');
        } else if (fields.length > width) {
          errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
        }
        rows.push(fields);
      }
      if (nl === -1) {
        pos = len;
      } else {
        pos = nl + 1;
        line += 1;
      }
      continue;
    }

    // Slow path: the record holds a quote at a field start, a stray CR, or
    // a quoted field spanning lines.
    const fields = [];
    let field;
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
