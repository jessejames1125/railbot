# Prereg: label eval, run 2

Committed before the run. Not blind: the thrown-away run 1 (ledger line 3) on the same six
repositories was seen by the author.

- Command: `node evals/labels/run.mjs` (Sonnet through the `claude` program), then
  `node evals/labels/run.mjs --report`.
- Same six repositories as run 1 (`evals/labels/repos.json`), 20 recent issues each that
  maintainers labeled, labels hidden.
- H1: the claude method's "first label right" share beats the most-used-label baseline by
  at least 10 points.
- H2: of the labels the claude method puts on, at least 70% are ones the maintainers used.
- If either fails, the README says so in the results table.
- 1 run. The spread of a single run is unknown and the README says that too.
