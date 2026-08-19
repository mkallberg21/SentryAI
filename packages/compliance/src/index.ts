export * from './calendar.js'
export * from './engine.js'
export * from './types.js'
export { FEDERAL_POLICY } from './packs/federal.js'
export { CALIFORNIA_POLICY, CA_ASSESSMENT_PLAN_DAYS } from './packs/california.js'
export { TEXAS_POLICY } from './packs/texas.js'
export { TIMELINE_RULES } from './rules/timelines.js'
export { DOCUMENT_RULES } from './rules/documents.js'
export { SERVICE_RULES } from './rules/services.js'

import { CALIFORNIA_POLICY } from './packs/california.js'
import { FEDERAL_POLICY } from './packs/federal.js'
import { TEXAS_POLICY } from './packs/texas.js'
import type { CompliancePolicy } from './types.js'

/**
 * State packs, keyed by postal code.
 *
 * Adding a state means adding a policy here (and any rules unique to that
 * state), not touching the engine. That constraint is deliberate: the moment
 * state-specific logic leaks into the rules, the fiftieth state costs as much
 * as the first.
 */
export const STATE_PACKS: ReadonlyMap<string, CompliancePolicy> = new Map([
  ['US', FEDERAL_POLICY],
  ['CA', CALIFORNIA_POLICY],
  ['TX', TEXAS_POLICY],
])

export function policyForState(stateCode: string): CompliancePolicy {
  const policy = STATE_PACKS.get(stateCode.toUpperCase())
  if (policy === undefined) {
    throw new Error(
      `No compliance pack for "${stateCode}". Available: ${[...STATE_PACKS.keys()].join(', ')}. Running a district on the federal baseline when the state has its own timelines produces wrong deadlines, so this fails loudly rather than defaulting.`,
    )
  }
  return policy
}
