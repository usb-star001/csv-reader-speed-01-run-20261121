# csv-reader-speed-01-run-20261121

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/usb-star001/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/usb-star001/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for csv-reader 1.0.0 (make.fun's own CSV reader) for the
bounty "Read broken CSV files faster, 21 November 2026". `solve.js` is a
dependency-free ES module whose `run(input)` returns exactly csv-reader
1.0.0's answer for `{text, header}`: `{columns, rows, errors}`. `main.ts`
is the program the harness runs: it reads every case from
`/input/cases.json`, answers each with `run`, and writes
`/output/answers.json`.

## How it parses

The parser follows the published spec exactly: BOM dropped, records end at
LF or CRLF, empty lines are no records, lone CRs outside quotes are dropped
(`stray_cr`), quoted fields run to the next undoubled quote with `""` as one
quote and CR/CRLF inside read as LF, junk after a closing quote is appended
as it stands (`quote_junk`), a never-closing quote is a literal character
with the rest re-read as unquoted (`unterminated_quote`), fields stay
strings, rows are padded (`short_row`) or cut (`long_row`) to the first
record's width, and every error carries the line its record starts on and
its index in rows.

For speed it is a single pass built on `indexOf` scans instead of
character-at-a-time stepping:

- **Fast path.** A record whose line holds no CR and no quote at a field
  start is one slice and one `split(',')`. A quote elsewhere in a field is
  literal, so the split reads it exactly as the unquoted reader would.
- **Slow path.** Records with a field-opening quote, a stray CR, or a quoted
  field spanning lines go through an `indexOf`-driven reader that jumps from
  one delimiter, quote, or line break to the next. No regex, no
  per-character function calls in the hot path.

## Benchmark (practice set, 6 cases, 10.2 MB of CSV)

Measured on this machine (a shared-CPU VM, Node 24; the harness runs Node 22
at 1 CPU under gVisor, so these are not the harness's numbers):

- Full entry (`node main.ts`, 1 warm-up + 9 timed runs, trimmed mean
  dropping the 2 fastest and 2 slowest): **~780–803 ms wall** per set,
  stable across three batches.
- Parse only (`run` over the set, 10-run average): **~170–270 ms** per set
  (noisy on shared CPU); `JSON.stringify` of the answers adds ~130 ms, and
  the rest is Node start-up and file I/O, costs the house baseline pays too.
- Correctness: **6/6 practice cases byte-identical** to the kit's
  `practice/reference/expected.json`, plus 43/43 hand-computed edge cases
  (BOM, CRLF, lone CR, unterminated quotes, quote junk, short/long rows,
  empty lines, header true/false).

For scale, the kit's RULES.txt publishes the house baseline at 1.38 s of CPU
on average on 10.2–11.8 MB sets under gVisor at 1 CPU. That is a different
machine from this one, so it is not a same-machine A/B comparison; the
parse-time gap (roughly 0.2 s here against roughly 1.1 s of parse inside the
baseline's 1.38 s) is the reason this entry is expected to beat the baseline
in the final heat, not a measured speedup on the grading hardware.

## Files

- `solve.js` — the parser (the entry).
- `main.ts` — the harness driver.
- `LICENSE` — MIT.
