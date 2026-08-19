import type { CompliancePolicy } from '../types.js'
import { FEDERAL_POLICY } from './federal.js'

/**
 * California.
 *
 * Two differences from the federal baseline drive most of the behavior:
 *
 * 1. California runs a single 60-day clock from receipt of consent all the way
 *    to the IEP meeting (Ed Code 56344(a)), rather than the federal split of
 *    60 days to eligibility plus 30 more to the meeting. `evaluationToMeeting`
 *    is therefore null -- a second clock here would double-count.
 *
 * 2. That clock excludes school vacations longer than five schooldays, which is
 *    why `evaluationTollsForExtendedBreaks` is on. Without it the engine flags
 *    every district with a February break as late.
 */
export const CALIFORNIA_POLICY: CompliancePolicy = {
  ...FEDERAL_POLICY,
  stateCode: 'CA',
  stateName: 'California',

  /** Ed Code 56344(a) -- 60 calendar days from consent to the IEP meeting. */
  initialEvaluation: { days: 60, basis: 'calendar' },
  evaluationToMeeting: null,

  evaluationTollsForExtendedBreaks: true,

  /** Ed Code 56341.5(b) -- notice early enough to ensure an opportunity to attend. */
  meetingNotice: { days: 10, basis: 'calendar' },

  /** Ed Code 56345(a)(8) -- transition services beginning at age 16. */
  transitionPlanningAge: 16,
}

/**
 * Days a California district has to deliver a proposed assessment plan after
 * receiving a referral. Ed Code 56321(a). This is a California-only obligation
 * with no federal analogue, so it lives here rather than in the policy shape.
 */
export const CA_ASSESSMENT_PLAN_DAYS = 15
