import type { CompliancePolicy } from '../types.js'
import { FEDERAL_POLICY } from './federal.js'

/**
 * Texas.
 *
 * Texas counts its evaluation timeline in school days rather than calendar
 * days, which is the reason the day-counting logic is basis-aware rather than
 * arithmetic on dates. A 45-school-day clock started in early May does not end
 * in June -- it ends the following September, and a district that assumes
 * otherwise misses it every spring.
 *
 * Texas also begins transition planning at 14, two years ahead of the federal
 * floor, so students transfer in from other states already behind.
 */
export const TEXAS_POLICY: CompliancePolicy = {
  ...FEDERAL_POLICY,
  stateCode: 'TX',
  stateName: 'Texas',

  /** TEC 29.004(a) -- 45 school days from consent to the written report. */
  initialEvaluation: { days: 45, basis: 'school' },

  /** TEC 29.005(a) -- ARD committee meeting within 30 calendar days of the report. */
  evaluationToMeeting: { days: 30, basis: 'calendar' },

  /** 19 TAC 89.1045(a) -- written notice of the ARD meeting 5 school days ahead. */
  meetingNotice: { days: 5, basis: 'school' },

  /** TEC 29.011 -- transition planning begins at 14 in Texas. */
  transitionPlanningAge: 14,
}
