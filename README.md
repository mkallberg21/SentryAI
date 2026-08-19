# SentryAI

IEP documentation that holds up — to a state monitoring review, to a due process hearing, and to a parent reading it in their own language.

AI drafts. Educators decide. The audit trail proves it.

---

## What this is

Special education teams spend an enormous share of their week on documentation, and districts still draw findings — not usually because anyone did the wrong thing for a child, but because a deadline was counted wrong, a form was missing an element, or the reason for a decision was never written down.

SentryAI is a compliance engine and system of record for that work. It watches every IDEA timeline, checks every document against the regulation it has to satisfy, and keeps a tamper-evident record of who did what.

**The design goal is that a district's compliance posture is knowable on any given Tuesday**, rather than discovered during a monitoring visit.

## Status

Early. The foundation is built and tested; the application layer is not.

| Area | State |
| --- | --- |
| Domain model (IEP, evaluation, meeting, notice, service, progress) | Built |
| Compliance rules engine + state packs (federal, CA, TX) | Built, 47 tests |
| Governance (hash-chained audit, field encryption, dual approval) | Built, 23 tests |
| Persistence, API, web app | Not started |
| AI drafting layer | Not started — governance contract defined first, deliberately |
| SIS/roster integration (Clever, ClassLink, OneRoster, Ed-Fi) | Not started |

## Repository layout

```
packages/
  domain/       Vocabulary: students, IEPs, evaluations, meetings, notices, services
  compliance/   Day counting, rules engine, per-state policy packs
  governance/   Audit chain, field-level envelope encryption, dual approval
docs/
  architecture.md     How the pieces fit and why
  ai-governance.md    What the model is and is not allowed to do
  security.md         Threat model and data-protection posture
  pricing.md          Pricing model and the reasoning behind it
```

## Three decisions worth knowing about

**Day counting is a first-class module, not arithmetic at the call site.**
Federal timelines run in calendar days, Texas evaluation timelines in school days, discipline timelines in school days the student was actually enrolled. A 45-school-day clock started on May 1 does not end in June — it ends the following September. Getting this wrong by one day is the difference between a clean visit and a finding, so it lives in [`calendar.ts`](packages/compliance/src/calendar.ts) with tests that assert the traps.

**State rules are data, not code.**
Every timeline is expressed as `{ days, basis }` in a `CompliancePolicy`, and rules read the policy rather than hardcoding a number. Adding a state means adding a pack. The constraint is deliberate: the moment state logic leaks into the rules, the fiftieth state costs as much as the first.

**The audit log is immutable; the record is not.**
FERPA gives parents the right to request amendment of education records, and state privacy laws require deletion at contract termination — so records must be correctable and erasable. What cannot be changed is the *log*. Every read, write, correction, and deletion is hash-chained, so a change can be made but never made to look like it never happened. See [`audit.ts`](packages/governance/src/audit.ts).

## The AI posture, up front

No model output reaches a signed IEP without a named human accepting it. This is enforced as a compliance rule with the same weight as a missed deadline (`governance.ai-human-acceptance`), because in a hearing it would be worse.

Two things SentryAI deliberately does **not** do:

- **Predict student outcomes to inform placement or services.** A model that forecasts outcomes for a disabled child, surfaced before the IEP meeting, edges into *predetermination* — deciding IEP content ahead of the team, which is a procedural violation districts lose on. It also inherits the racial and disability bias in historical placement data. Selling a compliance product that manufactures a novel compliance risk is not a trade worth making.
- **Send machine-translated legal notices unreviewed.** IDEA requires notice in the parent's native language; a mistranslated Prior Written Notice is itself a violation. Machine translation for comprehension, reviewed translation for anything legally operative.

Full reasoning in [docs/ai-governance.md](docs/ai-governance.md).

## Development

```bash
npm install
```

```bash
npm test
```

```bash
npm run typecheck
```

Node 20+. No database or cloud credentials are required to run the test suite — the rules engine is pure functions over fixtures, which is also what makes an audit answerable: "why did the system say we were late on 2026-03-14" has a deterministic answer.

## A note on claims

This project does not claim to be the first AI-powered IEP platform, and does not publish a time-saved figure it has not measured. Both claims are easy to make and easy to puncture, and the buyer here is a district administrator who has heard them before. Efficacy numbers go in this README when a pilot produces them, with the methodology attached.

## License

Not yet determined.
