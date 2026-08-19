import type { PlainDate } from './date.js'
import type { GoalId, ServiceId, StudentId, UserId } from './ids.js'

/**
 * A progress observation against a measurable annual goal.
 *
 * IDEA requires periodic reports on progress toward annual goals, delivered as
 * often as parents of non-disabled children receive report cards
 * (34 CFR 300.320(a)(3)). "Making progress" as a checkbox does not satisfy it;
 * the report has to say how far toward what.
 */
export interface ProgressEntry {
  readonly goalId: GoalId
  readonly recordedOn: PlainDate
  readonly recordedBy: UserId
  readonly value: number
  readonly unit: string
  readonly narrative: string
  readonly onTrack: boolean
}

/**
 * A delivered service session.
 *
 * This record does double duty: it proves the district delivered the services
 * it offered (the defense against a compensatory-education claim), and it is
 * the substantiating document for a Medicaid claim. Districts routinely lose
 * reimbursement they earned because the log lacks a provider credential or a
 * signature, so those are required fields rather than optional metadata.
 */
export interface ServiceLog {
  readonly serviceId: ServiceId
  readonly studentId: StudentId
  readonly deliveredOn: PlainDate
  readonly minutesDelivered: number
  readonly providerId: UserId
  readonly providerCredential: string
  readonly setting: 'general-education' | 'special-education' | 'other'
  readonly groupSize: number
  readonly narrative: string
  readonly status: 'delivered' | 'student-absent' | 'provider-absent' | 'cancelled'
  /** Signed and locked by the provider. Unsigned logs are not billable. */
  readonly signedOn: PlainDate | null
}

/**
 * Minutes owed versus minutes delivered over a window.
 *
 * A persistent shortfall is a FAPE problem long before it is a paperwork
 * problem -- it means a child is not getting the service the district promised.
 * Surfacing it while the year is still running is the entire point.
 */
export interface ServiceDeliverySummary {
  readonly serviceId: ServiceId
  readonly windowStart: PlainDate
  readonly windowEnd: PlainDate
  readonly minutesOwed: number
  readonly minutesDelivered: number
  readonly sessionsMissed: number
}

export function deliveryRate(summary: ServiceDeliverySummary): number {
  if (summary.minutesOwed === 0) return 1
  return summary.minutesDelivered / summary.minutesOwed
}

/** Logs that are complete enough to substantiate a Medicaid claim. */
export function billableLogs(logs: readonly ServiceLog[]): ServiceLog[] {
  return logs.filter(
    (log) =>
      log.status === 'delivered' &&
      log.signedOn !== null &&
      log.minutesDelivered > 0 &&
      log.providerCredential.trim().length > 0 &&
      log.narrative.trim().length > 0,
  )
}
