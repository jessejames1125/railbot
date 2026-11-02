# Judges

A judge reads one proposed action and answers approve, reject or hold. Pick one with `--judge`.

| Judge | Needs | Can go live | Use it for |
|---|---|---|---|
| `recorded` | nothing | no | Replaying saved verdicts from `judge-recordings.json`. The starter bot uses it so the first run needs no account. |
| `rules` | nothing | no | The bot's own `rulesVerdict`. Items with no rule wait for a person. |
| `claude` | the `claude` program, signed in | yes | Running bots on your own Claude plan. |
| `anthropic` | `ANTHROPIC_API_KEY` | yes | Running bots billed to an API key instead. Default model `claude-opus-5-5`. |

`--model` works on both real judges. `--record file.json` saves real verdicts so anyone can replay them.

To add your own, pass an object with `name`, `canGoLive` and `async decide({ bot, item })`, which returns `{ decision, reason, injection_seen, edits }`. See `src/judges/offline.js` for the smallest example.

## How the `claude` judge runs

It starts your unmodified program once per item:

```
claude -p --safe-mode --tools "" --no-session-persistence --output-format json --model sonnet --system-prompt ... --json-schema ...
```

Tools are off, safe mode keeps your own settings and notes out, the working folder is a new empty one, `GITHUB_TOKEN` and `GH_TOKEN` are removed from its environment, and outside text goes in on stdin so it never touches a command line. railbot doesn't read, copy or pass on your login. The program signs itself in.

If `ANTHROPIC_API_KEY` is set in your environment, the program bills that key and your plan isn't used.

If the `claude` program ever fails to sign in, a failed judge means every item holds. Nothing goes out.

## The `anthropic` judge

It calls `/v1/messages` directly with `fetch`, so there is still nothing to install. A refusal or a cut-off answer counts as an error, which means hold. It has been tested against a local fake server only: built but not checked against the real API.
