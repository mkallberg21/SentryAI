import type {
  Consent,
  Evaluation,
  Iep,
  Meeting,
  Notice,
  PlainDate,
  ProgressEntry,
  ServiceLog,
  Student,
} from '@sentryai/domain'
import type { DayCountBasis, SchoolCalendar } from './calendar.js'

/**
 * How badly a finding hurts.
 *
 * The distinction that matters is between a violation that has already
 * occurred and one that is still preventable. SentryAI exists to convert the
 * former into the latter, so the dashboard sorts on this before anything else.
 */
export type Severity =
  /** Already out of compliance. Reportable, and likely a monitoring finding. */
  | 'violation'
  /** Deadline approaching and the work is not done. Still preventable. */
  | 'at-risk'
  /** Compliant, but the record will not defend itself if challenged. */
  | 'weak-documentation'
  | 'informational'

export interface Finding {
  readonly ruleId: string
  readonly severity: Severity
  readonly studentId: string
  /** One sentence a case manager can act on without reading the regulation. */
  readonly message: string
  /** The legal hook, so a director can verify the claim rather than trust it. */
  readonly citation: string
  /** What to do about it. Absent when there is no remedy left but disclosure. */
  readonly remedy: string | null
  readonly dueOn: PlainDate | null
  readonly daysRemaining: number | null
  readonly subject: FindingSubject
}

export type FindingSubject =
  | { kind: 'evaluation'; id: string }
  | { kind: 'iep'; id: string }
  | { kind: 'meeting'; id: string }
  | { kind: 'notice'; id: string }
  | { kind: 'service'; id: string }
  | { kind: 'student'; id: string }

/**
 * Everything a rule is allowed to look at.
 *
 * Rules are pure functions of this context. They perform no IO, which is what
 * makes the whole rule set testable against fixtures and reproducible in an
 * audit -- "why did the system say we were late on 2026-03-14" has to have a
 * deterministic answer.
 */
export interface RuleContext {
  readonly asOf: PlainDate
  readonly student: Student
  readonly calendar: SchoolCalendar
  readonly policy: CompliancePolicy
  readonly evaluations: readonly Evaluation[]
  readonly ieps: readonly Iep[]
  readonly meetings: readonly Meeting[]
  readonly notices: readonly Notice[]
  readonly consents: readonly Consent[]
  readonly progress: readonly ProgressEntry[]
  readonly serviceLogs: readonly ServiceLog[]
}

export interface Rule {
  readonly id: string
  readonly title: string
  readonly citation: string
  /** Which regulatory layer this rule comes from, for attribution in the UI. */
  readonly source: 'federal' | 'state' | 'district'
  evaluate(ctx: RuleContext): Finding[]
}

/**
 * The numbers that vary by state.
 *
 * Every timeline in IDEA is "N days, unless the state sets a different figure,"
 * so the rules are written against this policy object and the state pack fills
 * it in. Adding a state is supplying a policy plus any rules unique to it --
 * not forking the engine.
 */
export interface CompliancePolicy {
  readonly stateCode: string
  readonly stateName: string

  readonly initialEvaluation: TimelineSpec
  /** Consent to eligibility determination, when the state splits the clock. */
  readonly evaluationToMeeting: TimelineSpec | null
  readonly reevaluationIntervalYears: number
  readonly annualReviewIntervalDays: number
  readonly meetingNotice: TimelineSpec
  readonly priorWrittenNotice: TimelineSpec
  /** School days after a removal decision to hold manifestation determination. */
  readonly manifestationDetermination: TimelineSpec
  /** Cumulative removal days that trigger a change-of-placement analysis. */
  readonly disciplinaryRemovalThresholdDays: number
  /** Age at which transition planning must be in effect. */
  readonly transitionPlanningAge: number
  readonly ageOfMajority: number
  /** Whether extended school breaks pause the evaluation clock. */
  readonly evaluationTollsForExtendedBreaks: boolean
  /** Days before a deadline at which the engine starts warning. */
  readonly atRiskWindowDays: number
}

export interface TimelineSpec {
  readonly days: number
  readonly basis: DayCountBasis
}
