import { describe, expect, it } from 'vitest'
import { approve, ApprovalError, createRequest, deny, type ApprovalRequest } from './approval.js'
import { AuditLog, GENESIS_HASH, verifyChain, type AuditEntry } from './audit.js'
import {
  DecryptionError,
  LocalKeyProvider,
  decryptField,
  encryptField,
  type FieldContext,
} from './encryption.js'

describe('audit log', () => {
  const entry = (overrides: Partial<Parameters<AuditLog['append']>[0]> = {}) => ({
    at: '2026-03-14T10:00:00.000Z',
    actorId: 'user-1',
    actorRole: 'case-manager',
    action: 'record.viewed' as const,
    subjectType: 'iep',
    subjectId: 'iep-1',
    studentId: 'student-1',
    changedFields: [],
    reason: null,
    ...overrides,
  })

  it('chains the first entry to the genesis hash', () => {
    const log = new AuditLog()
    const first = log.append(entry())
    expect(first.sequence).toBe(0)
    expect(first.previousHash).toBe(GENESIS_HASH)
    expect(log.verify().valid).toBe(true)
  })

  it('verifies a long chain', () => {
    const log = new AuditLog()
    for (let i = 0; i < 50; i += 1) {
      log.append(entry({ subjectId: `iep-${i}` }))
    }
    expect(log.length).toBe(50)
    expect(log.verify()).toEqual({ valid: true, brokenAt: null, reason: null })
  })

  it('detects an entry altered in place', () => {
    const log = new AuditLog()
    log.append(entry())
    log.append(entry({ action: 'record.updated', changedFields: ['goals'] }))
    log.append(entry({ action: 'document.signed' }))

    const tampered = [...log.entries] as AuditEntry[]
    // Someone edits the log to hide who signed the document.
    tampered[2] = { ...tampered[2]!, actorId: 'someone-else' }

    const result = verifyChain(tampered)
    expect(result.valid).toBe(false)
    expect(result.brokenAt).toBe(2)
    expect(result.reason).toContain('altered after it was written')
  })

  it('detects a deleted entry', () => {
    const log = new AuditLog()
    log.append(entry())
    log.append(entry({ action: 'access.denied' }))
    log.append(entry({ action: 'record.exported' }))

    const withHole = [log.entries[0]!, log.entries[2]!]
    const result = verifyChain(withHole)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('removed or reordered')
  })

  it('detects reordering even when every entry is otherwise intact', () => {
    const log = new AuditLog()
    log.append(entry())
    log.append(entry({ action: 'approval.granted' }))

    const swapped = [log.entries[1]!, log.entries[0]!]
    expect(verifyChain(swapped).valid).toBe(false)
  })

  it('isolates one student’s disclosure log', () => {
    const log = new AuditLog()
    log.append(entry({ studentId: 'student-1' }))
    log.append(entry({ studentId: 'student-2' }))
    log.append(entry({ studentId: 'student-1', action: 'record.exported' }))

    const forStudent = log.forStudent('student-1')
    expect(forStudent).toHaveLength(2)
    expect(forStudent.every((e) => e.studentId === 'student-1')).toBe(true)
  })

  it('records field names but never values', () => {
    const log = new AuditLog()
    const written = log.append(
      entry({ action: 'record.updated', changedFields: ['primaryDisability', 'presentLevels'] }),
    )
    // The audit entry must not become a second copy of the student record.
    expect(JSON.stringify(written)).not.toContain('specific-learning-disability')
    expect(written.changedFields).toEqual(['primaryDisability', 'presentLevels'])
  })
})

describe('field encryption', () => {
  const keys = LocalKeyProvider.generate()
  const context: FieldContext = {
    studentId: 'student-1',
    recordType: 'iep',
    recordId: 'iep-1',
    fieldName: 'presentLevels',
  }

  it('round-trips a value', () => {
    const encrypted = encryptField('Reads at a fourth-grade level.', context, keys)
    expect(decryptField(encrypted, context, keys)).toBe('Reads at a fourth-grade level.')
  })

  it('does not leak plaintext into the stored shape', () => {
    const encrypted = encryptField('emotional disturbance', context, keys)
    expect(JSON.stringify(encrypted)).not.toContain('emotional')
  })

  it('produces different ciphertext for the same plaintext each time', () => {
    const a = encryptField('same value', context, keys)
    const b = encryptField('same value', context, keys)
    expect(a.ciphertext).not.toBe(b.ciphertext)
  })

  it('refuses to decrypt under a different student', () => {
    const encrypted = encryptField('Reads at a fourth-grade level.', context, keys)
    expect(() =>
      decryptField(encrypted, { ...context, studentId: 'student-2' }, keys),
    ).toThrow(DecryptionError)
  })

  it('refuses to decrypt as a different field', () => {
    const encrypted = encryptField('Reads at a fourth-grade level.', context, keys)
    expect(() =>
      decryptField(encrypted, { ...context, fieldName: 'presentLevelsOfSomeoneElse' }, keys),
    ).toThrow(DecryptionError)
  })

  it('refuses to decrypt tampered ciphertext', () => {
    const encrypted = encryptField('120 minutes weekly', context, keys)
    const bytes = Buffer.from(encrypted.ciphertext, 'base64')
    bytes[0] = bytes[0]! ^ 0xff
    expect(() =>
      decryptField({ ...encrypted, ciphertext: bytes.toString('base64') }, context, keys),
    ).toThrow(DecryptionError)
  })

  it('does not disclose why decryption failed', () => {
    const encrypted = encryptField('secret', context, keys)
    try {
      decryptField(encrypted, { ...context, studentId: 'student-2' }, keys)
      expect.unreachable('decryption should have failed')
    } catch (error) {
      expect((error as Error).message).not.toContain('student-2')
      expect((error as Error).message).not.toContain('secret')
    }
  })

  it('refuses to run the local key provider in production', () => {
    expect(() => new LocalKeyProvider(Buffer.alloc(32), 'production')).toThrow(/production/)
  })

  it('rejects a key of the wrong length', () => {
    expect(() => new LocalKeyProvider(Buffer.alloc(16), 'development')).toThrow(/32 bytes/)
  })
})

describe('dual approval', () => {
  const base = (): ApprovalRequest =>
    createRequest({
      id: 'req-1',
      action: 'finalize-iep',
      subjectType: 'iep',
      subjectId: 'iep-1',
      studentId: 'student-1',
      requestedBy: 'user-case-manager',
      requestedByRole: 'case-manager',
      requestedAt: '2026-03-14T10:00:00.000Z',
      justification: 'Annual review completed; team reached agreement.',
      expiresAt: '2026-03-21T10:00:00.000Z',
    })

  const decision = {
    approverId: 'user-director',
    approverRole: 'special-education-director',
    at: '2026-03-15T09:00:00.000Z',
    note: null,
  }

  it('approves when a permitted second person signs off', () => {
    const approved = approve(base(), decision)
    expect(approved.state).toBe('approved')
    expect(approved.decidedBy).toBe('user-director')
  })

  it('blocks the requester from approving their own request', () => {
    expect(() =>
      approve(base(), { ...decision, approverId: 'user-case-manager' }),
    ).toThrowError(
      expect.objectContaining({ code: 'self-approval' }) as unknown as ApprovalError,
    )
  })

  it('blocks a role that is not permitted to approve the action', () => {
    expect(() =>
      approve(base(), { ...decision, approverRole: 'paraprofessional' }),
    ).toThrowError(expect.objectContaining({ code: 'role-not-permitted' }) as unknown as ApprovalError)
  })

  it('blocks approval of a stale request', () => {
    expect(() =>
      approve(base(), { ...decision, at: '2026-04-01T09:00:00.000Z' }),
    ).toThrowError(expect.objectContaining({ code: 'expired' }) as unknown as ApprovalError)
  })

  it('cannot decide the same request twice', () => {
    const approved = approve(base(), decision)
    expect(() => approve(approved, { ...decision, approverId: 'user-other' })).toThrowError(
      expect.objectContaining({ code: 'not-pending' }) as unknown as ApprovalError,
    )
  })

  it('requires a reason on denial', () => {
    expect(() => deny(base(), decision)).toThrowError(
      expect.objectContaining({ code: 'missing-justification' }) as unknown as ApprovalError,
    )
    const denied = deny(base(), { ...decision, note: 'Goals are not measurable as written.' })
    expect(denied.state).toBe('denied')
    expect(denied.decisionNote).toContain('not measurable')
  })

  it('requires a justification on the request itself', () => {
    expect(() =>
      createRequest({ ...base(), justification: '   ' }),
    ).toThrowError(expect.objectContaining({ code: 'missing-justification' }) as unknown as ApprovalError)
  })
})
