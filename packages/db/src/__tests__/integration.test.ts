import { evaluateStudent } from '@sentryai/compliance'
import { plainDate } from '@sentryai/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { withoutTenantScope, withTenant, type Session } from '../client.js'
import { loadRuleContext } from '../context.js'
import { decideApproval, requestApproval } from '../repositories/approvals.js'
import { appendAudit, readStudentAudit, verifyDistrictChain } from '../repositories/audit.js'
import { findMedicaidGaps, recordServiceLog, signServiceLog } from '../repositories/serviceLogs.js'
import { listCaseload } from '../repositories/students.js'
import { hasDatabase, seedDistrict, setupHarness, type Harness, type SeededDistrict } from './harness.js'

/**
 * These tests need a real Postgres. Row-level security, the append-only audit
 * trigger, and the separation-of-duties CHECK constraint are all database
 * behavior -- mocking them would test the mock.
 *
 * CI provides one as a service container. Locally, set DATABASE_URL.
 */
const suite = hasDatabase ? describe : describe.skip

if (!hasDatabase) {
  console.warn(
    '\n  DATABASE_URL not set — skipping database integration tests.\n' +
      '  Run them with: DATABASE_URL=postgres://user:pass@localhost:5432/sentryai_test npm test\n',
  )
}

suite('database integration', () => {
  let h: Harness
  let districtA: SeededDistrict
  let districtB: SeededDistrict

  const director = (d: SeededDistrict): Session => ({
    districtId: d.districtId,
    userId: d.directorId,
    role: 'special-education-director',
  })

  const caseManager = (d: SeededDistrict): Session => ({
    districtId: d.districtId,
    userId: d.caseManagerId,
    role: 'case-manager',
  })

  beforeAll(async () => {
    h = await setupHarness()
    await withoutTenantScope(h.admin, async (tx) => {
      districtA = await seedDistrict(tx, h.keys, { stateCode: 'CA' })
      districtB = await seedDistrict(tx, h.keys, { stateCode: 'TX' })
    })
  }, 60_000)

  afterAll(async () => {
    await h?.close()
  })

  describe('row-level security', () => {
    it('shows a district only its own students', async () => {
      const seen = await withTenant(h.app, director(districtA), (tx) => listCaseload(tx))
      const ids = seen.map((s) => s.id)
      expect(ids).toContain(districtA.studentId)
      expect(ids).not.toContain(districtB.studentId)
    })

    it('returns nothing for a student in another district, even by direct id', async () => {
      const rows = await withTenant(h.app, director(districtA), (tx) =>
        tx.query('SELECT id FROM students WHERE id = $1', [districtB.studentId]),
      )
      expect(rows.rowCount).toBe(0)
    })

    it('refuses to load a cross-district student through the context loader', async () => {
      await expect(
        withTenant(h.app, director(districtA), (tx) =>
          loadRuleContext(tx, {
            studentId: districtB.studentId,
            asOf: plainDate('2026-03-01'),
            keys: h.keys,
          }),
        ),
      ).rejects.toThrow(/not found, or not visible/)
    })

    it('limits a case manager to their assigned caseload', async () => {
      const seen = await withTenant(h.app, caseManager(districtA), (tx) => listCaseload(tx))
      const ids = seen.map((s) => s.id)
      expect(ids).toContain(districtA.studentId)
      expect(ids).not.toContain(districtA.unassignedStudentId)
    })

    it('lets a district-wide role see unassigned students', async () => {
      const seen = await withTenant(h.app, director(districtA), (tx) => listCaseload(tx))
      const ids = seen.map((s) => s.id)
      expect(ids).toContain(districtA.unassignedStudentId)
    })

    it('blocks writing a row into another district', async () => {
      await expect(
        withTenant(h.app, director(districtA), (tx) =>
          tx.query(
            `INSERT INTO meetings (district_id, student_id, purpose, scheduled_for)
             VALUES ($1, $2, 'annual-review', '2026-05-01')`,
            [districtB.districtId, districtB.studentId],
          ),
        ),
      ).rejects.toThrow(/row-level security/i)
    })

    it('sees nothing at all without a session scope', async () => {
      const { rowCount } = await withoutTenantScope(h.app, (tx) =>
        tx.query('SELECT id FROM students'),
      )
      expect(rowCount).toBe(0)
    })
  })

  describe('field encryption at rest', () => {
    it('stores no plaintext in the encrypted columns', async () => {
      const { rows } = await withoutTenantScope(h.admin, (tx) =>
        tx.query<{ pl: string; pd: string }>(
          `SELECT present_levels_encrypted::text AS pl,
                  primary_disability_encrypted::text AS pd
             FROM ieps WHERE id = $1`,
          [districtA.iepId],
        ),
      )
      expect(rows[0]!.pl).not.toContain('fourth-grade')
      expect(rows[0]!.pd).not.toContain('specific-learning-disability')
    })

    it('decrypts through the context loader', async () => {
      const ctx = await withTenant(h.app, director(districtA), (tx) =>
        loadRuleContext(tx, {
          studentId: districtA.studentId,
          asOf: plainDate('2026-03-01'),
          keys: h.keys,
        }),
      )
      expect(ctx.ieps[0]?.presentLevels).toContain('fourth-grade')
      expect(ctx.ieps[0]?.primaryDisability).toBe('specific-learning-disability')
    })
  })

  describe('rule context and the compliance engine', () => {
    it('applies the district’s state pack', async () => {
      const [ca, tx2] = await Promise.all([
        withTenant(h.app, director(districtA), (tx) =>
          loadRuleContext(tx, {
            studentId: districtA.studentId,
            asOf: plainDate('2026-03-01'),
            keys: h.keys,
          }),
        ),
        withTenant(h.app, director(districtB), (tx) =>
          loadRuleContext(tx, {
            studentId: districtB.studentId,
            asOf: plainDate('2026-03-01'),
            keys: h.keys,
          }),
        ),
      ])
      expect(ca.policy.stateCode).toBe('CA')
      expect(tx2.policy.stateCode).toBe('TX')
      // Texas begins transition planning two years earlier than California.
      expect(tx2.policy.transitionPlanningAge).toBe(14)
      expect(ca.policy.transitionPlanningAge).toBe(16)
    })

    it('loads the school calendar rather than inventing one', async () => {
      const ctx = await withTenant(h.app, director(districtA), (tx) =>
        loadRuleContext(tx, {
          studentId: districtA.studentId,
          asOf: plainDate('2026-03-01'),
          keys: h.keys,
        }),
      )
      expect(ctx.calendar.year).toBe('2025-2026')
      expect(ctx.calendar.extendedBreaks).toHaveLength(2)
    })

    it('produces real findings on seeded data', async () => {
      const ctx = await withTenant(h.app, director(districtA), (tx) =>
        loadRuleContext(tx, {
          studentId: districtA.studentId,
          asOf: plainDate('2026-03-01'),
          keys: h.keys,
        }),
      )
      const findings = evaluateStudent(ctx)
      // The seeded student has a speech service with no delivery logs and no
      // recorded progress, so both should surface.
      expect(findings.map((f) => f.ruleId)).toContain('service.delivery-shortfall')
      expect(findings.map((f) => f.ruleId)).toContain('progress.reporting-cadence')
    })
  })

  describe('append-only audit log', () => {
    it('chains entries and verifies', async () => {
      await withTenant(h.app, director(districtA), async (tx) => {
        await appendAudit(tx, director(districtA), {
          action: 'record.viewed',
          subjectType: 'student',
          subjectId: districtA.studentId,
          studentId: districtA.studentId,
        })
        await appendAudit(tx, director(districtA), {
          action: 'record.updated',
          subjectType: 'iep',
          subjectId: districtA.iepId,
          studentId: districtA.studentId,
          changedFields: ['goals'],
        })
      })

      const verification = await withTenant(h.app, director(districtA), (tx) =>
        verifyDistrictChain(tx, districtA.districtId),
      )
      expect(verification.valid).toBe(true)
    })

    it('rejects UPDATE even from the table owner', async () => {
      await expect(
        withoutTenantScope(h.admin, (tx) =>
          tx.query('UPDATE audit_log SET actor_role = $1 WHERE district_id = $2', [
            'tampered',
            districtA.districtId,
          ]),
        ),
      ).rejects.toThrow(/append-only/)
    })

    it('rejects DELETE even from the table owner', async () => {
      await expect(
        withoutTenantScope(h.admin, (tx) =>
          tx.query('DELETE FROM audit_log WHERE district_id = $1', [districtA.districtId]),
        ),
      ).rejects.toThrow(/append-only/)
    })

    it('produces a per-student disclosure record', async () => {
      const trail = await withTenant(h.app, director(districtA), (tx) =>
        readStudentAudit(tx, districtA.studentId),
      )
      expect(trail.length).toBeGreaterThan(0)
      expect(trail.every((e) => e.studentId === districtA.studentId)).toBe(true)
    })

    it('keeps district chains independent', async () => {
      await withTenant(h.app, director(districtB), (tx) =>
        appendAudit(tx, director(districtB), {
          action: 'record.viewed',
          subjectType: 'student',
          subjectId: districtB.studentId,
          studentId: districtB.studentId,
        }),
      )
      const b = await withTenant(h.app, director(districtB), (tx) =>
        verifyDistrictChain(tx, districtB.districtId),
      )
      expect(b.valid).toBe(true)
    })
  })

  describe('service logging and Medicaid recovery', () => {
    let logId: string

    it('records a session and encrypts its narrative', async () => {
      const result = await withTenant(h.app, caseManager(districtA), (tx) =>
        recordServiceLog(tx, caseManager(districtA), h.keys, {
          serviceId: districtA.serviceId,
          studentId: districtA.studentId,
          deliveredOn: '2026-02-10',
          minutesDelivered: 30,
          providerId: districtA.caseManagerId,
          providerCredential: 'Speech Language Pathologist',
          setting: 'special-education',
          groupSize: 2,
          narrative: 'Articulation drill targeting medial /r/.',
          status: 'delivered',
        }),
      )
      logId = result.id

      const { rows } = await withoutTenantScope(h.admin, (tx) =>
        tx.query<{ n: string }>('SELECT narrative_encrypted::text AS n FROM service_logs WHERE id = $1', [
          logId,
        ]),
      )
      expect(rows[0]!.n).not.toContain('Articulation')
    })

    it('flags the unsigned log as unclaimable', async () => {
      const gaps = await withTenant(h.app, director(districtA), (tx) => findMedicaidGaps(tx))
      const gap = gaps.find((g) => g.logId === logId)
      expect(gap?.missing).toContain('provider signature')
    })

    it('refuses a signature from anyone but the delivering provider', async () => {
      await expect(
        withTenant(h.app, director(districtA), (tx) =>
          signServiceLog(tx, director(districtA), logId),
        ),
      ).rejects.toThrow(/only the provider who delivered/i)
    })

    it('clears the gap once the provider signs', async () => {
      await withTenant(h.app, caseManager(districtA), (tx) =>
        signServiceLog(tx, caseManager(districtA), logId),
      )
      const gaps = await withTenant(h.app, director(districtA), (tx) => findMedicaidGaps(tx))
      expect(gaps.find((g) => g.logId === logId)).toBeUndefined()
    })

    it('will not sign the same log twice', async () => {
      await expect(
        withTenant(h.app, caseManager(districtA), (tx) =>
          signServiceLog(tx, caseManager(districtA), logId),
        ),
      ).rejects.toThrow(/already signed/)
    })
  })

  describe('dual approval', () => {
    it('blocks self-approval', async () => {
      const request = await withTenant(h.app, caseManager(districtA), (tx) =>
        requestApproval(tx, caseManager(districtA), {
          action: 'finalize-iep',
          subjectType: 'iep',
          subjectId: districtA.iepId,
          studentId: districtA.studentId,
          justification: 'Annual review complete.',
        }),
      )

      await expect(
        withTenant(h.app, caseManager(districtA), (tx) =>
          decideApproval(tx, caseManager(districtA), request.id, 'approved', null),
        ),
      ).rejects.toThrow(/cannot approve it/)
    })

    it('blocks a role that may not approve the action', async () => {
      const request = await withTenant(h.app, caseManager(districtA), (tx) =>
        requestApproval(tx, caseManager(districtA), {
          action: 'finalize-iep',
          subjectType: 'iep',
          subjectId: districtA.iepId,
          studentId: districtA.studentId,
          justification: 'Annual review complete.',
        }),
      )

      const otherManager: Session = {
        districtId: districtA.districtId,
        userId: districtA.otherCaseManagerId,
        role: 'case-manager',
      }

      await expect(
        withTenant(h.app, otherManager, (tx) =>
          decideApproval(tx, otherManager, request.id, 'approved', null),
        ),
      ).rejects.toThrow(/cannot approve "finalize-iep"/)
    })

    it('accepts a permitted second approver and audits it', async () => {
      const request = await withTenant(h.app, caseManager(districtA), (tx) =>
        requestApproval(tx, caseManager(districtA), {
          action: 'finalize-iep',
          subjectType: 'iep',
          subjectId: districtA.iepId,
          studentId: districtA.studentId,
          justification: 'Annual review complete.',
        }),
      )

      const decided = await withTenant(h.app, director(districtA), (tx) =>
        decideApproval(tx, director(districtA), request.id, 'approved', 'Reviewed goals.'),
      )
      expect(decided.state).toBe('approved')
      expect(decided.decidedBy).toBe(districtA.directorId)

      const trail = await withTenant(h.app, director(districtA), (tx) =>
        readStudentAudit(tx, districtA.studentId),
      )
      expect(trail.map((e) => e.action)).toContain('approval.granted')
    })

    it('cannot be decided twice', async () => {
      const request = await withTenant(h.app, caseManager(districtA), (tx) =>
        requestApproval(tx, caseManager(districtA), {
          action: 'finalize-iep',
          subjectType: 'iep',
          subjectId: districtA.iepId,
          studentId: districtA.studentId,
          justification: 'Annual review complete.',
        }),
      )
      await withTenant(h.app, director(districtA), (tx) =>
        decideApproval(tx, director(districtA), request.id, 'approved', null),
      )
      await expect(
        withTenant(h.app, director(districtA), (tx) =>
          decideApproval(tx, director(districtA), request.id, 'approved', null),
        ),
      ).rejects.toThrow(/already approved/)
    })

    it('requires a reason on denial', async () => {
      const request = await withTenant(h.app, caseManager(districtA), (tx) =>
        requestApproval(tx, caseManager(districtA), {
          action: 'finalize-iep',
          subjectType: 'iep',
          subjectId: districtA.iepId,
          studentId: districtA.studentId,
          justification: 'Annual review complete.',
        }),
      )
      await expect(
        withTenant(h.app, director(districtA), (tx) =>
          decideApproval(tx, director(districtA), request.id, 'denied', '  '),
        ),
      ).rejects.toThrow(/must record a reason/)
    })

    it('is protected by a database constraint, not only application code', async () => {
      const request = await withTenant(h.app, caseManager(districtA), (tx) =>
        requestApproval(tx, caseManager(districtA), {
          action: 'finalize-iep',
          subjectType: 'iep',
          subjectId: districtA.iepId,
          studentId: districtA.studentId,
          justification: 'Annual review complete.',
        }),
      )
      // Bypass the repository entirely and try to write a self-approval.
      await expect(
        withoutTenantScope(h.admin, (tx) =>
          tx.query(
            `UPDATE approval_requests SET state = 'approved', decided_by = requested_by,
                    decided_by_role = 'case-manager', decided_at = now()
              WHERE id = $1`,
            [request.id],
          ),
        ),
      ).rejects.toThrow(/approval_not_self/)
    })
  })
})
