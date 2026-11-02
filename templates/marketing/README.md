# {{name}}: marketing drafts template

> Written by an engineer without domain expertise. Adapt it with someone who knows
> marketing and the advertising rules where you sell before you rely on it.

What it does: turns each line of `ideas.md` into a draft in `drafts/` (low risk, runs by
itself, delete the file to undo). Once drafts exist (after a live run), the next run
offers to mark each one ready, which always waits for your yes and only copies the file
to `ready-to-post/`. Practice mode writes nothing, so it only shows the drafts.

Nothing posts anywhere. Publishing is marked `about: 'public-post'`, which railbot locks
to a person, and the template has no code that talks to a social network or a blog. You
copy the text yourself.

Claims: any sentence that sounds like a claim and is not in `claims.md` goes to you
first, and the judge is told to reject unapproved claims.

```
npm start
```
