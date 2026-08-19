import { GENESIS_HASH, hashEntry, verifyChain, type AuditAction, type AuditEntry } from '@sentryai/governance'
import type { Queryable, Session } from '../client.js'

/**
 * Persistent, per-district hash chain.
 *
 * The chain is scoped per district rather than globally so one district's
 * verification does not depend on another's rows, and so a district can be
 * exported or deleted without breaking everyone else's proof.
 *
 * Sequence allocation is serialized by a row lock on the district. Two
 * concurrent writers grabbing the same head hash would produce two entries
 * claiming the same predecessor -- a fork that `verifyChain` reports as
 * tampering even though nobody tampered.
 */

export interface AuditInput {
  readonly action: AuditAction
  readonly subjectType: string
  readonly subjectId: string
  readonly studentId: string | null
  readonly changedFields?: readonly string[]
  readonly reason?: string | null
}

interface AuditRow {
  sequence: string
  at: Date
  actor_id: string | null
  actor_role: string
  action: string
  subject_type: string
  subject_id: string
  student_id: string | null
  changed_fields: string[]
  reason: string | null
  previous_hash: string
  hash: string
}

function toEntry(row: AuditRow): AuditEntry {
  return {
    sequence: Number(row.sequence),
    at: row.at.toISOString(),
    actorId: row.actor_id ?? '',
    actorRole: row.actor_role,
    action: row.action as AuditAction,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    studentId: row.student_id,
    changedFields: row.changed_fields,
    reason: row.reason,
    previousHash: row.previous_hash,
    hash: row.hash,
  }
}

export async function appendAudit(
  tx: Queryable,
  session: Session,
  input: AuditInput,
): Promise<AuditEntry> {
  // Serialize sequence allocation for this district. Held until the
  // transaction commits.
  await tx.query('SELECT id FROM districts WHERE id = $1 FOR UPDATE', [session.districtId])

  const { rows: headRows } = await tx.query<{ sequence: string; hash: string }>(
    'SELECT sequence, hash FROM audit_log WHERE district_id = $1 ORDER BY sequence DESC LIMIT 1',
    [session.districtId],
  )
  const head = headRows[0]
  const sequence = head === undefined ? 0 : Number(head.sequence) + 1
  const previousHash = head?.hash ?? GENESIS_HASH

  const at = new Date().toISOString()
  const changedFields = input.changedFields ?? []

  const hash = hashEntry({
    sequence,
    at,
    actorId: session.userId,
    actorRole: session.role,
    action: input.action,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    studentId: input.studentId,
    changedFields,
    reason: input.reason ?? null,
    previousHash,
  })

  const { rows } = await tx.query<AuditRow>(
    `INSERT INTO audit_log (
       district_id, sequence, at, actor_id, actor_role, action,
       subject_type, subject_id, student_id, changed_fields, reason,
       previous_hash, hash
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING sequence, at, actor_id, actor_role, action, subject_type,
               subject_id, student_id, changed_fields, reason, previous_hash, hash`,
    [
      session.districtId,
      sequence,
      at,
      session.userId,
      session.role,
      input.action,
      input.subjectType,
      input.subjectId,
      input.studentId,
      changedFields,
      input.reason ?? null,
      previousHash,
      hash,
    ],
  )

  return toEntry(rows[0]!)
}

export async function readAuditChain(
  tx: Queryable,
  districtId: string,
): Promise<AuditEntry[]> {
  const { rows } = await tx.query<AuditRow>(
    `SELECT sequence, at, actor_id, actor_role, action, subject_type,
            subject_id, student_id, changed_fields, reason, previous_hash, hash
       FROM audit_log WHERE district_id = $1 ORDER BY sequence ASC`,
    [districtId],
  )
  return rows.map(toEntry)
}

/** The disclosure record for one student, as FERPA contemplates. */
export async function readStudentAudit(
  tx: Queryable,
  studentId: string,
): Promise<AuditEntry[]> {
  const { rows } = await tx.query<AuditRow>(
    `SELECT sequence, at, actor_id, actor_role, action, subject_type,
            subject_id, student_id, changed_fields, reason, previous_hash, hash
       FROM audit_log WHERE student_id = $1 ORDER BY sequence ASC`,
    [studentId],
  )
  return rows.map(toEntry)
}

export async function verifyDistrictChain(tx: Queryable, districtId: string) {
  return verifyChain(await readAuditChain(tx, districtId))
}
