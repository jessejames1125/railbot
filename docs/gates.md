# Scopes and gates

Every claim here has a test in `test/rail-scope.test.js`, `test/templates.test.js` or
`test/sdlc.test.js`.

## Scope: what the bot may do, decided by the person running it

The bot's code declares the most it can do:

```js
scope: {
  reads: ['tickets'],                       // read tools it may touch; others throw
  actions: {
    tag:    { risk: 'low',    undo: 'remove the tag' },
    reply:  { risk: 'medium', undo: 'retract: send a correction' },
    refund: { risk: 'high',   about: 'refund' },
  },
  writes: ['notes/**'],                     // paths an item may write
},
```

The person narrows it in `scope.json` next to `bot.js`:

```json
{ "actions": { "tag": "low", "reply": "high" }, "limits": { "perDay": 5 } }
```

- An action type that is not in both is refused in code before any AI reads it.
- `scope.json` can drop actions, raise or lower risk, and lower limits. It can never add
  an action the bot cannot do, raise a limit, or widen reads and writes.
- A write outside the list, a `..` in a path, or an absolute path is refused.

## Risk: where the gate sits

Gate placement follows the blast radius: how much damage, and how undoable.

| Risk | Who says yes | Rule |
|---|---|---|
| low | the deterministic checks | must declare how it is undone |
| medium | a second AI, the checker, after the checks | must declare how it is undone |
| high | a person, after the checks and the checker | |

"An automatic action must be undoable, or it must not be automatic": a low or medium
action with no `undo` makes `defineBot` refuse the bot. Lowering a risk in `scope.json`
for an action with no undo is ignored with a warning.

Anything the checks flag (outside text that looks like an attack, a check's hold, the
checker saying it saw an attack) goes to a person whatever its risk.

## Locked subjects

Some subjects always reach a person: `employment` (hiring, pay, discipline, someone's
job), `refund`, `account`, `legal-safety`, `public-post`. Mark an action with
`about: '<subject>'`. The bot cannot declare it below high, `scope.json` cannot lower it
(the attempt is kept in the log and printed as a `LOCKED` warning), and an item can add
a lock to itself but never remove one. An item's subject is matched however it is
spelled (`Refund`, `refunds`); one railbot does not know goes to a person. A lock follows the
action type or the item's own `about`: a refund asked for inside an ordinary reply is locked
only if your bot tags it, so tag by what the message asks for. Changing the list means
editing `src/scope.js`.

## Deterministic checks

`checks: [...]` is a list of plain functions. Each returns nothing, `{ hold }` to ask a
person, or `{ block }` to stop the item. A check may be async. A check that throws, or
answers anything else (`false`, `{}`), blocks. Ready-made ones in
`railbot`: `notOptedOut`, `atMost`, `protectedPaths`, `smallDiff`, `mustBeTrue`,
`claimsListed`.

## The checker is never the author

A bot that proposes AI-written work names its author (`author: 'claude:sonnet'`). If the
judge is the same program and model, the run is refused.

## Fix loops have a cap

`fixLoop({ attempt, check, maxRetries })` lets an author fix what a checker found, at most
`maxRetries` times (0 to 10), then stops and hands the work to a person.

## Failure is expected: undo and the nightly check

`railbot nightly` calls the bot's `verify(item)` on each action that ran. A broken one
that ran without a person is undone with the bot's `undo(item)`. A broken one a person
approved, or one whose undo fails, writes a `STOP` file and halts the bot until someone
looks. Each action is checked once.

## Approval load

`railbot stats` counts where every proposal went: ran on the checks alone, ran on the
checker, asked a person, refused, blocked, rejected. Too many asks and people stop
reading them; too few and nothing gets checked. The number to watch is "asked a person,
per 100".

## Changing the defaults

- Make one action stricter or looser: set its risk in `scope.json`.
- Stop an action entirely: leave it out of `scope.json`'s `actions`, or set it to `false`.
- Tighten limits: `limits` in `scope.json`.
- Add a check: push a function onto `checks` in `bot.js`.
- The experiment switch `runBot(bot, { gates })` turns whole layers off for measurement
  (the simulation uses it). It has no command-line flag and every run that uses it logs a
  warning.
