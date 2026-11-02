# The rails

Each rail is code outside the model. A judge that has been talked into anything still can't get past them. Every claim below has a test named after it in `test/rail-*.test.js`; run them with `npm test`.

## Practice by default

`railbot run` never calls `act()`. A live run needs both `--live` and an earlier `railbot go-live`, which asks you to type `live <bot-name>` in a real terminal and writes `.railbot/<bot>/live.json`. A script can't do it. The `recorded` and `rules` judges can never go live, and a yes given in practice doesn't carry over: practice and live keep separate state.

## Send limits

`limits: { perRun, perDay }` are required whole numbers. The per-day count is a rolling 24 hours, read from the log. A send counts when it starts, so a send that failed or crashed still counts, because it may have gone out. Moving the clock back doesn't free up room. The limits are frozen when the run starts and recorded at go-live; raising one means going live again.

## Approval

An item goes out only after a judge said approve and a person said yes in a terminal. With no terminal, items wait for `railbot review`. If the draft changes after the yes, the yes is void. A rejection by a person is final. A judge that crashes, times out or talks nonsense means hold.

Auto-approve exists for your own low-stakes bots, and it is ignored for any item that is flagged or that declares it touches people.

## Crash safety

The log is the state. Before an effect, railbot writes and syncs `act-start`; after it, the outcome. A crash in between leaves the item "in doubt", and it is never retried by itself, since it may have happened. You look, then run `railbot resolve <id>` or `railbot reopen <id>`. Items have stable ids, so a repeated run skips what is finished. A lock stops two runs at once, and a lock left by a dead process is cleared.

This gives at-most-once on railbot's side. If your service takes an idempotency key, pass `tools.idempotencyKey` to it and the risky window shrinks further.

## Audit log

`.railbot/<bot>/journal.jsonl` holds one JSON event a line, each with the hash of the one before. `railbot audit --verify` reports any edited, removed or garbled line. A line torn by a crash is recorded as such, and the log keeps working. The chain catches accidents and casual edits. Someone who can rewrite the whole file can rebuild the chain too, so ship the log elsewhere if your threat model includes that.

## Stop file

`railbot stop "why"` writes a `STOP` file in the bot's folder; `--all` writes `~/.railbot/STOP` and halts every bot on the machine. It is checked before each step, so it takes effect during a judge call, during approval and between two sends. Exit code 3. `railbot resume` removes it, and work continues without repeats.

## Outside text is data

Anything an outsider wrote goes in `item.untrusted`. Before a judge reads it, railbot strips terminal codes and invisible characters, normalizes it, JSON-encodes it, and fences it in a tag with a random name. It only ever appears in the user turn.

That lowers the odds of a successful attack. It can't bring them to zero, so the design doesn't rely on it:

- A verdict can hold only `decision`, `reason`, `injection_seen` and `edits`. Everything else is thrown away.
- `edits` applies only to fields the bot marked `editable`, and a list field can only hold values from its allowed list. The target, the action type and the limits are out of reach.
- A tripwire of plain patterns runs on the raw text. It can add a flag for the person and can never approve anything.
- The final text goes through an outbound check: unknown links, bare domains and mentions are held; anything that looks like a secret is blocked.
- Everything printed to the terminal has control characters removed, so an issue title can't draw a fake prompt.

## What the rails don't do

They don't check that your `act()` does what your item says, they don't sandbox your bot's code, and they don't stop a person from approving something bad. See Limits in the README.
