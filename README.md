# csv-reader-speed-01 — faster drop-in for csv-reader 1.0.0

[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Tiannuryadins/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Tiannuryadins/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A faster drop-in replacement for make.fun's own [csv-reader 1.0.0](https://make.fun/bounty/csv-reader-speed-01-run-20261121), answering identically on every case — including all of its broken-row behaviour (BOM, stray CRs, quoted fields, quote junk, unterminated quotes, short/long rows) — at a fraction of the CPU time.

Entry for the make.fun bounty [Read broken CSV files faster, 21 November 2026](https://make.fun/bounty/csv-reader-speed-01-run-20261121).

## How it works

`solve.js` exports `run(input)`, returning `{columns, rows, errors}` exactly as
csv-reader 1.0.0 does. `main.ts` is the harness driver: it reads every case from
`/input/cases.json`, answers each with `run`, and writes `/output/answers.json`.

Speed comes from two paths:

- **Fast path** — most records are plain (no quotes, no stray CR), so a whole record
  is taken at once: one `indexOf('\n')`, two bounded `includes()` checks, and a
  C-implemented `split(',')`.
- **Slow path** — records holding a quote or a stray CR go through a per-field
  parser built on `indexOf`/`slice` (quoted fields) and a tight `charCodeAt`
  loop (unquoted fields), with minimal allocation: fields are slices, never
  built character by character.

## Verification

- Differential-tested against csv-reader 1.0.0: 99 hand-made edge cases plus
  10,000 fuzzed cases (random texts over `, " \r \n` and structured
  quoted-field records) — all byte-identical.
- Practice set (6 cases, ~10.2 MB of CSV): all 6 answers identical to the
  kit's reference outputs.
- CPU time on the practice set: ~3.9x faster than the csv-reader 1.0.0 baseline
  (median ~181 ms vs ~705 ms per full 6-case set, same machine).

## Layout

- `solve.js` — the fast reader (ES module, dependency-free)
- `main.ts` — the harness driver (Node 22, no install step)
- `LICENSE` — MIT
