# {{name}}: ticket to merge, with gates

An AI writes the change for each ticket, others check it, and it merges only when every
gate passes and the change is small. Everything else waits for a person.

```
ticket in tickets/
  -> author (your claude program, sonnet) edits a branch bot/<ticket>; it never runs commands
  -> the bot runs your tests and, if set, coverage
  -> outside reviewer reads the diff (a second claude model, or CodeRabbit's CLI)
  -> author fixes blocking findings and failing tests, at most maxRetries times
  -> second AI (the judge, a different model from the author) checks the final diff
  -> deterministic gates: tests pass, coverage did not drop, diff under maxDiff lines,
     no protected path, no removed assertion, nothing left open from the reviewer
  -> all clear: merge. Anything flagged: a person decides.
nightly: `railbot nightly` runs your slow suite on each merge and on the commit before
it; a merge that broke it is reverted with git revert, and anything it cannot revert
stops the bot with a STOP file.
```

Settings are in `sdlc.json`: `repo` (a path to a local clone), `base`, `test`,
`nightly`, `coverage` (a command whose output has an "all files | NN" line, such as
`node --test --experimental-test-coverage`), `author`, `reviewer` (`local` or
`coderabbit`), `reviewerModel`, `maxRetries`, `maxDiff`.

Practice mode still creates `bot/*` branches in the repo (the work has to happen
somewhere to be checked); it never merges. `railbot go-live` turns merging on.

The CodeRabbit adapter is built from CodeRabbit's public CLI docs and has **not been run
against the real service**. It needs their CLI installed and logged in, and their plan
limits and terms apply.
