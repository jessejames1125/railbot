# Writing a bot

```
npx railbot new my-bot
```

That gives you `bot.js`, which is yours, and `BUILDING.md`, a one-page reference. A bot is one object:

```js
import { defineBot } from 'railbot';

export default defineBot({
  name: 'welcome-replies',
  limits: { perRun: 3, perDay: 10 },
  judge: { instructions: 'Approve when the draft answers what the person asked. Hold if unsure.' },

  async propose(ctx) {
    const messages = await readMyInbox();
    return messages.map((m) => ({
      id: `reply-${m.id}`,                 // same real-world action, same id
      title: `Reply to message ${m.id}`,   // your words, for the person reviewing
      action: { type: 'email', to: m.from, body: draftFor(m) },
      facts: { customerSince: m.since },   // computed by your code; the judge trusts these
      untrusted: { message: m.text },      // anything an outsider wrote
      editable: { body: { type: 'text', maxChars: 500 } },
      outbound: { fields: ['body'], allowMentions: [], allowHosts: ['example.com'] },
    }));
  },

  async act(item, tools) {
    await sendEmail(item.action, { idempotencyKey: tools.idempotencyKey });
    return { sent: true };
  },
});
```

`propose` decides nothing and sends nothing. `act` runs only in a live run, after a real judge and a person said yes. Everything between them is railbot's.

Keep to these and the rails mean what they say:

1. Outside text goes only in `untrusted`. If it lands in `title`, `facts` or the instructions, the judge will treat it as yours.
2. Targets come from your code or an API's structured fields, never from free text.
3. Only `act` sends.
4. Tie `id` to what the action is about. If the id changes on every run, every run is a new action.
5. List the fields a judge may change in `editable`, and only those. `{ type: 'subset', of: [...] }` limits a list to allowed values.

Optional fields:

- `rulesVerdict`: your code's own opinion, used by `--judge rules`.
- `preview`: what practice mode shows instead of the raw action.
- `recheck(item, { read })`: runs right before a send. Return a reason to drop an item that went out of date while it waited.
- `summary(entry)`: one line for `railbot try` and for reviewing.

`ctx.read.github` is a GET-only GitHub client with a file cache. `tools.github` in `act` can write, and exists only in a live run. Both read `GITHUB_TOKEN` or `GH_TOKEN` when set.

Check your work:

```
npx railbot check bot.js
npm start
npx railbot run bot.js --judge claude --record judge-recordings.json
```

The last one has a real judge read your items and saves the verdicts, so anyone else can replay them with no account.

## From a description

```
npx railbot new my-bot --describe "what it should do" --build-with claude
```

This has your `claude` program rewrite `bot.js` with its restricted mode and file tools only, so it can't run commands or leave that folder, then runs `railbot check`. Or, in Claude Code, install the plugin in `packages/claude-plugin` and ask for a bot in plain English. The plugin won't run `go-live` for you: that step stays with a person at a terminal.

There is no MCP server. An MCP tool that approves actions would be a way around the approval step, and everything else is already a command an agent can run.
