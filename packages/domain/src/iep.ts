import type { PlainDate } from './date.js'
import type { GoalId, IepId, MeetingId, ServiceId, StudentId, UserId } from './ids.js'
import type { DisabilityCategory } from './student.js'

export type IepStatus =
  | 'draft'
  /** Circulated to the team ahead of the meeting. Not operative. */
  | 'proposed'
  /** Signed and in effect. This is the offer of FAPE. */
  | 'active'
  | 'superseded'
  | 'archived'

export type IepKind = 'initial' | 'annual' | 'amendment' | 'interim-transfer'

/**
 * Where a piece of IEP content came from.
 *
 * Recorded permanently on every drafted field. If a model wrote it, that fact
 * survives in the record alongside the human who accepted it -- `acceptedBy` is
 * never a model, and the compliance engine rejects any document where AI
 * content reached an active IEP without a named human acceptance.
 * See docs/ai-governance.md.
 */
export interface ContentProvenance {
  readonly source: 'human' | 'ai-drafted' | 'ai-assisted' | 'template'
  readonly authoredBy: UserId
  readonly acceptedBy: UserId | null
  readonly acceptedOn: PlainDate | null
  readonly modelId: string | null
}

export interface Measurement {
  readonly value: number
  readonly unit: string
  /** The condition under which the measurement is taken. */
  readonly condition: string
}

export type MeasurementMethod =
  | 'curriculum-based-measurement'
  | 'work-samples'
  | 'observation'
  | 'data-collection'
  | 'standardized-assessment'
  | 'rubric'

export type GoalArea =
  | 'reading'
  | 'writing'
  | 'math'
  | 'communication'
  | 'social-emotional'
  | 'behavior'
  | 'adaptive'
  | 'motor'
  | 'vocational'
  | 'transition'
  | 'other'

export interface ShortTermObjective {
  readonly statement: string
  readonly target: Measurement
  readonly targetDate: PlainDate
}

/**
 * A measurable annual goal. 34 CFR 300.320(a)(2).
 *
 * Baseline and target are structured measurements rather than prose because
 * progress monitoring computes against them. A goal whose target cannot be
 * measured is not a compliant goal, and the engine says so rather than letting
 * it reach a signed document.
 */
export interface Goal {
  readonly id: GoalId
  readonly area: GoalArea
  readonly statement: string
  readonly baseline: Measurement
  readonly target: Measurement
  readonly measurementMethod: MeasurementMethod
  /** How often progress is reported to parents. 34 CFR 300.320(a)(3). */
  readonly reportingFrequency:
    | 'weekly'
    | 'monthly'
    | 'quarterly'
    | 'trimester'
    | 'semester'
  readonly objectives: readonly ShortTermObjective[]
  readonly provenance: ContentProvenance
}

export type ServiceType =
  | 'specialized-academic-instruction'
  | 'speech-language'
  | 'occupational-therapy'
  | 'physical-therapy'
  | 'counseling'
  | 'behavior-intervention'
  | 'nursing'
  | 'orientation-mobility'
  | 'assistive-technology'
  | 'transportation'
  | 'interpreting'
  | 'other'

/**
 * A related service or specially designed instruction line.
 *
 * Minutes are explicit rather than prose ("30 minutes weekly") because two
 * things depend on the number: whether delivered service matches the offer of
 * FAPE, and whether the district can substantiate a Medicaid claim for it.
 */
export interface ServiceLine {
  readonly id: ServiceId
  readonly type: ServiceType
  readonly minutesPerSession: number
  readonly sessionsPerPeriod: number
  readonly period: 'week' | 'month' | 'year'
  readonly setting: 'general-education' | 'special-education' | 'other'
  readonly providerRole: string
  readonly startsOn: PlainDate
  readonly endsOn: PlainDate
  readonly medicaidBillable: boolean
}

/**
 * Least restrictive environment. 34 CFR 300.114.
 *
 * `removalJustification` is required whenever the student spends any time
 * outside general education. Its absence is among the most common findings in
 * state monitoring, which is why it is a nullable field the engine checks
 * rather than an optional one callers can forget.
 */
export interface Placement {
  readonly percentInGeneralEducation: number
  readonly settingCode: string
  readonly removalJustification: string | null
  readonly supplementaryAidsConsidered: readonly string[]
}

export interface Accommodation {
  readonly description: string
  readonly appliesTo: readonly ('instruction' | 'district-assessment' | 'state-assessment')[]
  readonly frequency: string
}

/**
 * Transition services, required in the first IEP that will be in effect when
 * the student turns 16. 34 CFR 300.320(b). Some states start at 14.
 */
export interface TransitionPlan {
  readonly postsecondaryEducationGoal: string
  readonly employmentGoal: string
  readonly independentLivingGoal: string | null
  readonly courseOfStudy: string
  readonly agencyLinkages: readonly string[]
  /** The age-appropriate transition assessments the goals are based on. */
  readonly assessmentsUsed: readonly string[]
}

export interface ExtendedSchoolYear {
  readonly considered: boolean
  readonly eligible: boolean
  readonly justification: string | null
}

export interface Iep {
  readonly id: IepId
  readonly studentId: StudentId
  readonly kind: IepKind
  readonly status: IepStatus
  readonly primaryDisability: DisabilityCategory
  readonly secondaryDisabilities: readonly DisabilityCategory[]

  /** The meeting at which this IEP was developed. */
  readonly meetingId: MeetingId | null

  readonly effectiveOn: PlainDate
  /** Computed on creation, then watched. The single most-missed deadline. */
  readonly annualReviewDueOn: PlainDate

  readonly presentLevels: string
  readonly presentLevelsProvenance: ContentProvenance
  readonly goals: readonly Goal[]
  readonly services: readonly ServiceLine[]
  readonly placement: Placement
  readonly accommodations: readonly Accommodation[]
  readonly transitionPlan: TransitionPlan | null
  readonly extendedSchoolYear: ExtendedSchoolYear

  readonly signedOn: PlainDate | null
  readonly supersedesIepId: IepId | null
}

/** Total weekly service minutes, normalized across period units. */
export function weeklyServiceMinutes(services: readonly ServiceLine[]): number {
  return services.reduce((total, s) => {
    const perYear =
      s.period === 'week'
        ? s.minutesPerSession * s.sessionsPerPeriod * 36
        : s.period === 'month'
          ? s.minutesPerSession * s.sessionsPerPeriod * 9
          : s.minutesPerSession * s.sessionsPerPeriod
    return total + perYear / 36
  }, 0)
}
