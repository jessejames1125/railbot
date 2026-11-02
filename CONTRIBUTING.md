# Contributing

1. Run `npm test`. There is nothing to install and no build step.
2. A bug in a rail starts with a failing test in `test/rail-*.test.js` that tries to break it.
3. Keep `dependencies` empty. It is part of the promise, and a test checks it.
4. A new bot goes in `src/bots/` with a run against a real public repo in `docs/real-runs.md`.
5. A new number in the README needs a script in `evals/` that reruns it.
6. Against other people's repositories, tests and evals only ever read.
7. Keep commits small, with plain imperative messages.
