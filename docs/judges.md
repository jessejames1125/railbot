# Judges

A judge reads one proposed action and answers approve, reject or hold. Pick one with `--judge`.

| Judge | Needs | Can go live | Use it for |
|---|---|---|---|
| `recorded` | nothing | no | Replaying saved verdicts from `judge-recordings.json`. The starter bot uses it so the first run needs no account. |
| `rules` | nothing | no | The bot's own `rulesVerdict`. Items with no rule wait for a person. |
| `claude` | the `claude` program, signed in | in your own terminal only | Trying bots on your own plan while you watch. |
| `anthropic` | `ANTHROPIC_API_KEY` | yes | Unattended runs. Billed to your key. Default model `claude-opus-5-5`. |

`--model` works on both real judges. `--record file.json` saves real verdicts so anyone can replay them.

To add your own, pass an object with `name`, `canGoLive` and `async decide({ bot, item })`, which returns `{ decision, reason, injection_seen, edits }`. See `src/judges/offline.js` for the smallest example.

## How the `claude` judge runs

It starts your unmodified program once per item:

```
claude -p --safe-mode --tools "" --no-session-persistence --output-format json --model sonnet --system-prompt ... --json-schema ...
```

Tools are off, safe mode keeps your own settings and notes out, the working folder is a new empty one, `GITHUB_TOKEN` and `GH_TOKEN` are removed from its environment, and outside text goes in on stdin so it never touches a command line. railbot doesn't read, copy or pass on your login. The program signs itself in.

If `ANTHROPIC_API_KEY` is set in your environment, the program bills that key and your plan isn't used.

## What Anthropic's terms say, as of 2026-11-02

This is my reading, and it isn't legal advice. Check the pages yourself.

The [Claude Code legal page](https://code.claude.com/docs/en/legal-and-compliance) says:

- "OAuth authentication is intended exclusively for purchasers of Claude Free, Pro, Max, Ultra, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications."
- "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, Max, or Ultra plan credentials on behalf of their users." and "developers may not collect, store, or intermediate Claude.ai credentials or session tokens".
- It doesn't "prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription".
- "Advertised usage limits for Pro, Max, and Ultra plans assume ordinary, individual usage of Claude Code and the Agent SDK."
- Developers building products "should use API key authentication".

The [consumer terms](https://www.anthropic.com/legal/consumer-terms), section 3, forbid this "except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it": "to access the Services through automated or non-human means, whether through a bot, script, or otherwise." The [headless docs](https://code.claude.com/docs/en/headless) do describe the CLI as "available as a CLI for scripts and CI/CD".

No page I found says whether unattended `claude -p` on a subscription is allowed. So railbot takes the careful reading:

- railbot never touches a login. You run your own copy of the program, on your own machine, for yourself.
- A live run with `--judge claude` is refused unless a person is at a terminal.
- For anything unattended or offered to other people, use `--judge anthropic` with your own key.

The same docs say `--bare` "doesn't use your subscription login" and "will become the default for `-p` in a future release". If that happens the `claude` judge will start failing to sign in, and a failed judge means every item holds. Nothing goes out.

## The `anthropic` judge

It calls `/v1/messages` directly with `fetch`, so there is still nothing to install. A refusal or a cut-off answer counts as an error, which means hold. It has been tested against a local fake server only: built but not checked against the real API.
