import type { PlainDate } from './date.js'
import type { ConsentId, EvaluationId, StudentId, UserId } from './ids.js'

export type EvaluationKind =
  /** First evaluation to determine whether the child has a disability. */
  | 'initial'
  /** The at-least-every-three-years reevaluation. 34 CFR 300.303(b)(2). */
  | 'triennial'
  /** An additional reevaluation requested by a parent or teacher. */
  | 'requested-reevaluation'
  /** Parent-obtained independent evaluation. 34 CFR 300.502. */
  | 'independent'

export type EvaluationStatus =
  | 'referred'
  | 'consent-requested'
  | 'consent-obtained'
  | 'consent-refused'
  | 'in-progress'
  | 'report-complete'
  | 'eligibility-determined'
  | 'withdrawn'

/**
 * A period during which an evaluation timeline was lawfully paused.
 *
 * Most states allow the clock to stop for extended school breaks, or when a
 * parent repeatedly fails to produce the child for assessment. Every tolled
 * period carries a reason, because an unexplained pause is itself a finding --
 * "the clock stopped and nobody wrote down why" is how districts lose these.
 */
export interface TolledPeriod {
  readonly from: PlainDate
  readonly to: PlainDate
  readonly reason: 'school-break' | 'parent-unavailable' | 'student-withdrew' | 'other'
  readonly note: string
}

export interface Evaluation {
  readonly id: EvaluationId
  readonly studentId: StudentId
  readonly kind: EvaluationKind
  readonly status: EvaluationStatus
  /**
   * When the district received the referral. Child find timelines run from
   * here, and this is usually earlier than the consent date -- districts draw
   * findings for sitting on referrals before requesting consent.
   */
  readonly referredOn: PlainDate
  readonly consentRequestedOn: PlainDate | null
  /**
   * Date the district received signed parental consent. The federal 60-day
   * evaluation clock starts here, not at referral. 34 CFR 300.301(c)(1)(i).
   */
  readonly consentReceivedOn: PlainDate | null
  readonly consentId: ConsentId | null
  readonly reportCompletedOn: PlainDate | null
  /** When the team determined eligibility -- the end of the 60-day clock. */
  readonly eligibilityDeterminedOn: PlainDate | null
  readonly assignedTo: UserId | null
  readonly tolledPeriods: readonly TolledPeriod[]
}
