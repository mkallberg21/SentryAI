# Architecture

## Shape

```
                    ┌──────────────────────────────┐
   SIS / roster ───▶│  ingest (Clever, ClassLink,  │
   (not built)      │  OneRoster, Ed-Fi)           │
                    └──────────────┬───────────────┘
                                   ▼
        ┌──────────────────────────────────────────────────┐
        │  @sentryai/domain                                │
        │  Students, IEPs, evaluations, meetings, notices,  │
        │  services, progress. Types and pure functions.    │
        └───────────────┬──────────────────┬───────────────┘
                        ▼                  ▼
   ┌────────────────────────────┐  ┌───────────────────────────────┐
   │  @sentryai/compliance      │  │  @sentryai/governance         │
   │  • day counting by basis   │  │  • hash-chained audit log     │
   │  • rules engine            │  │  • field envelope encryption  │
   │  • state policy packs      │  │  • dual approval + separation │
   └───────────────┬────────────┘  └───────────────┬───────────────┘
                   └──────────────┬────────────────┘
                                  ▼
                 ┌────────────────────────────────────┐
                 │  api + web + persistence           │
                 │  (not built)                       │
                 └────────────────────────────────────┘
```

Dependencies point inward. `domain` knows nothing about compliance or storage; `compliance` and `governance` know nothing about each other or about the API. Everything below the line is replaceable without touching the rules.

## Why the rules engine is pure

`Rule.evaluate(ctx)` is a pure function of `RuleContext`. No IO, no clock, no database.

Three things follow, all of which matter more here than in a typical product:

**An audit has a deterministic answer.** When a district asks why the system said they were late on a particular date, the answer is reproducible from the context as it stood — not dependent on what a query returned that afternoon.

**The whole rule set is testable against fixtures.** 47 tests cover the engine without a database. Compliance logic that is expensive to test is compliance logic that stops being tested.

**`asOf` is an input.** The engine can be run at a past date to reconstruct what the district knew and when, which is what a monitoring response actually requires.

The cost is that the caller must assemble the full context before evaluating. That is a real cost, paid deliberately.

## Day counting

`packages/compliance/src/calendar.ts` is small and carries an outsized share of the correctness risk.

Three bases:

- `calendar` — every day. Federal evaluation and IEP-meeting timelines.
- `business` — weekdays excluding holidays.
- `school` — days school is in session for students. Texas evaluation timelines, discipline timelines everywhere.

Two properties the tests assert explicitly:

- **The start date is day zero.** "60 days from receipt of consent" means the day after consent is day one. Counting the start day as day one costs a district a day on every evaluation.
- **Skipping beats extending.** For states that exclude school vacations (California Ed Code 56344), the deadline is computed by counting forward and skipping break days — not by counting 60 days and adding however many break days fell inside. The second approach drifts when the extension itself crosses a break, and comes out six days early for a consent received on November 1. This was a real bug, caught by a test comparing the two.

`addDaysOnBasis` refuses to invent a date it cannot reach: a 45-school-day count that runs past the end of the calendar throws rather than returning something plausible.

## State packs

Every varying figure lives in `CompliancePolicy` as `{ days, basis }`. Rules read the policy. A state pack is a spread over `FEDERAL_POLICY` plus overrides.

`policyForState` throws on an unknown state rather than defaulting to federal. Running a Texas district on calendar-day timelines produces confidently wrong deadlines, which is worse than an error.

State-specific obligations with no federal analogue — California's 15-day assessment plan requirement, for instance — live in the pack as named constants and, when they need enforcement, as rules the pack contributes.

## Governance

**Audit.** Append-only, SHA-256 hash-chained, each entry committing to its predecessor. `verifyChain` detects alteration, deletion, and reordering. Entries record field *names* only, never values — an audit log holding old and new values becomes a second, less-protected copy of the student record.

**Encryption.** AES-256-GCM per field, with a per-record data key wrapped by a KMS-held KEK. The AAD binds each ciphertext to `studentId | recordType | recordId | fieldName`, so a row copied between students fails authentication rather than silently decrypting into the wrong child's record. `LocalKeyProvider` refuses to construct when `NODE_ENV=production`.

**Dual approval.** Legally operative actions — finalizing an IEP, sending a PWN, determining eligibility, exiting a student, exporting data — require a second person in a permitted role. The requester cannot approve their own request; without separation of duties, dual approval is a checkbox one person clicks twice. Requests expire, because an approval granted against month-old facts is not an approval.

## Not yet built

**Persistence.** Postgres with row-level security scoped by district, and no `UPDATE`/`DELETE` grant on the audit table for the application role. Encrypted fields stored as JSONB.

**API and web.** Case manager view (my caseload, what is due), director dashboard (district posture, findings by rule), parent portal.

**Ingest.** Clever, ClassLink, OneRoster, Ed-Fi. Roster is read from the SIS; SentryAI does not want to be the enrollment authority.

**AI drafting.** Contract defined in [ai-governance.md](ai-governance.md) before implementation, on purpose.

**State reporting extracts.** CALPADS, TSDS, EDFacts. This is where the per-state work compounds and where the moat is.
