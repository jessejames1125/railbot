# {{name}}: HR helper template

> Written by an engineer without domain expertise. Adapt it with someone who knows
> employment law and your own policies before you rely on it. This is not legal advice.

What it does:

- Lists the applications in `applications/` in the order they came in, with no score and
  no ranking, in `hr-notes/applications.md`. Low risk: it runs by itself and can be deleted.
- Drafts the message a person already decided to send (from `decisions.json`) into
  `drafts/`. It never sends anything.

What it will not do, in code:

- Rank, score, screen or turn down a person. There is no action for it, so a proposal
  like that is refused as outside the bot's scope.
- Let anything that reaches a candidate or employee skip a person. The message action is
  marked `about: 'employment'`, which railbot locks to a person. Setting it lower in
  `scope.json` is ignored and printed as a `LOCKED` warning.
- Pass a draft that reads like a judgment of someone ("ranked 9th", "not a good fit")
  without showing it to you first.

```
npm start
```

## Why the lock

Laws in several places cover software that scores, ranks or screens people for jobs.
Check the current text for where you hire; these move.

- New York City Local Law 144 of 2021 (Admin. Code 20-870 to 20-874) covers an
  "automated employment decision tool": one that "issues simplified output, including a
  score, classification, or recommendation" used to "substantially assist or replace
  discretionary decision making". It needs a bias audit within a year of use and notice
  to candidates. Enforced from July 5, 2023.
  [Law](https://legistar.council.nyc.gov/LegislationDetail.aspx?ID=4344524&GUID=B051915D-A9AC-451E-81F8-6596032FA3F9),
  [city page](https://www.nyc.gov/site/dca/about/automated-employment-decision-tools.page).
- Illinois Public Act 103-0804 (HB 3773), in force January 1, 2026, makes it a civil
  rights violation to use AI "that has the effect of subjecting employees to
  discrimination", and requires telling employees when AI is used, across hiring,
  discipline and discharge. [Act](https://www.ilga.gov/documents/legislation/publicacts/103/103-0804.htm).
  Illinois also has the Artificial Intelligence Video Interview Act (820 ILCS 42).
  [Act](https://www.ilga.gov/Legislation/ILCS/Articles?ActID=4015&ChapterID=62).
- Colorado's SB 24-205 on high-risk AI in consequential decisions, employment included,
  was replaced in 2026 by SB 26-189, signed May 14, 2026, with notice, explanation and
  human-review duties. We have not read the enrolled text and its start dates are unclear
  to us; check it. [Bill page](https://leg.colorado.gov/bills/sb26-189).

A tool that only drafts and organizes is the cautious side of these lines. Changing this
template to score or screen people moves you onto the other side.
