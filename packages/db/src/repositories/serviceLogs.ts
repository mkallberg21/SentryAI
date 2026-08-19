import type { KeyProvider } from '@sentryai/governance'
import type { Queryable, Session } from '../client.js'
import { fieldContext, sealed } from '../crypto.js'
import { appendAudit } from './audit.js'

/**
 * Service delivery logging.
 *
 * The write path that matters most for districts: these rows are simultaneously
 * the evidence that the offer of FAPE was delivered and the substantiating
 * document for a Medicaid claim. An unsigned or narrative-less log is neither.
 */

export interface ServiceLogInput {
  readonly serviceId: string
  readonly studentId: string
  readonly deliveredOn: string
  readonly minutesDelivered: number
  readonly providerId: string
  readonly providerCredential: string
  readonly setting: 'general-education' | 'special-education' | 'other'
  readonly groupSize: number
  readonly narrative: string
  readonly status: 'delivered' | 'student-absent' | 'provider-absent' | 'cancelled'
}

export async function recordServiceLog(
  tx: Queryable,
  session: Session,
  keys: KeyProvider,
  input: ServiceLogInput,
): Promise<{ id: string }> {
  if (input.status === 'delivered' && input.minutesDelivered <= 0) {
    throw new Error('A delivered session must record more than zero minutes.')
  }

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO service_logs (
       district_id, service_id, student_id, delivered_on, minutes_delivered,
       provider_id, provider_credential, setting, group_size, status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      session.districtId,
      input.serviceId,
      input.studentId,
      input.deliveredOn,
      input.minutesDelivered,
      input.providerId,
      input.providerCredential,
      input.setting,
      input.groupSize,
      input.status,
    ],
  )

  const id = rows[0]!.id

  // Encrypted in a second statement because the AAD binds to the row id, which
  // the database assigns. Same transaction, so a failure leaves nothing behind.
  await tx.query('UPDATE service_logs SET narrative_encrypted = $2 WHERE id = $1', [
    id,
    sealed(
      input.narrative,
      fieldContext(input.studentId, 'service-log', id, 'narrative'),
      keys,
    ),
  ])

  await appendAudit(tx, session, {
    action: 'record.created',
    subjectType: 'service-log',
    subjectId: id,
    studentId: input.studentId,
    changedFields: ['minutesDelivered', 'status', 'narrative'],
  })

  return { id }
}

/**
 * Sign a service log, which locks it and makes it claimable.
 *
 * Only the delivering provider may sign. A log signed by anyone else is not
 * evidence that the service happened, and would not survive a Medicaid audit.
 */
export async function signServiceLog(
  tx: Queryable,
  session: Session,
  logId: string,
): Promise<void> {
  const { rows } = await tx.query<{ provider_id: string; student_id: string; signed_on: Date | null }>(
    'SELECT provider_id, student_id, signed_on FROM service_logs WHERE id = $1 FOR UPDATE',
    [logId],
  )
  const log = rows[0]
  if (log === undefined) throw new Error(`Service log ${logId} not found.`)

  if (log.signed_on !== null) {
    throw new Error('This service log is already signed and cannot be signed again.')
  }

  if (log.provider_id !== session.userId) {
    throw new Error(
      'Only the provider who delivered the session may sign its log.',
    )
  }

  await tx.query('UPDATE service_logs SET signed_on = CURRENT_DATE WHERE id = $1', [logId])

  await appendAudit(tx, session, {
    action: 'document.signed',
    subjectType: 'service-log',
    subjectId: logId,
    studentId: log.student_id,
    changedFields: ['signedOn'],
  })
}

export interface MedicaidGap {
  readonly studentId: string
  readonly logId: string
  readonly deliveredOn: string
  readonly missing: string[]
}

/**
 * Delivered, billable sessions that cannot be claimed as documented.
 *
 * Runs district-wide within RLS scope, so a director sees recoverable revenue
 * across every caseload while a case manager sees only their own.
 */
export async function findMedicaidGaps(tx: Queryable): Promise<MedicaidGap[]> {
  const { rows } = await tx.query(
    `SELECT l.id, l.student_id, l.delivered_on,
            (l.signed_on IS NULL) AS missing_signature,
            (btrim(coalesce(l.provider_credential, '')) = '') AS missing_credential,
            (l.narrative_encrypted IS NULL) AS missing_narrative
       FROM service_logs l
       JOIN services s ON s.id = l.service_id
       JOIN consents c ON c.student_id = l.student_id
                      AND c.kind = 'medicaid-billing'
                      AND c.response = 'granted'
      WHERE s.medicaid_billable = true
        AND l.status = 'delivered'
        AND (l.signed_on IS NULL
             OR btrim(coalesce(l.provider_credential, '')) = ''
             OR l.narrative_encrypted IS NULL)
      ORDER BY l.delivered_on DESC`,
  )

  return (rows as Record<string, unknown>[]).map((r) => {
    const missing: string[] = []
    if (r['missing_signature']) missing.push('provider signature')
    if (r['missing_credential']) missing.push('provider credential')
    if (r['missing_narrative']) missing.push('session narrative')
    const deliveredOn = r['delivered_on'] as Date
    return {
      studentId: r['student_id'] as string,
      logId: r['id'] as string,
      deliveredOn: `${deliveredOn.getFullYear()}-${String(deliveredOn.getMonth() + 1).padStart(2, '0')}-${String(deliveredOn.getDate()).padStart(2, '0')}`,
      missing,
    }
  })
}
