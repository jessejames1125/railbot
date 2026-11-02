# The rails

Each rail is code outside the model. A judge that has been talked into anything still can't get past them. Every claim below has a test named after it in `test/rail-*.test.js`; run them with `npm test`.

## Practice by default

`railbot run` never calls `act()`. A live run needs both `--live` and an earlier `railbot go-live`, which asks you to type `live <bot-name>` in a real terminal and writes `.railbot/<bot>/live.json`. The `recorded` and `rules` judges can never go live, and a yes given in practice doesn't carry over: practice and live keep separate state.

## Send limits

`limits: { perRun, perDay }` are required whole numbers. The per-day count is a rolling 24 hours, read from the log. A send counts when it starts, so a send that failed or crashed still counts, because it may have gone out. Moving the clock back doesn't free up room, because time only moves forward inside the log. The limits are frozen when the run starts and recorded at go-live; raising one means going live again.

## Approval

A bot with no `scope` sends every item to a person. A bot with a scope decides per action type: low risk runs on the checks alone, medium on a second AI, high on a person; see [gates.md](gates.md). With no terminal, items for a person wait for `railbot review`. The judge's answer decides what reaches that person:

- reject closes the item. Overriding it takes `railbot reopen` at a real terminal, followed by a fresh yes.
- hold and approve both go to the person, with the judge's reason on the card. A hold is the judge asking you, so your yes counts.
- A judge that crashes, times out or talks nonsense counts as a hold, says so on the card, and gets another try on the next run.

If the draft changes after the yes, the yes is void. A person's no is final, and so is an outbound block: `reopen` refuses both.

The terminal check is a check for a real terminal. It stops scripts and cron jobs by accident or design. Code running as you could still fake one, or edit the files directly, so anything you run as yourself is inside the trust boundary.

For bots with no scope, auto-approve exists for your own low-stakes bots, and it is ignored for any item that is flagged or that declares it touches people.

## Crash safety

The log is the state. Before an effect, railbot writes and syncs `act-start`; after it, the outcome. A crash in between leaves the item "in doubt", and it is never retried by itself, since it may have happened. You look, then run `railbot resolve <id>` or `railbot reopen <id>`. Items have stable ids, so a repeated run skips what is finished. A lock stops two runs at once, and a lock left by a dead process is cleared.

This gives at-most-once on railbot's side. If your service takes an idempotency key, pass `tools.idempotencyKey` to it and the risky window shrinks further.

## Audit log

`.railbot/<bot>/journal.jsonl` holds one JSON event a line, each with the hash of the one before. `railbot audit --verify` reports any edited, removed or garbled line. A line torn by a crash is recorded as such, and the log keeps working. The chain catches accidents and casual edits. It can't tell if the newest lines were cut off, and someone who can rewrite the whole file can rebuild the chain too, so ship the log elsewhere if your threat model includes that.

## Stop file

`railbot stop "why"` writes a `STOP` file in the bot's folder; `--all` writes `~/.railbot/STOP` and halts every bot on the machine. It is checked before each step, so it takes effect during a judge call, during approval and between two sends. Exit code 3. `railbot resume` removes it, and work continues without repeats.

## Outside text is data

Anything an outsider wrote goes in `item.untrusted`. Before a judge reads it, railbot strips terminal codes and invisible characters, normalizes it, JSON-encodes it, and fences it in a tag with a random name. It only ever appears in the user turn. An item's title goes in the same fence, because the built-in bots use outsiders' titles there. A draft can quote outside text as well, such as release notes listing commit titles, and the judge is told so.

That lowers the odds of a successful attack. It can't bring them to zero, so the design doesn't rely on it:

- A verdict can hold only `decision`, `reason`, `injection_seen` and `edits`. Everything else is thrown away.
- `edits` applies only to fields the bot marked `editable`, and a list field can only hold values from its allowed list. The target, the action type and the limits are out of reach.
- A tripwire of plain patterns runs on the raw text. It can add a flag for the person and can never approve anything.
- The final text goes through an outbound check: unknown links, bare domains and mentions are flagged for the person; anything that looks like a secret is blocked. The domain check is a list of common endings, so a person reading the draft is still the last check.
- Everything printed to the terminal has control characters removed, so an issue title can't draw a fake prompt.

## What the rails don't do

They don't check that your `act()` does what your item says, they don't sandbox your bot's code, and they don't stop a person from approving something bad. See Limits in the README.
