import { addYears, ageOn, birthdayAtAge, compareDates, daysBetween } from '@sentryai/domain'
import { addCalendarDaysExcludingBreaks, addDaysOnBasis } from '../calendar.js'
import type { Finding, Rule, RuleContext } from '../types.js'
import { activeIep, deadlineSeverity, finding, latestCompletedEvaluation } from './helpers.js'

/**
 * Initial evaluation must be completed within the state timeline, counted from
 * the district's receipt of signed parental consent.
 *
 * This is the timeline districts miss most often and the one state monitoring
 * looks at first, because it is trivially auditable from two dates.
 */
export const initialEvaluationTimeline: Rule = {
  id: 'eval.initial-timeline',
  title: 'Initial evaluation completed within the required timeline',
  citation: '34 CFR 300.301(c)(1)(i)',
  source: 'federal',
  evaluate(ctx: RuleContext): Finding[] {
    const out: Finding[] = []
    const spec = ctx.policy.initialEvaluation

    for (const evaluation of ctx.evaluations) {
      if (evaluation.kind !== 'initial') continue
      if (evaluation.status === 'withdrawn' || evaluation.status === 'consent-refused') continue

      const start = evaluation.consentReceivedOn
      if (start === null) continue

      // States that exclude school vacations do so by not counting those days
      // at all, rather than by extending the deadline afterwards. Counting
      // forward and skipping is the only version that cannot drift when the
      // extension itself crosses a break.
      const skipsBreaks =
        ctx.policy.evaluationTollsForExtendedBreaks && spec.basis === 'calendar'
      const advance = (from: typeof start, days: number) =>
        skipsBreaks
          ? addCalendarDaysExcludingBreaks(ctx.calendar, from, days)
          : addDaysOnBasis(ctx.calendar, from, days, spec.basis)

      let dueOn = advance(start, spec.days)

      // Extend for lawfully tolled periods before comparing against reality,
      // so a district that paused the clock correctly is not flagged.
      const tolledDays = evaluation.tolledPeriods.reduce(
        (sum, p) => sum + daysBetween(p.from, p.to) + 1,
        0,
      )
      if (tolledDays > 0) {
        dueOn = advance(dueOn, tolledDays)
      }

      const completedOn = evaluation.eligibilityDeterminedOn

      if (completedOn !== null) {
        if (compareDates(completedOn, dueOn) > 0) {
          out.push(
            finding(
              this.id,
              ctx,
              'violation',
              { kind: 'evaluation', id: evaluation.id },
              `Initial evaluation completed ${daysBetween(dueOn, completedOn)} day(s) past the ${spec.days}-${spec.basis}-day deadline.`,
              this.citation,
              {
                dueOn,
                remedy:
                  'Document the delay and the reason in the student record, and determine whether compensatory services are owed.',
              },
            ),
          )
        }
        continue
      }

      const status = deadlineSeverity(ctx, dueOn)
      if (status !== null) {
        out.push(
          finding(
            this.id,
            ctx,
            status.severity,
            { kind: 'evaluation', id: evaluation.id },
            status.severity === 'violation'
              ? `Initial evaluation is ${Math.abs(status.daysRemaining)} day(s) overdue and still incomplete.`
              : `Initial evaluation is due in ${status.daysRemaining} day(s).`,
            this.citation,
            {
              dueOn,
              daysRemaining: status.daysRemaining,
              remedy: 'Complete the evaluation report and convene the eligibility team.',
            },
          ),
        )
      }
    }
    return out
  },
}

/**
 * The IEP must be reviewed at least annually.
 *
 * Counted from the effective date of the IEP in force, not from the date of the
 * last meeting -- a meeting that produced no signed document does not restart
 * the year.
 */
export const annualReviewTimeline: Rule = {
  id: 'iep.annual-review',
  title: 'IEP reviewed at least annually',
  citation: '34 CFR 300.324(b)(1)',
  source: 'federal',
  evaluate(ctx: RuleContext): Finding[] {
    const iep = activeIep(ctx)
    if (iep === null) return []

    const status = deadlineSeverity(ctx, iep.annualReviewDueOn)
    if (status === null) return []

    return [
      finding(
        this.id,
        ctx,
        status.severity,
        { kind: 'iep', id: iep.id },
        status.severity === 'violation'
          ? `Annual review is ${Math.abs(status.daysRemaining)} day(s) overdue. The IEP in effect has expired.`
          : `Annual review is due in ${status.daysRemaining} day(s).`,
        this.citation,
        {
          dueOn: iep.annualReviewDueOn,
          daysRemaining: status.daysRemaining,
          remedy: 'Schedule the annual review meeting and send notice to the parent.',
        },
      ),
    ]
  },
}

/** Reevaluation at least once every three years unless the team agrees otherwise. */
export const triennialReevaluationTimeline: Rule = {
  id: 'eval.triennial',
  title: 'Reevaluation conducted at least every three years',
  citation: '34 CFR 300.303(b)(2)',
  source: 'federal',
  evaluate(ctx: RuleContext): Finding[] {
    const last = latestCompletedEvaluation(ctx, ['initial', 'triennial', 'requested-reevaluation'])
    if (last === null || last.eligibilityDeterminedOn === null) return []

    const dueOn = addYears(last.eligibilityDeterminedOn, ctx.policy.reevaluationIntervalYears)

    // An in-flight reevaluation means the district is working the deadline.
    const inFlight = ctx.evaluations.some(
      (e) =>
        e.kind === 'triennial' &&
        e.eligibilityDeterminedOn === null &&
        e.status !== 'withdrawn' &&
        compareDates(e.referredOn, last.eligibilityDeterminedOn!) > 0,
    )
    if (inFlight) return []

    const status = deadlineSeverity(ctx, dueOn)
    if (status === null) return []

    return [
      finding(
        this.id,
        ctx,
        status.severity,
        { kind: 'evaluation', id: last.id },
        status.severity === 'violation'
          ? `Triennial reevaluation is ${Math.abs(status.daysRemaining)} day(s) overdue.`
          : `Triennial reevaluation is due in ${status.daysRemaining} day(s).`,
        this.citation,
        {
          dueOn,
          daysRemaining: status.daysRemaining,
          remedy:
            'Request parental consent for reevaluation, or document the team agreement that it is unnecessary.',
        },
      ),
    ]
  },
}

/**
 * Meeting notice must go out far enough ahead for the parent to attend.
 *
 * Evaluated against meetings that have already been held as well as upcoming
 * ones -- a short-notice meeting that already happened is a finding the
 * district needs to know about before the parent's advocate raises it.
 */
export const meetingNoticeLeadTime: Rule = {
  id: 'meeting.notice-lead-time',
  title: 'Parent received timely notice of the IEP meeting',
  citation: '34 CFR 300.322(a)(1)',
  source: 'federal',
  evaluate(ctx: RuleContext): Finding[] {
    const out: Finding[] = []
    const spec = ctx.policy.meetingNotice

    for (const meeting of ctx.meetings) {
      const meetingDate = meeting.heldOn ?? meeting.scheduledFor

      if (meeting.noticeSentOn === null) {
        out.push(
          finding(
            this.id,
            ctx,
            meeting.heldOn === null ? 'at-risk' : 'violation',
            { kind: 'meeting', id: meeting.id },
            `No meeting notice recorded for the ${meeting.purpose.replace(/-/g, ' ')} meeting on ${meetingDate}.`,
            this.citation,
            { remedy: 'Send written notice to the parent and record the date sent.' },
          ),
        )
        continue
      }

      // The parent can waive lead time by asking for the earlier date.
      if (meeting.parentRequestedReschedule) continue

      const earliestCompliantMeeting = addDaysOnBasis(
        ctx.calendar,
        meeting.noticeSentOn,
        spec.days,
        spec.basis,
      )

      if (compareDates(meetingDate, earliestCompliantMeeting) < 0) {
        out.push(
          finding(
            this.id,
            ctx,
            'violation',
            { kind: 'meeting', id: meeting.id },
            `Meeting notice was sent ${meeting.noticeSentOn} for a meeting on ${meetingDate}, short of the required ${spec.days} ${spec.basis} days.`,
            this.citation,
            {
              remedy:
                meeting.heldOn === null
                  ? `Reschedule to ${earliestCompliantMeeting} or later, or obtain written parental agreement to the earlier date.`
                  : 'Document parental agreement to the shortened notice, if it was given.',
            },
          ),
        )
      }
    }
    return out
  },
}

/**
 * Transition services must be in effect by the state's transition age.
 *
 * The obligation attaches to the IEP that will be in effect when the student
 * reaches that age, so the check runs a year ahead of the birthday rather than
 * on it.
 */
export const transitionPlanRequired: Rule = {
  id: 'iep.transition-plan',
  title: 'Transition plan in effect at the required age',
  citation: '34 CFR 300.320(b)',
  source: 'federal',
  evaluate(ctx: RuleContext): Finding[] {
    const iep = activeIep(ctx)
    if (iep === null) return []

    const transitionAge = ctx.policy.transitionPlanningAge
    const ageAtReview = ageOn(ctx.student.dateOfBirth, iep.annualReviewDueOn)
    if (ageAtReview < transitionAge) return []

    if (iep.transitionPlan !== null) return []

    const dueOn = birthdayAtAge(ctx.student.dateOfBirth, transitionAge)
    const overdue = compareDates(ctx.asOf, dueOn) > 0

    return [
      finding(
        this.id,
        ctx,
        overdue ? 'violation' : 'at-risk',
        { kind: 'iep', id: iep.id },
        `Student turns ${transitionAge} on ${dueOn} and the IEP in effect has no transition plan.`,
        `${this.citation} (${ctx.policy.stateName} transition age ${transitionAge})`,
        {
          dueOn,
          remedy:
            'Conduct age-appropriate transition assessments and add postsecondary goals before the IEP takes effect.',
        },
      ),
    ]
  },
}

/**
 * The student must be told their rights will transfer, at least a year before
 * they do. Districts miss this constantly because it is the one deadline keyed
 * to a birthday rather than to a document.
 */
export const ageOfMajorityNotice: Rule = {
  id: 'notice.age-of-majority',
  title: 'Student notified that rights transfer at the age of majority',
  citation: '34 CFR 300.320(c)',
  source: 'federal',
  evaluate(ctx: RuleContext): Finding[] {
    const majorityOn = birthdayAtAge(ctx.student.dateOfBirth, ctx.policy.ageOfMajority)
    const dueOn = addYears(majorityOn, -1)

    if (compareDates(ctx.asOf, dueOn) < 0) return []
    if (ctx.notices.some((n) => n.kind === 'age-of-majority')) return []
    if (ctx.student.decisionMakers.some((d) => d.kind === 'adult-student')) return []

    const status = deadlineSeverity(ctx, dueOn) ?? {
      severity: 'violation' as const,
      daysRemaining: daysBetween(ctx.asOf, dueOn),
    }

    return [
      finding(
        this.id,
        ctx,
        status.severity,
        { kind: 'student', id: ctx.student.id },
        `Student turns ${ctx.policy.ageOfMajority} on ${majorityOn} and has not been notified that their rights will transfer.`,
        this.citation,
        {
          dueOn,
          daysRemaining: status.daysRemaining,
          remedy: 'Provide written age-of-majority notice to both the student and the parent.',
        },
      ),
    ]
  },
}

export const TIMELINE_RULES: readonly Rule[] = [
  initialEvaluationTimeline,
  annualReviewTimeline,
  triennialReevaluationTimeline,
  meetingNoticeLeadTime,
  transitionPlanRequired,
  ageOfMajorityNotice,
]
