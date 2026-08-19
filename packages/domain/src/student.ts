import type { PlainDate } from './date.js'
import type { DistrictId, SchoolId, StudentId } from './ids.js'

/**
 * The thirteen federal disability categories under IDEA Part B (34 CFR 300.8),
 * plus developmental delay, which states may use for children aged 3 through 9.
 *
 * States use their own labels -- California says "specific learning disability"
 * where Texas says "learning disability" -- so a state pack maps its own
 * terminology onto these. The compliance engine reasons over one vocabulary.
 */
export type DisabilityCategory =
  | 'autism'
  | 'deaf-blindness'
  | 'deafness'
  | 'emotional-disturbance'
  | 'hearing-impairment'
  | 'intellectual-disability'
  | 'multiple-disabilities'
  | 'orthopedic-impairment'
  | 'other-health-impairment'
  | 'specific-learning-disability'
  | 'speech-or-language-impairment'
  | 'traumatic-brain-injury'
  | 'visual-impairment'
  | 'developmental-delay'

export type EducationalDecisionMaker =
  | { kind: 'parent'; name: string; preferredLanguage: string }
  | { kind: 'guardian'; name: string; preferredLanguage: string }
  | {
      kind: 'surrogate-parent'
      name: string
      preferredLanguage: string
      appointedOn: PlainDate
    }
  /** A student who has reached the age of majority holds their own rights. */
  | { kind: 'adult-student'; preferredLanguage: string }

export interface Student {
  readonly id: StudentId
  readonly districtId: DistrictId
  readonly schoolId: SchoolId
  /** District-assigned identifier, used for SIS reconciliation. */
  readonly localId: string
  /** State-assigned identifier (SSID in California, TSDS unique ID in Texas). */
  readonly stateId: string | null
  readonly firstName: string
  readonly lastName: string
  readonly dateOfBirth: PlainDate
  readonly gradeLevel: string
  /**
   * The language the family uses at home. IDEA requires notice in the parent's
   * native language unless clearly not feasible (34 CFR 300.503(c)), so this
   * drives document generation, not just a UI preference.
   */
  readonly homeLanguage: string
  readonly decisionMakers: readonly EducationalDecisionMaker[]
  readonly enrolledOn: PlainDate
  readonly exitedOn: PlainDate | null
}

export interface EligibilityDetermination {
  readonly studentId: StudentId
  readonly eligible: boolean
  readonly primaryDisability: DisabilityCategory | null
  readonly secondaryDisabilities: readonly DisabilityCategory[]
  readonly determinedOn: PlainDate
}
