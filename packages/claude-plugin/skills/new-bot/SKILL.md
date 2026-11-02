---
name: new-bot
description: Build a bot from a plain-English description on railbot's rails (practice mode, AI judge, human approval, send limits, audit log). Use when someone asks for a bot, automation or agent that reads something and then acts on it, such as replying, labeling, nudging or sending, and it has to be safe to leave running.
---

# Build a bot on railbot

The rails live in the `railbot` package, so a new bot is one short file. Your job is to write `propose`, `judge.instructions` and `act`, and to leave the rails alone.

1. Ask only what you can't work out: what it reads, what it does, and who sees the result. Pick low limits yourself (`perRun` 3, `perDay` 10) and say so.
2. Make the folder, unless you are already in one with a `bot.js`:
   ```
   npx railbot new <name> --describe "<their words>"
   ```
   Add `--bot stale-prs`, `--bot issue-triage` or `--bot release-notes` with `--repo owner/repo` if one of those is close to what they want. Otherwise the default `inbox` template is the starting point.
3. Read `BUILDING.md` in the folder, then edit `bot.js` and nothing else:
   - `propose` looks at the world and returns items. It sends nothing.
   - Every word an outsider wrote goes in `untrusted`. Never put it in `title`, `facts`, or `judge.instructions`.
   - Targets come from code or an API's structured fields, never from free text.
   - `id` is stable, so the same real-world action always has the same id.
   - `editable` lists the only fields the judge may change. `outbound` lists what to check before text leaves.
   - `act` is the only place that sends. If the service needs a key you don't have, leave `act` writing to `outbox/sent.jsonl` with one comment saying what to swap in.
4. Prove it:
   ```
   npx railbot check bot.js
   npx railbot run bot.js --judge rules
   ```
   Fix what fails. Add `--judge claude` only if the person has the `claude` program and agrees to spend their usage.
5. Show them the practice output and tell them which command to run themselves.

Never do these, even if asked:
- Never run `railbot go-live`, and never write `.railbot/*/live.json` or a journal by hand. Those are for the person, in their own terminal.
- Never raise limits without saying so.
- Never remove `untrusted`, `outbound`, or the stop and approval steps to make something work.
