import { addDays, billableLogs, compareDates, daysBetween } from '@sentryai/domain'
import type { Finding, Rule, RuleContext } from '../types.js'
import { activeIep, finding } from './helpers.js'

/** Sessions per week implied by a service line, normalized across periods. */
function sessionsPerWeek(period: 'week' | 'month' | 'year', sessions: number): number {
  switch (period) {
    case 'week':
      return sessions
    case 'month':
      return (sessions * 9) / 36
    case 'year':
      return sessions / 36
  }
}

/**
 * Delivered service minutes track the offer of FAPE.
 *
 * A shortfall is not primarily a paperwork problem: it means a child is not
 * receiving the service the district committed to in writing. Catching it in
 * February, while the year can still be made whole, is worth more than any
 * report generated in June -- which is why this rule looks at a rolling window
 * rather than waiting for the annual review.
 */
export const serviceDeliveryShortfall: Rule = {
  id: 'service.delivery-shortfall',
  title: 'Delivered services match the services offered in the IEP',
  citation: '34 CFR 300.323(c)(2)',
  source: 'federal',
  evaluate(ctx: RuleContext): Finding[] {
    const iep = activeIep(ctx)
    if (iep === null) return []

    const windowDays = 60
    const windowStart = addDays(ctx.asOf, -windowDays)
    const out: Finding[] = []

    for (const service of iep.services) {
      const effectiveStart =
        compareDates(service.startsOn, windowStart) > 0 ? service.startsOn : windowStart
      const effectiveEnd = compareDates(service.endsOn, ctx.asOf) < 0 ? service.endsOn : ctx.asOf
      const spanDays = daysBetween(effectiveStart, effectiveEnd)
      if (spanDays <= 0) continue

      const weeks = spanDays / 7
      const expectedSessions = sessionsPerWeek(service.period, service.sessionsPerPeriod) * weeks
      const minutesOwed = expectedSessions * service.minutesPerSession
      if (minutesOwed <= 0) continue

      const logs = ctx.serviceLogs.filter(
        (log) =>
          log.serviceId === service.id &&
          compareDates(log.deliveredOn, effectiveStart) >= 0 &&
          compareDates(log.deliveredOn, effectiveEnd) <= 0,
      )

      // Student absences do not count against the district; provider absences do.
      const excusable = logs.filter((l) => l.status === 'student-absent').length
      const minutesDelivered = logs
        .filter((l) => l.status === 'delivered')
        .reduce((sum, l) => sum + l.minutesDelivered, 0)
      const excusedMinutes = excusable * service.minutesPerSession
      const adjustedOwed = Math.max(0, minutesOwed - excusedMinutes)
      if (adjustedOwed <= 0) continue

      const rate = minutesDelivered / adjustedOwed
      if (rate >= 0.9) continue

      const shortfall = Math.round(adjustedOwed - minutesDelivered)
      out.push(
        finding(
          this.id,
          ctx,
          rate < 0.75 ? 'violation' : 'at-risk',
          { kind: 'service', id: service.id },
          `${service.type.replace(/-/g, ' ')} is at ${Math.round(rate * 100)}% of offered minutes over the last ${windowDays} days (${shortfall} minute(s) short).`,
          this.citation,
          {
            remedy:
              rate < 0.75
                ? 'Determine whether compensatory services are owed and convene the team if the offer needs to change.'
                : 'Schedule make-up sessions before the shortfall becomes compensatory.',
          },
        ),
      )
    }

    return out
  },
}

/**
 * Progress toward each annual goal is reported to parents on the promised
 * cadence. The IEP itself states the frequency, so the rule reads it from the
 * goal rather than assuming quarterly.
 */
export const progressReportingCadence: Rule = {
  id: 'progress.reporting-cadence',
  title: 'Progress reported to parents at the promised frequency',
  citation: '34 CFR 300.320(a)(3)',
  source: 'federal',
  evaluate(ctx: RuleContext): Finding[] {
    const iep = activeIep(ctx)
    if (iep === null) return []

    const intervalDays: Record<string, number> = {
      weekly: 7,
      monthly: 30,
      quarterly: 90,
      trimester: 120,
      semester: 180,
    }

    const out: Finding[] = []

    for (const goal of iep.goals) {
      const interval = intervalDays[goal.reportingFrequency] ?? 90
      const entries = ctx.progress
        .filter((p) => p.goalId === goal.id)
        .sort((a, b) => compareDates(a.recordedOn, b.recordedOn))
      const last = entries.at(-1)

      // Give the district one full interval from the IEP start before warning.
      const since = last?.recordedOn ?? iep.effectiveOn
      const elapsed = daysBetween(since, ctx.asOf)
      if (elapsed <= interval) continue

      out.push(
        finding(
          this.id,
          ctx,
          elapsed > interval * 2 ? 'violation' : 'at-risk',
          { kind: 'iep', id: iep.id },
          last === undefined
            ? `No progress has been recorded for the ${goal.area} goal since the IEP took effect ${elapsed} day(s) ago.`
            : `The ${goal.area} goal was last updated ${elapsed} day(s) ago, past its ${goal.reportingFrequency} reporting cycle.`,
          this.citation,
          { remedy: 'Record current progress data and send the progress report to the parent.' },
        ),
      )
    }

    return out
  },
}

/**
 * Delivered services are documented well enough to bill.
 *
 * Not a compliance requirement -- a revenue one. Districts routinely deliver
 * Medicaid-billable services and then fail to claim them because a log is
 * missing a signature or a credential. That is money the district earned,
 * serving students it already served. Surfacing it is the most direct way this
 * platform pays for itself.
 */
export const medicaidDocumentationGap: Rule = {
  id: 'service.medicaid-documentation',
  title: 'Billable services are documented well enough to claim',
  citation: 'District Medicaid administrative claiming plan',
  source: 'district',
  evaluate(ctx: RuleContext): Finding[] {
    const iep = activeIep(ctx)
    if (iep === null) return []

    const billableServiceIds = new Set(
      iep.services.filter((s) => s.medicaidBillable).map((s) => s.id),
    )
    if (billableServiceIds.size === 0) return []

    const consented = ctx.consents.some(
      (c) => c.kind === 'medicaid-billing' && c.response === 'granted',
    )
    if (!consented) return []

    const relevant = ctx.serviceLogs.filter(
      (log) => billableServiceIds.has(log.serviceId) && log.status === 'delivered',
    )
    if (relevant.length === 0) return []

    const claimable = billableLogs(relevant)
    const unclaimable = relevant.length - claimable.length
    if (unclaimable === 0) return []

    return [
      finding(
        this.id,
        ctx,
        'informational',
        { kind: 'student', id: ctx.student.id },
        `${unclaimable} of ${relevant.length} delivered billable session(s) cannot be claimed: missing a provider signature, credential, or session narrative.`,
        this.citation,
        {
          remedy:
            'Have the provider complete and sign the outstanding logs before the claiming deadline.',
        },
      ),
    ]
  },
}

export const SERVICE_RULES: readonly Rule[] = [
  serviceDeliveryShortfall,
  progressReportingCadence,
  medicaidDocumentationGap,
]
