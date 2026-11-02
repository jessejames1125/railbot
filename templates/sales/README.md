# {{name}}: sales follow-up template

> Written by an engineer without domain expertise. Adapt it with someone who knows sales
> and the email laws where you sell before you rely on it. This is not legal advice.

What it does: drafts one short follow-up to each lead in `leads.csv` who asked about
something, using only the sentences in `claims.md`, and writes it to `outbox/` in a live
run. It ships in practice mode and sends nothing until you run `railbot go-live`.

The gates:

- Anyone in `optout.txt` is blocked in code, whatever the judge says. Matching ignores case.
- A sentence that sounds like a claim (a number, "certified", "free" and the like) and is
  not in `claims.md` sends the email to you first.
- Emails are high risk by default, so each one waits for your yes. When you trust it,
  lower `email` to `medium` in `scope.json` and a second AI checks each one instead.
- 5 a run and 20 a day. Raise them slowly.

```
npm start
```

## Email law, in one paragraph

In the US, the CAN-SPAM Act covers commercial email. The FTC's guide says: no false or
misleading headers or subject lines, include "your valid physical postal address", give a
clear way to opt out, and "honor a recipient's opt-out request within 10 business days";
each email in violation can cost "up to $53,088"
([FTC guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)).
Other countries are stricter (many need consent before the first email). The template
adds an opt-out line and the opt-out check; the postal address, the sender name, and the
law where your readers live are yours to handle.
