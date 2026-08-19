import {
  APPROVER_ROLES,
  ApprovalError,
  type ApprovalAction,
  type ApprovalRequest,
} from '@sentryai/governance'
import type { Queryable, Session } from '../client.js'
import { appendAudit } from './audit.js'

/**
 * Approval requests, persisted.
 *
 * The governance package holds the state machine; this module holds the rows
 * and the audit writes. The separation-of-duties rule is enforced in three
 * places -- the pure function, this repository, and a CHECK constraint on the
 * table. That is deliberate redundancy on the one invariant whose failure makes
 * the whole dual-approval story worthless.
 */

interface ApprovalRow {
  id: string
  action: string
  subject_type: string
  subject_id: string
  student_id: string
  requested_by: string
  requested_by_role: string
  requested_at: Date
  justification: string
  state: string
  decided_by: string | null
  decided_by_role: string | null
  decided_at: Date | null
  decision_note: string | null
  expires_at: Date
}

function toRequest(row: ApprovalRow): ApprovalRequest {
  return {
    id: row.id,
    action: row.action as ApprovalAction,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    studentId: row.student_id,
    requestedBy: row.requested_by,
    requestedByRole: row.requested_by_role,
    requestedAt: row.requested_at.toISOString(),
    justification: row.justification,
    state: row.state as ApprovalRequest['state'],
    decidedBy: row.decided_by,
    decidedByRole: row.decided_by_role,
    decidedAt: row.decided_at?.toISOString() ?? null,
    decisionNote: row.decision_note,
    expiresAt: row.expires_at.toISOString(),
  }
}

export interface RequestInput {
  readonly action: ApprovalAction
  readonly subjectType: string
  readonly subjectId: string
  readonly studentId: string
  readonly justification: string
  /** How long the request stays decidable. Defaults to seven days. */
  readonly ttlHours?: number
}

export async function requestApproval(
  tx: Queryable,
  session: Session,
  input: RequestInput,
): Promise<ApprovalRequest> {
  if (input.justification.trim().length === 0) {
    throw new ApprovalError(
      'An approval request must state why the action is being taken.',
      'missing-justification',
    )
  }

  const expiresAt = new Date(Date.now() + (input.ttlHours ?? 24 * 7) * 3_600_000)

  const { rows } = await tx.query<ApprovalRow>(
    `INSERT INTO approval_requests (
       district_id, action, subject_type, subject_id, student_id,
       requested_by, requested_by_role, justification, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      session.districtId,
      input.action,
      input.subjectType,
      input.subjectId,
      input.studentId,
      session.userId,
      session.role,
      input.justification,
      expiresAt.toISOString(),
    ],
  )

  const request = toRequest(rows[0]!)

  await appendAudit(tx, session, {
    action: 'approval.requested',
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    studentId: input.studentId,
    reason: input.justification,
  })

  return request
}

export async function decideApproval(
  tx: Queryable,
  session: Session,
  requestId: string,
  outcome: 'approved' | 'denied',
  note: string | null,
): Promise<ApprovalRequest> {
  // Lock the row so two approvers cannot both decide a pending request.
  const { rows: current } = await tx.query<ApprovalRow>(
    'SELECT * FROM approval_requests WHERE id = $1 FOR UPDATE',
    [requestId],
  )
  const existing = current[0]
  if (existing === undefined) {
    throw new ApprovalError(`Approval request ${requestId} not found.`, 'not-pending')
  }

  if (existing.state !== 'pending') {
    throw new ApprovalError(
      `Request ${requestId} is already ${existing.state} and cannot be decided again.`,
      'not-pending',
    )
  }

  if (existing.expires_at.getTime() < Date.now()) {
    throw new ApprovalError(
      `Request ${requestId} expired at ${existing.expires_at.toISOString()}. Resubmit against current facts.`,
      'expired',
    )
  }

  if (existing.requested_by === session.userId) {
    throw new ApprovalError(
      'The person who requested this action cannot approve it. Dual approval requires a second person.',
      'self-approval',
    )
  }

  const permitted = APPROVER_ROLES[existing.action as ApprovalAction] ?? []
  if (!permitted.includes(session.role)) {
    throw new ApprovalError(
      `Role "${session.role}" cannot approve "${existing.action}". Permitted: ${permitted.join(', ')}.`,
      'role-not-permitted',
    )
  }

  if (outcome === 'denied' && (note === null || note.trim().length === 0)) {
    throw new ApprovalError(
      'A denial must record a reason, so the requester knows what to change.',
      'missing-justification',
    )
  }

  const { rows } = await tx.query<ApprovalRow>(
    `UPDATE approval_requests
        SET state = $2, decided_by = $3, decided_by_role = $4,
            decided_at = now(), decision_note = $5
      WHERE id = $1
      RETURNING *`,
    [requestId, outcome, session.userId, session.role, note],
  )

  await appendAudit(tx, session, {
    action: outcome === 'approved' ? 'approval.granted' : 'approval.denied',
    subjectType: existing.subject_type,
    subjectId: existing.subject_id,
    studentId: existing.student_id,
    reason: note,
  })

  return toRequest(rows[0]!)
}

export async function listPendingApprovals(tx: Queryable): Promise<ApprovalRequest[]> {
  const { rows } = await tx.query<ApprovalRow>(
    `SELECT * FROM approval_requests
      WHERE state = 'pending' AND expires_at > now()
      ORDER BY requested_at ASC`,
  )
  return rows.map(toRequest)
}
