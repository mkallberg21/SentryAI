import type { PlainDate } from './date.js'
import type { ConsentId, NoticeId, StudentId, UserId } from './ids.js'

/**
 * Parental consent. 34 CFR 300.300.
 *
 * Consent is the hinge on which most IDEA timelines turn: the evaluation clock
 * starts when consent is received, services cannot begin without consent for
 * initial placement, and consent may be revoked at any time.
 */
export type ConsentKind =
  | 'initial-evaluation'
  | 'initial-placement'
  | 'reevaluation'
  | 'release-of-records'
  | 'medicaid-billing'
  | 'excusal-of-team-member'

export type ConsentResponse = 'granted' | 'refused' | 'revoked' | 'no-response'

export interface Consent {
  readonly id: ConsentId
  readonly studentId: StudentId
  readonly kind: ConsentKind
  readonly requestedOn: PlainDate
  /** Date the district received the signed response. */
  readonly respondedOn: PlainDate | null
  readonly response: ConsentResponse
  readonly signedBy: string | null
  /**
   * The language the consent form was presented in. A consent obtained on a
   * form the parent could not read is not informed consent.
   */
  readonly presentedInLanguage: string
  readonly documentUri: string | null
}

/**
 * Prior Written Notice. 34 CFR 300.503.
 *
 * Required whenever the district proposes or refuses to initiate or change the
 * identification, evaluation, placement, or provision of FAPE. PWN failures are
 * the single most common procedural finding, usually because the district did
 * the right thing substantively but never wrote down why.
 */
export type NoticeKind =
  | 'prior-written-notice'
  | 'meeting-invitation'
  | 'procedural-safeguards'
  | 'progress-report'
  | 'evaluation-report'
  | 'age-of-majority'

export type NoticeDelivery = 'hand-delivered' | 'mail' | 'email' | 'parent-portal'

/** The six content elements a PWN must contain under 34 CFR 300.503(b). */
export interface PriorWrittenNoticeContent {
  readonly actionProposedOrRefused: string
  readonly explanationOfWhy: string
  readonly evaluationProceduresRelied: string
  readonly otherOptionsConsidered: string
  readonly reasonsOptionsRejected: string
  readonly otherFactorsRelevant: string
}

export interface Notice {
  readonly id: NoticeId
  readonly studentId: StudentId
  readonly kind: NoticeKind
  readonly sentOn: PlainDate
  readonly delivery: NoticeDelivery
  /**
   * The language the notice was actually sent in -- not the language it was
   * supposed to be sent in. IDEA requires native language unless clearly not
   * feasible, and the engine compares this against the family's home language.
   */
  readonly language: string
  /**
   * Whether a human reviewed a machine translation before it was sent. A
   * mistranslated PWN is itself a procedural violation, so machine output
   * cannot reach a parent unreviewed. See docs/ai-governance.md.
   */
  readonly translationReviewedBy: UserId | null
  readonly content: PriorWrittenNoticeContent | null
  readonly documentUri: string | null
}

/** PWN content elements that are missing or blank. */
export function missingPwnElements(content: PriorWrittenNoticeContent): string[] {
  const required: Array<[keyof PriorWrittenNoticeContent, string]> = [
    ['actionProposedOrRefused', 'a description of the action proposed or refused'],
    ['explanationOfWhy', 'an explanation of why the agency proposes or refuses to act'],
    ['evaluationProceduresRelied', 'each evaluation procedure, record, or report relied upon'],
    ['otherOptionsConsidered', 'other options the IEP team considered'],
    ['reasonsOptionsRejected', 'the reasons those options were rejected'],
    ['otherFactorsRelevant', 'other factors relevant to the proposal or refusal'],
  ]
  return required
    .filter(([key]) => content[key].trim().length === 0)
    .map(([, label]) => label)
}
