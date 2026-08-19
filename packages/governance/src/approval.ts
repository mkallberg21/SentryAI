/**
 * Dual approval for legally operative actions.
 *
 * Some actions in a special education record cannot be undone once they leave
 * the building: a signed IEP is an offer of FAPE, a sent Prior Written Notice
 * starts a clock, an eligibility determination changes a child's legal status.
 * Those require a second credentialed person to approve.
 *
 * The rule that gives this teeth is separation of duties -- the requester
 * cannot be the approver. Without it, dual approval is a checkbox that one
 * person clicks twice.
 */

export type ApprovalAction =
  | 'finalize-iep'
  | 'send-prior-written-notice'
  | 'determine-eligibility'
  | 'exit-student-from-services'
  | 'change-placement'
  | 'delete-record'
  | 'export-student-data'

export type ApprovalState = 'pending' | 'approved' | 'denied' | 'withdrawn' | 'expired'

/**
 * Roles permitted to approve each action. A case manager can request anything
 * but can finalize nothing on their own -- which is also a protection for
 * them, since it means no single teacher carries the district's legal exposure.
 */
export const APPROVER_ROLES: Readonly<Record<ApprovalAction, readonly string[]>> = {
  'finalize-iep': ['special-education-director', 'program-specialist', 'lea-representative'],
  'send-prior-written-notice': ['special-education-director', 'program-specialist', 'lea-representative'],
  'determine-eligibility': ['special-education-director', 'school-psychologist', 'program-specialist'],
  'exit-student-from-services': ['special-education-director', 'program-specialist'],
  'change-placement': ['special-education-director', 'program-specialist'],
  'delete-record': ['special-education-director', 'district-administrator'],
  'export-student-data': ['special-education-director', 'district-administrator'],
}

export interface ApprovalRequest {
  readonly id: string
  readonly action: ApprovalAction
  readonly subjectType: string
  readonly subjectId: string
  readonly studentId: string
  readonly requestedBy: string
  readonly requestedByRole: string
  readonly requestedAt: string
  /** Why this action is being taken. Carried onto the audit entry. */
  readonly justification: string
  readonly state: ApprovalState
  readonly decidedBy: string | null
  readonly decidedByRole: string | null
  readonly decidedAt: string | null
  readonly decisionNote: string | null
  /** Requests go stale; an approval granted against month-old facts is not one. */
  readonly expiresAt: string
}

export class ApprovalError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'self-approval'
      | 'role-not-permitted'
      | 'not-pending'
      | 'expired'
      | 'missing-justification',
  ) {
    super(message)
    this.name = 'ApprovalError'
  }
}

export interface Decision {
  readonly approverId: string
  readonly approverRole: string
  readonly at: string
  readonly note: string | null
}

function assertDecidable(request: ApprovalRequest, decision: Decision): void {
  if (request.state !== 'pending') {
    throw new ApprovalError(
      `Request ${request.id} is already ${request.state} and cannot be decided again.`,
      'not-pending',
    )
  }

  if (decision.at > request.expiresAt) {
    throw new ApprovalError(
      `Request ${request.id} expired at ${request.expiresAt}. Resubmit against current facts.`,
      'expired',
    )
  }

  if (decision.approverId === request.requestedBy) {
    throw new ApprovalError(
      'The person who requested this action cannot approve it. Dual approval requires a second person.',
      'self-approval',
    )
  }

  const permitted = APPROVER_ROLES[request.action]
  if (!permitted.includes(decision.approverRole)) {
    throw new ApprovalError(
      `Role "${decision.approverRole}" cannot approve "${request.action}". Permitted: ${permitted.join(', ')}.`,
      'role-not-permitted',
    )
  }
}

export function createRequest(
  input: Omit<ApprovalRequest, 'state' | 'decidedBy' | 'decidedByRole' | 'decidedAt' | 'decisionNote'>,
): ApprovalRequest {
  if (input.justification.trim().length === 0) {
    throw new ApprovalError(
      'An approval request must state why the action is being taken.',
      'missing-justification',
    )
  }
  return {
    ...input,
    state: 'pending',
    decidedBy: null,
    decidedByRole: null,
    decidedAt: null,
    decisionNote: null,
  }
}

export function approve(request: ApprovalRequest, decision: Decision): ApprovalRequest {
  assertDecidable(request, decision)
  return {
    ...request,
    state: 'approved',
    decidedBy: decision.approverId,
    decidedByRole: decision.approverRole,
    decidedAt: decision.at,
    decisionNote: decision.note,
  }
}

export function deny(request: ApprovalRequest, decision: Decision): ApprovalRequest {
  assertDecidable(request, decision)
  if (decision.note === null || decision.note.trim().length === 0) {
    throw new ApprovalError(
      'A denial must record a reason, so the requester knows what to change.',
      'missing-justification',
    )
  }
  return {
    ...request,
    state: 'denied',
    decidedBy: decision.approverId,
    decidedByRole: decision.approverRole,
    decidedAt: decision.at,
    decisionNote: decision.note,
  }
}

export function requiresDualApproval(action: string): action is ApprovalAction {
  return action in APPROVER_ROLES
}
