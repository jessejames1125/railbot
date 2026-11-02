# Run ledger

Every measured run of this kit, in the order it happened, including runs that failed, were
stopped, or were thrown away. A line is never edited after the fact; a correction is a new
dated line below it. Where a line and a results file disagree, the results file wins.

Evidence levels used across the repo:

- **VERIFIED**: run against real things (real public repos, a real git repo, the real `claude`
  program) and checked by hand or by code against something outside the kit.
- **SIMULATED**: run against a made-up company and made-up work. Tells you how the gates
  behave on faults we planted, not what a real business would see.
- **UNTESTED**: built, with tests on fakes, never run against the real service.

Preregistered means the hypothesis and the pass line were committed before the run. You can
check the order with `git log --follow` on the prereg file and the results file.
Dates are the laptop's Pacific date; results files are named by the UTC date, which can be a day later.

| # | Date | Run | Prereg | Result | Level |
|---|---|---|---|---|---|
| 1 | 2026-11-01 | Injection eval, Sonnet, first start | no | Thrown away: the judge prompt changed mid-run | none |
| 2 | 2026-11-01 | Injection eval, Sonnet, second start | no | Thrown away: the prompt changed again | none |
| 3 | 2026-11-01 | Label eval, Sonnet, 6 repos | no | Thrown away after the prompt change. Its numbers (claude first label right 75 of 105, rules 39 of 90, most-used label 38 of 108) were seen by the author, so later label runs are not blind | none |
| 4 | 2026-11-01 | Live `try` runs on 5 public repos (express, fastify, flask, vite, chalk) | no | Judge claims checked by hand on GitHub; one false "new commits" draft caught and fixed in code; vite calls failed when the plan's usage limit hit | VERIFIED, small |
| 5 | 2026-11-01 | Usage limit | n/a | Plan limit hit at about 22:33 Pacific; runs in flight stopped. Failures now print as a sentence and evals stop on a limit | n/a |
| 6 | 2026-11-02 | Injection eval, Sonnet, 1 run, 222 answers (`injection/results/2026-11-02-sonnet.jsonl`) | no | Attacks won: 0 of 96 with railbot's envelope, 0 of 96 pasted. Harmless items approved 12 of 12 in both. Railbot's judge said it saw the attack on 92 of 96. No measurable difference between the arms on this model | VERIFIED |
| 7 | 2026-11-01 | Tripwire on real issues, 890 issues | no | 10 flagged, all false alarms | VERIFIED |
| 8 | 2026-11-01 | First run from a clean copy, local stand-in registry, 3 runs | no | 10.4 to 11.6 seconds on Windows, Node 24. Not from the real npm registry | VERIFIED, local |
| 9 | 2026-11-01 | Security review by a fresh agent | n/a | 9 findings, all fixed with a failing test first | n/a |
| 10 | 2026-11-02 | Label eval run 2, Sonnet, 110 issues from 6 repos (`labels/results/2026-11-02.json`, prereg `prereg/labels-2.md`) | yes, not blind | First label right: claude 74 of 104 (71%), rules 39 of 90 (43%), most-used label 38 of 108 (35%). H1 (beat the baseline by 10 points) passed. H2 (70% of applied labels right) failed: 105 of 182 (58%). The issues came from the cache of run 3, so the same issues | VERIFIED |
| 11 | 2026-11-02 | Injection eval, Haiku, 1 run, 222 answers, 2 failed calls (`injection/results/2026-11-02-haiku.jsonl`, prereg `prereg/injection-haiku.md`) | yes | Attacks won: 0 of 95 in both arms. Harmless approved: 11 of 12 with railbot's envelope, 10 of 12 pasted. H1, H2, H3 passed. As with Sonnet, the model resisted every attack in both arms, so this corpus cannot show the envelope helping | VERIFIED |
