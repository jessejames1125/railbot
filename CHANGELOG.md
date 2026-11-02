# Changelog

## 0.1.0, not released yet

First version.

- Rails: practice by default, per-run and per-day limits, terminal approval queue, crash-safe state, hash-chained audit log, stop file, outside text handled as data.
- Judges: recorded, rules, your own `claude` program, your own Anthropic API key.
- Gates: a scope per bot that the person running it can narrow, risk tiers (code checks, a second AI, a person), locked subjects that always reach a person, deterministic checks, a capped fix loop, the rule that the checker is never the author, undo plus a nightly check, and approval counts.
- Bots: stale pull requests, issue triage, release notes.
- Starting templates: support inbox, HR, sales, marketing, product, and a ticket-to-merge SDLC flow with a local AI reviewer and a CodeRabbit adapter (not run against the real service).
- A simulated company with planted faults and five ways to gate its work, with a replay that needs no account.
- Commands: `create-railbot`, `railbot try`, `sim`, `new`, `run`, `review`, `queue`, `stats`, `audit`, `check`, `doctor`, `go-live`, `practice`, `stop`, `resume`, `resolve`, `reopen`, `nightly`.
- A Claude Code plugin that builds a bot from a plain-English description.
