# Security and data protection

## What is being protected

Special education records are among the most sensitive data a school district holds: disability categories, psychological evaluations, behavior incidents, medical information, family circumstances. Disclosure harms a child for years, and the children affected have the least ability to advocate for themselves.

The regulatory floor is FERPA and IDEA Part B confidentiality provisions (34 CFR 300.610–300.627), plus state law that in several states is considerably stricter than federal.

## Threat model

Ranked by likelihood, not by drama.

| Threat | Mitigation |
| --- | --- |
| Over-broad internal access — a user seeing students outside their caseload | Row-level authorization scoped by district, school, and caseload; every access audited |
| Misconfigured query or export leaking across students | Field encryption with AAD binding ciphertext to its student and record; a cross-student read fails to decrypt |
| Bulk export by a compromised or malicious account | `export-student-data` requires dual approval; exports are audited with the student set recorded |
| Vendor-side access by support engineers | KMS-held keys the application role cannot read; support access is time-boxed and audited |
| Tampering to hide a missed deadline | Hash-chained audit log; alteration, deletion, and reordering are all detectable |
| Credential compromise | SSO via the district IdP, MFA required for approver roles |
| Prompt injection via uploaded evaluation reports or parent email | Ingested content is data, never instructions; anything resembling a directive is surfaced to a human |
| Stolen backup or drive | Encryption at rest, plus field-level encryption so the database alone is insufficient |
| Model provider retaining student data | Contractual no-training, no-retention terms; providers unable to commit are not eligible |

Notably *not* on this list as a primary control: disk encryption alone. It protects against a stolen drive and nothing else on this table, and it is the control vendors most often present as if it were sufficient.

## Field-level encryption

Sensitive fields are encrypted individually with AES-256-GCM. Each record gets its own data key, wrapped by a key-encryption key in AWS KMS or GCP KMS.

The additional authenticated data binds every ciphertext to `studentId | recordType | recordId | fieldName`. A ciphertext moved between students, records, or fields fails authentication instead of decrypting into the wrong child's record — which converts a silent data-integrity disaster into a loud error.

Decryption failures are deliberately opaque. The common cause is a cross-context read, and the error message must not confirm anything about either record.

`LocalKeyProvider` exists for development and refuses to construct when `NODE_ENV=production`. A key-encryption key in an environment variable ends up in a log, a crash dump, or a repository.

## Audit

Every read, write, correction, deletion, export, signature, approval, and AI generation is logged. Entries chain by SHA-256 so the log is tamper-evident: an altered entry breaks every hash after it.

Entries record **field names, never values**. This is the constraint that keeps the audit log from becoming a second copy of the student record living outside the encryption scheme.

`AuditLog.forStudent` produces the per-student disclosure record FERPA contemplates — a parent asking who has accessed their child's file gets an answer, not a shrug.

## Immutability, correctly scoped

SentryAI does not claim immutable records, and the distinction is not pedantic:

- FERPA gives parents the right to request amendment of education records.
- Several state laws — New York Education Law § 2-d most prominently — require deletion of student data at contract termination.

A genuinely immutable record collides with both. What is immutable here is the **log**. Records can be corrected and erased; the fact that they were corrected or erased, by whom, and why, cannot be erased.

## Compliance posture

Targets, not current state — this is an early-stage project and claiming otherwise would be the sort of thing this repository is explicitly trying not to do.

- **SOC 2 Type II** — required before a district of any size will sign.
- **NDPA** (Student Data Privacy Consortium National Data Privacy Agreement) — the standard districts increasingly require; signing the standard form rather than negotiating bespoke terms is itself a selling point.
- **State addenda** — California SOPIPA and AB 1584; New York Ed Law 2-d with its parents' bill of rights. 2-d is the strictest regime in the country, and clearing it is cheaper done early than retrofitted.
- **WCAG 2.1 AA and Section 508, with a published VPAT.** Non-negotiable. Special education software that is not accessible is an own-goal, and many districts require the VPAT contractually.
- **COPPA** — applicable where students under 13 interact directly with the product.

## Data retention and deletion

- District-configurable retention aligned to state record schedules, which commonly require special education records be held for years after a student exits.
- Deletion on contract termination, in a documented timeframe, without a fee or a negotiation.
- Deletion is a dual-approval action and is recorded in the audit chain: the record goes, the fact of its going stays.

## Reporting a vulnerability

No process yet — this repository is pre-release. Before any district data exists, a documented disclosure path and a response commitment go in this file.
