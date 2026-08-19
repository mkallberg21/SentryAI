import { compareDates, daysBetween, type PlainDate } from '@sentryai/domain'
import type { Finding, FindingSubject, RuleContext, Severity } from '../types.js'

/**
 * Classify a deadline relative to today.
 *
 * The three-way split is the product in miniature: something already missed is
 * a violation the district has to disclose and remediate, something inside the
 * warning window is work that still gets done on time, and everything else is
 * noise the case manager should not be shown.
 */
export function deadlineSeverity(
  ctx: RuleContext,
  dueOn: PlainDate,
): { severity: Severity; daysRemaining: number } | null {
  const daysRemaining = daysBetween(ctx.asOf, dueOn)
  if (daysRemaining < 0) return { severity: 'violation', daysRemaining }
  if (daysRemaining <= ctx.policy.atRiskWindowDays) {
    return { severity: 'at-risk', daysRemaining }
  }
  return null
}

export function finding(
  ruleId: string,
  ctx: RuleContext,
  severity: Severity,
  subject: FindingSubject,
  message: string,
  citation: string,
  options: { remedy?: string | null; dueOn?: PlainDate | null; daysRemaining?: number | null } = {},
): Finding {
  return {
    ruleId,
    severity,
    studentId: ctx.student.id,
    message,
    citation,
    remedy: options.remedy ?? null,
    dueOn: options.dueOn ?? null,
    daysRemaining: options.daysRemaining ?? null,
    subject,
  }
}

/** The IEP currently in effect, if any. */
export function activeIep(ctx: RuleContext) {
  return ctx.ieps.find((iep) => iep.status === 'active') ?? null
}

/** The most recent completed evaluation of a given kind. */
export function latestCompletedEvaluation(ctx: RuleContext, kinds: readonly string[]) {
  return ctx.evaluations
    .filter((e) => kinds.includes(e.kind) && e.eligibilityDeterminedOn !== null)
    .sort((a, b) =>
      compareDates(a.eligibilityDeterminedOn!, b.eligibilityDeterminedOn!),
    )
    .at(-1) ?? null
}

/** The language the family should receive notices in. */
export function familyLanguage(ctx: RuleContext): string {
  const decisionMaker = ctx.student.decisionMakers[0]
  return decisionMaker?.preferredLanguage ?? ctx.student.homeLanguage
}

export function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim().length === 0
}
