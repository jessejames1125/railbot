# Security

Report a hole through GitHub's private "Report a vulnerability" button on the Security tab of this repository. Please don't open a public issue for it.

These count as vulnerabilities, even with a good reason:

- An item reaching `act()` without a person's yes, past a judge's reject without a person reopening it, or in practice mode.
- A send past a limit, or a repeated send after a crash or a rerun.
- Outside text changing an action's target, type or limits, or skipping approval.
- A log edit that `railbot audit --verify` doesn't report.
- railbot reading, storing or passing on any login for the `claude` program.

A model being talked into a wrong verdict on its own isn't a vulnerability, since the rails assume that happens. It is still useful data for `evals/injection/`, so please send it as an ordinary issue.

railbot sends nothing about you anywhere. There is no telemetry. It talks to GitHub if a bot reads GitHub, and to Anthropic if you pick a judge that does.
