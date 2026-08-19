import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Append-only, hash-chained audit log.
 *
 * Note the distinction from "immutable records," which is a claim SentryAI
 * deliberately does not make. FERPA gives parents the right to request
 * amendment of education records, and several state privacy laws require
 * deletion at contract termination -- so the *record* must be correctable and
 * erasable. What is immutable is the *log*: every read, write, correction, and
 * deletion is chained, so a change can be made but never made to look like it
 * did not happen.
 *
 * Each entry commits to its predecessor's hash. Altering or removing any entry
 * breaks every hash after it, which `verifyChain` detects.
 */

export type AuditAction =
  | 'record.created'
  | 'record.viewed'
  | 'record.updated'
  | 'record.corrected'
  | 'record.deleted'
  | 'record.exported'
  | 'document.signed'
  | 'approval.requested'
  | 'approval.granted'
  | 'approval.denied'
  | 'ai.draft.generated'
  | 'ai.draft.accepted'
  | 'ai.draft.rejected'
  | 'consent.recorded'
  | 'notice.sent'
  | 'access.denied'

export interface AuditEntry {
  readonly sequence: number
  /** ISO-8601 instant. Audit time is a real instant, unlike IEP calendar dates. */
  readonly at: string
  readonly actorId: string
  readonly actorRole: string
  readonly action: AuditAction
  readonly subjectType: string
  readonly subjectId: string
  /** The student whose record was touched, for per-student disclosure logs. */
  readonly studentId: string | null
  /**
   * What changed. Field names only -- never values. An audit log that records
   * the old and new value of a field becomes a second, less protected copy of
   * the student record, which is exactly what it must not be.
   */
  readonly changedFields: readonly string[]
  readonly reason: string | null
  readonly previousHash: string
  readonly hash: string
}

export type AuditInput = Omit<AuditEntry, 'sequence' | 'hash' | 'previousHash'>

/** The hash of the empty chain. */
export const GENESIS_HASH = '0'.repeat(64)

function canonicalize(
  entry: Omit<AuditEntry, 'hash'>,
): string {
  // Deterministic field order. JSON.stringify over an object literal would
  // depend on insertion order, which is not a property worth betting an
  // integrity proof on.
  return [
    entry.sequence,
    entry.at,
    entry.actorId,
    entry.actorRole,
    entry.action,
    entry.subjectType,
    entry.subjectId,
    entry.studentId ?? '',
    [...entry.changedFields].sort().join(','),
    entry.reason ?? '',
    entry.previousHash,
  ].join('')
}

export function hashEntry(entry: Omit<AuditEntry, 'hash'>): string {
  return createHash('sha256').update(canonicalize(entry), 'utf8').digest('hex')
}

export interface ChainVerification {
  readonly valid: boolean
  /** Sequence number of the first entry that fails verification. */
  readonly brokenAt: number | null
  readonly reason: string | null
}

/**
 * An append-only log held in memory.
 *
 * The persistence layer stores these rows in a table with no UPDATE or DELETE
 * grant for the application role; this class is the shape the rest of the
 * system codes against, and the test surface for the chaining logic itself.
 */
export class AuditLog {
  #entries: AuditEntry[] = []

  get length(): number {
    return this.#entries.length
  }

  get entries(): readonly AuditEntry[] {
    return this.#entries
  }

  get headHash(): string {
    return this.#entries.at(-1)?.hash ?? GENESIS_HASH
  }

  append(input: AuditInput): AuditEntry {
    const unhashed = {
      ...input,
      sequence: this.#entries.length,
      previousHash: this.headHash,
    }
    const entry: AuditEntry = { ...unhashed, hash: hashEntry(unhashed) }
    this.#entries.push(entry)
    return entry
  }

  /** Every entry touching one student, for a FERPA disclosure request. */
  forStudent(studentId: string): AuditEntry[] {
    return this.#entries.filter((e) => e.studentId === studentId)
  }

  verify(): ChainVerification {
    return verifyChain(this.#entries)
  }
}

export function verifyChain(entries: readonly AuditEntry[]): ChainVerification {
  let expectedPrevious = GENESIS_HASH

  for (const [index, entry] of entries.entries()) {
    if (entry.sequence !== index) {
      return {
        valid: false,
        brokenAt: index,
        reason: `Entry at position ${index} claims sequence ${entry.sequence}; an entry was removed or reordered.`,
      }
    }

    if (entry.previousHash !== expectedPrevious) {
      return {
        valid: false,
        brokenAt: entry.sequence,
        reason: `Entry ${entry.sequence} does not chain to its predecessor.`,
      }
    }

    const recomputed = hashEntry({
      sequence: entry.sequence,
      at: entry.at,
      actorId: entry.actorId,
      actorRole: entry.actorRole,
      action: entry.action,
      subjectType: entry.subjectType,
      subjectId: entry.subjectId,
      studentId: entry.studentId,
      changedFields: entry.changedFields,
      reason: entry.reason,
      previousHash: entry.previousHash,
    })

    const a = Buffer.from(recomputed, 'hex')
    const b = Buffer.from(entry.hash, 'hex')
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return {
        valid: false,
        brokenAt: entry.sequence,
        reason: `Entry ${entry.sequence} was altered after it was written.`,
      }
    }

    expectedPrevious = entry.hash
  }

  return { valid: true, brokenAt: null, reason: null }
}
