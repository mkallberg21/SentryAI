import type { CompliancePolicy } from '../types.js'

/**
 * The federal IDEA Part B baseline.
 *
 * Used directly for states that adopt the federal timelines without change, and
 * as the base every state pack spreads over. Where IDEA delegates a figure to
 * the states, the value here is the federal default or the most common state
 * practice, and the state pack is expected to override it.
 */
export const FEDERAL_POLICY: CompliancePolicy = {
  stateCode: 'US',
  stateName: 'Federal IDEA baseline',

  /** 34 CFR 300.301(c)(1)(i) -- 60 calendar days from receipt of consent. */
  initialEvaluation: { days: 60, basis: 'calendar' },

  /** 34 CFR 300.323(c)(1) -- IEP meeting within 30 days of determination. */
  evaluationToMeeting: { days: 30, basis: 'calendar' },

  /** 34 CFR 300.303(b)(2) -- at least once every three years. */
  reevaluationIntervalYears: 3,

  /** 34 CFR 300.324(b)(1) -- not less frequently than annually. */
  annualReviewIntervalDays: 365,

  /**
   * 34 CFR 300.322(a)(1) requires notice "early enough to ensure an
   * opportunity to attend" without naming a figure. Ten days is the most
   * common state operationalization and the defensible default.
   */
  meetingNotice: { days: 10, basis: 'calendar' },

  /** 34 CFR 300.503(a) -- a reasonable time before the action takes effect. */
  priorWrittenNotice: { days: 10, basis: 'calendar' },

  /** 34 CFR 300.530(e)(1) -- within 10 school days of the removal decision. */
  manifestationDetermination: { days: 10, basis: 'school' },

  /** 34 CFR 300.530(b)(1) -- more than 10 school days is a change of placement. */
  disciplinaryRemovalThresholdDays: 10,

  /** 34 CFR 300.320(b) -- in effect when the child turns 16. */
  transitionPlanningAge: 16,

  /** 34 CFR 300.520 -- states that transfer rights do so at the age of majority. */
  ageOfMajority: 18,

  evaluationTollsForExtendedBreaks: false,

  atRiskWindowDays: 21,
}
