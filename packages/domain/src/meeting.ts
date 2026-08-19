import type { PlainDate } from './date.js'
import type { MeetingId, StudentId, UserId } from './ids.js'

export type MeetingPurpose =
  | 'initial-eligibility'
  | 'annual-review'
  | 'triennial-review'
  | 'amendment'
  | 'manifestation-determination'
  | 'transition-planning'
  | 'interim-placement'

/**
 * The required IEP team roles. 34 CFR 300.321(a).
 *
 * A meeting held without a required role, and without a written excusal agreed
 * to by the parent, is a procedural violation -- and one of the easiest for a
 * district to lose at hearing, because attendance sheets prove it either way.
 */
export type TeamRole =
  | 'parent'
  | 'general-education-teacher'
  | 'special-education-teacher'
  | 'lea-representative'
  | 'evaluation-interpreter'
  | 'student'
  | 'related-service-provider'
  | 'other'

export type AttendanceStatus =
  | 'attended'
  | 'attended-remotely'
  /** Excused with written parental agreement. 34 CFR 300.321(e). */
  | 'excused-with-consent'
  | 'absent'

export interface Attendance {
  readonly userId: UserId | null
  readonly name: string
  readonly role: TeamRole
  readonly status: AttendanceStatus
  /**
   * Required when status is `excused-with-consent`. The team member must have
   * submitted written input before the meeting when their area is being
   * modified or discussed.
   */
  readonly writtenInputProvided: boolean
}

export interface Meeting {
  readonly id: MeetingId
  readonly studentId: StudentId
  readonly purpose: MeetingPurpose
  /**
   * When notice of the meeting was sent. Federal law requires notice "early
   * enough to ensure an opportunity to attend" (34 CFR 300.322(a)(1)); most
   * states operationalize that as a fixed number of days, so the state pack
   * supplies the number and this field supplies the date.
   */
  readonly noticeSentOn: PlainDate | null
  readonly scheduledFor: PlainDate
  readonly heldOn: PlainDate | null
  readonly attendance: readonly Attendance[]
  /**
   * Whether an interpreter was provided. Required when the parent's native
   * language is not English and they cannot meaningfully participate without
   * one. 34 CFR 300.322(e).
   */
  readonly interpreterProvided: boolean
  readonly interpreterLanguage: string | null
  readonly rescheduledFrom: readonly PlainDate[]
  /** Parent-requested reschedules toll some state meeting timelines. */
  readonly parentRequestedReschedule: boolean
}

/** Roles that must be present at every IEP meeting under 34 CFR 300.321(a). */
export const REQUIRED_TEAM_ROLES: readonly TeamRole[] = [
  'parent',
  'general-education-teacher',
  'special-education-teacher',
  'lea-representative',
]

export function isPresent(a: Attendance): boolean {
  return a.status === 'attended' || a.status === 'attended-remotely'
}

/**
 * Roles that were neither present nor properly excused.
 *
 * An excusal only counts if the parent consented in writing AND the member
 * submitted written input -- excusing someone without their input is not an
 * excusal, it is an absence with paperwork.
 */
export function unexcusedMissingRoles(meeting: Meeting): TeamRole[] {
  return REQUIRED_TEAM_ROLES.filter((role) => {
    const forRole = meeting.attendance.filter((a) => a.role === role)
    if (forRole.some(isPresent)) return false
    return !forRole.some(
      (a) => a.status === 'excused-with-consent' && a.writtenInputProvided,
    )
  })
}
