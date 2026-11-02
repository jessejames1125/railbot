# Changing this bot

`bot.js` is yours. The rails are in the `railbot` package and you don't need to touch them.

A bot is four things:

- `propose(ctx)`: code that looks at the world and returns a list of items. It decides nothing and sends nothing. It gets `ctx.params`, `ctx.read.github` (GET only) and `ctx.now`.
- `judge.instructions`: what a good item looks like, for the AI judge.
- `act(item, tools)`: does the real thing. It only ever runs in a live run, after a real judge and a person said yes.
- `limits`: `perRun` and `perDay`, whole numbers, required.

An item looks like this:

```js
{
  id: 'stable-unique-id',        // never acted on twice, so tie it to what the action is about
  title: 'One line for a person',
  action: { type: 'email', to: 'a@example.com', body: 'Hello' }, // what would happen
  facts: { daysWaiting: 4 },     // things your code computed; the judge trusts these
  untrusted: { message: '...' }, // anything an outsider wrote; the judge treats it as data
  editable: { body: { type: 'text', maxChars: 500 } }, // what the judge may change, nothing else
  outbound: { fields: ['body'], allowMentions: [], allowHosts: [] }, // checked before it leaves
  preview: 'Shown in practice mode',
}
```

Rules that keep the rails meaningful:

1. Put every piece of outside text in `untrusted`, never in `title`, `facts` or `judge.instructions`.
2. Take targets from your code or an API's structured fields, never from free text.
3. Don't send anything from `propose`. Only `act` sends.
4. If `act` takes an idempotency key, pass `tools.idempotencyKey` to the service.

Commands:

- `npm start` runs it in practice mode.
- `npx railbot check` proves the bot loads and proposes valid items.
- `npx railbot go-live` turns on live runs for this bot. You type its name to confirm.
- `npx railbot run bot.js --live --judge anthropic` is then a live run.
- `npx railbot stop "why"` halts everything. `npx railbot resume` clears it.
