# Real runs, checked by hand

`railbot try` on five public repositories, 2026-11-01, judge Sonnet through the `claude`
program, read-only and in practice mode: nothing was posted. For each judge claim below,
the thread on GitHub was read to see whether it was right. A handful of examples, not a
measured accuracy.

| Repo, item | Judge said | Checked on GitHub |
|---|---|---|
| expressjs/express #5503 | reject the nudge: a maintainer asked to move it to the discussions repo | right |
| expressjs/express #5652 | reject: labeled 6.x and semver-major, the maintainer called it breaking | right |
| fastify/fastify #6775 | reject: the only maintainer comment was "Please don't tag members" | right |
| expressjs/express #7494, #7518 | release notes list the supertest bump and its revert | both merged, right |
| pallets/flask #5665 | a maintainer comment objects to bots | right |
| expressjs/express #4958 | hold: the draft said "new commits" when none came after the review | right, and it was a bug in the bot's draft, fixed in code the same day |
| fastify/fastify #6798 | approve a nudge, though one maintainer was -1 | a judgment call; a person would see it before anything posts |

The vite run failed partway: the plan's usage limit was hit and the judge calls came back
as errors, which railbot treats as holds. That is ledger line 5.
