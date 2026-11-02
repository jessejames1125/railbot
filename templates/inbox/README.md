# {{name}}

A support-inbox bot built on railbot.

> Written by an engineer without support-team expertise. Adapt the replies and rules with
> someone who runs support before you rely on it.

```
npm start
```

This runs in practice mode with saved verdicts, so it needs no account. One of the five messages in `inbox/` is spam and one tries to take over the bot. Watch what happens to them, then look at the record:

```
npm run audit
```

Next steps are in `BUILDING.md`: point `propose` at your real inbox, have a real judge read it with `npx railbot run bot.js --judge claude`, and change `act` to send through your email service.
