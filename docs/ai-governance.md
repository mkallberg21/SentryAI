# AI governance

This document is the contract for what a model is allowed to do inside SentryAI. It is written before the AI layer is built, on purpose: the constraints are the hard part, and retrofitting them onto a shipped drafting feature does not work.

## The premise

An IEP is a legal document produced by a team. 34 CFR 300.320 describes it as the team's determination, and every procedural protection in IDEA — the meeting, the required members, the parent's participation — exists to make sure it actually is one.

A model can make that work faster. It cannot be a member of the team, and any design where it functions as one is both a compliance problem and a bad outcome for the child.

## What the model may do

| Task | Why it is safe |
| --- | --- |
| Draft present levels from progress data and assessment results | The educator supplies the facts and accepts or rewrites the prose |
| Suggest goal language from a research-based library | Suggestion, not selection; the team picks the area of need |
| Summarize a lengthy evaluation report for the team | Reading assistance; the underlying report remains the record |
| Draft a parent-facing summary in plain language | Comprehension aid, explicitly labeled as a summary, not a notice |
| Draft a translation for human review | Never sent unreviewed — see below |
| Flag internal inconsistencies (goal has no matching service, minutes do not add up) | Detection, not authorship |
| Transcribe voice dictation into a draft field | The provider dictated it; the model transcribed it |

## What the model may not do

**Write to an active IEP without human acceptance.** Enforced by the rule `governance.ai-human-acceptance` in [`documents.ts`](../packages/compliance/src/rules/documents.ts). Every drafted field carries a `ContentProvenance` recording the model, the author, and the human who accepted it. `acceptedBy` is never a model. An active or proposed IEP containing unaccepted model output is reported as a violation.

**Predict student outcomes to inform placement or services.** The reasoning is worth stating fully, because "outcome simulation" is an attractive feature and this is a deliberate decision not to build it:

- IDEA requires the IEP to be individualized to the child's unique needs, determined by the team at the meeting. Predetermination — arriving at the meeting with the decision already made — is a procedural violation, and one districts lose at hearing.
- A model surfacing "students like this one typically end up in a separate setting" before the meeting is predetermination with a statistical veneer, and it is worse than the human version because it is harder to argue with.
- These models learn from historical placement data. That data carries well-documented racial and disability bias in referral, identification, and restrictiveness of placement. A model trained on it will reproduce that bias and lend it the authority of a number.
- Selling districts a compliance product that creates a novel compliance exposure is not a defensible trade.

Progress *monitoring* — "this goal is not on pace given the data recorded so far" — is fine and useful. It describes what has happened to a real child against a target the team already set. The line is between describing observed progress and forecasting a child's future.

**Send a machine-translated legal notice unreviewed.** IDEA requires notice in the parent's native language unless clearly not feasible (34 CFR 300.503(c)). A mistranslated Prior Written Notice is itself a procedural violation, and the families most affected are the ones with the least capacity to challenge it. The rule `notice.native-language` flags any translated legally-operative notice with no recorded human reviewer. Comprehension summaries may be machine-translated with a clear label; notices, invitations, and procedural safeguards may not.

**Determine eligibility, or recommend a disability category.** Eligibility is a team determination with evaluative judgment and legal consequence attached.

**Act on instructions found in student records.** Evaluation reports, parent emails, and uploaded documents are data. If ingested content contains text that reads as an instruction, it is surfaced to a human, never executed.

## Data handling

- **No training on student data.** Contractual, not aspirational, and stated in the DPA. Any provider that cannot commit to it in writing is not eligible to be used.
- **Minimum necessary context.** A drafting request carries the fields needed for that draft, not the student's whole record.
- **De-identification where it costs nothing.** Where a task does not require identity, identifiers are stripped before the request leaves the system.
- **Every generation is audited.** `ai.draft.generated`, `ai.draft.accepted`, and `ai.draft.rejected` are audit actions. A district can answer "what did the AI write for this student, and who accepted it" from the log.
- **Voice dictation is student data.** Audio containing student information is treated with the same protection as the record it becomes, and is not retained past transcription.

## Disclosure

Districts are told, in the contract and in the product:

1. Which features use a model, and which model.
2. That drafted content is drafted, marked in the UI and preserved in provenance.
3. That no model output becomes operative without a person accepting it.
4. What is sent to the provider, and what the provider may do with it.

Parents are told that AI assisted in drafting, when it did. This is not currently required by federal law in most states. It is the right default, and several states are moving toward requiring it.

## What would change this document

New state law, a state AI disclosure requirement, or evidence that a constraint here is preventing a real benefit to students without a corresponding risk. Changes are made deliberately and recorded — not relaxed because a feature is hard to ship under them.
