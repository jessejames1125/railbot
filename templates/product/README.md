# {{name}}: product notes template

> Written by an engineer without product-management expertise. Adapt it with someone
> who runs product before you rely on it.

What it does:

- Collects every file in `feedback/` into `notes/feedback.md`, quoted as written. Low
  risk: it runs by itself, and git puts the file back if it is wrong. Feedback is
  outside text, so if a customer writes instructions into it, the tripwire sends the
  update to you instead.
- Drafts a changelog line for each entry in `shipped.md` into `drafts/changelog.md`.
  Public words, so each one waits for your yes, and the bot never publishes it.

```
npm start
```
