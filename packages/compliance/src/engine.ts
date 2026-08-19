import { compareDates } from '@sentryai/domain'
import { DOCUMENT_RULES } from './rules/documents.js'
import { SERVICE_RULES } from './rules/services.js'
import { TIMELINE_RULES } from './rules/timelines.js'
import type { Finding, Rule, RuleContext, Severity } from './types.js'

export const ALL_RULES: readonly Rule[] = [
  ...TIMELINE_RULES,
  ...DOCUMENT_RULES,
  ...SERVICE_RULES,
]

const SEVERITY_ORDER: Record<Severity, number> = {
  violation: 0,
  'at-risk': 1,
  'weak-documentation': 2,
  informational: 3,
}

/**
 * Run the rule set over one student.
 *
 * A rule that throws is contained rather than allowed to abort the run: a bug
 * in one rule must never blank out the compliance picture for a child, because
 * an empty dashboard reads as "everything is fine." The failure surfaces as an
 * informational finding so it is visible instead of silent.
 */
export function evaluateStudent(
  ctx: RuleContext,
  rules: readonly Rule[] = ALL_RULES,
): Finding[] {
  const findings: Finding[] = []

  for (const rule of rules) {
    try {
      findings.push(...rule.evaluate(ctx))
    } catch (error) {
      findings.push({
        ruleId: rule.id,
        severity: 'informational',
        studentId: ctx.student.id,
        message: `Compliance check "${rule.title}" could not be evaluated: ${error instanceof Error ? error.message : String(error)}. This student's status for that rule is unknown.`,
        citation: rule.citation,
        remedy: 'Review the record manually until the check can run.',
        dueOn: null,
        daysRemaining: null,
        subject: { kind: 'student', id: ctx.student.id },
      })
    }
  }

  return sortFindings(findings)
}

/** Most severe first, then soonest due, then stable by rule id. */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    if (bySeverity !== 0) return bySeverity

    if (a.dueOn !== null && b.dueOn !== null) {
      const byDue = compareDates(a.dueOn, b.dueOn)
      if (byDue !== 0) return byDue
    } else if (a.dueOn !== null) {
      return -1
    } else if (b.dueOn !== null) {
      return 1
    }

    return a.ruleId.localeCompare(b.ruleId)
  })
}

export interface ComplianceSummary {
  readonly total: number
  readonly violations: number
  readonly atRisk: number
  readonly weakDocumentation: number
  readonly informational: number
  /**
   * Share of students with no violation and no at-risk finding.
   *
   * Deliberately not called a "compliance score." A district's rate here is a
   * measure of what SentryAI can see, not a certification, and naming it a
   * score invites it into a board presentation as something it is not.
   */
  readonly studentsClear: number
  readonly studentsEvaluated: number
}

export function summarize(
  byStudent: ReadonlyMap<string, readonly Finding[]>,
): ComplianceSummary {
  let violations = 0
  let atRisk = 0
  let weakDocumentation = 0
  let informational = 0
  let studentsClear = 0

  for (const findings of byStudent.values()) {
    let clear = true
    for (const f of findings) {
      switch (f.severity) {
        case 'violation':
          violations += 1
          clear = false
          break
        case 'at-risk':
          atRisk += 1
          clear = false
          break
        case 'weak-documentation':
          weakDocumentation += 1
          break
        case 'informational':
          informational += 1
          break
      }
    }
    if (clear) studentsClear += 1
  }

  return {
    total: violations + atRisk + weakDocumentation + informational,
    violations,
    atRisk,
    weakDocumentation,
    informational,
    studentsClear,
    studentsEvaluated: byStudent.size,
  }
}
