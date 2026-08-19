import {
  hasDatabase,
  seedDistrict,
  setupHarness,
  withoutTenantScope,
  type Harness,
  type SeededDistrict,
} from '@sentryai/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DevTokenVerifier } from './auth.js'
import { createApi } from './server.js'

const suite = hasDatabase ? describe : describe.skip

function bearer(principal: {
  districtId: string
  userId: string
  role: string
  email?: string
  name?: string
}): string {
  return Buffer.from(JSON.stringify(principal), 'utf8').toString('base64url')
}

suite('GraphQL API', () => {
  let h: Harness
  let district: SeededDistrict
  let api: ReturnType<typeof createApi>

  interface GraphQLResponse {
    data?: any
    errors?: { message: string; extensions?: { code?: string } }[]
    /** Raw body and status, so a failed assertion can say what came back. */
    readonly raw: string
    readonly status: number
  }

  const call = async (
    query: string,
    variables: Record<string, unknown>,
    token: string | null,
  ): Promise<GraphQLResponse> => {
    const response = await api.fetch('http://api.test/graphql', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({ query, variables }),
    })
    const raw = await response.text()
    let parsed: { data?: any; errors?: { message: string; extensions?: { code?: string } }[] } = {}
    try {
      parsed = JSON.parse(raw)
    } catch {
      // Leave parsed empty; `raw` carries the diagnosis.
    }
    return { ...parsed, raw, status: response.status }
  }

  /**
   * Asserts an error came back, and reports the whole response when one did
   * not. A test that can only say "expected string, got undefined" cannot tell
   * you whether the server returned success, a different error, or HTML.
   */
  const expectError = (
    result: GraphQLResponse,
    pattern: RegExp,
    expectedCode?: string,
  ): void => {
    const message = result.errors?.[0]?.message
    if (message === undefined) {
      throw new Error(
        `Expected an error matching ${pattern}, but the response carried no message.\n` +
          `HTTP ${result.status}\n${result.raw}`,
      )
    }
    expect(message).toMatch(pattern)
    if (expectedCode !== undefined) {
      // Guards the serialization contract: a bare Error loses its message on
      // the wire, and the missing code is the first thing to notice.
      expect(result.errors?.[0]?.extensions?.code).toBe(expectedCode)
    }
  }

  beforeAll(async () => {
    h = await setupHarness()
    await withoutTenantScope(h.admin, async (tx) => {
      district = await seedDistrict(tx, h.keys, { stateCode: 'CA' })
    })
    api = createApi({ pool: h.app, keys: h.keys, verifier: new DevTokenVerifier('test') })
  }, 60_000)

  afterAll(async () => {
    await h?.close()
  })

  it('rejects an unauthenticated request', async () => {
    const result = await call('{ me { userId } }', {}, null)
    expectError(result, /Missing bearer token/, 'UNAUTHENTICATED')
  })

  it('resolves the caller’s principal', async () => {
    const result = await call(
      '{ me { userId role districtWide } }',
      {},
      bearer({
        districtId: district.districtId,
        userId: district.directorId,
        role: 'special-education-director',
      }),
    )
    expect(result.data.me.userId).toBe(district.directorId)
    expect(result.data.me.districtWide).toBe(true)
  })

  it('returns the caseload for a case manager, scoped by RLS', async () => {
    const result = await call(
      '{ caseload { id firstName } }',
      {},
      bearer({
        districtId: district.districtId,
        userId: district.caseManagerId,
        role: 'case-manager',
      }),
    )
    const ids = result.data.caseload.map((s: { id: string }) => s.id)
    expect(ids).toContain(district.studentId)
    expect(ids).not.toContain(district.unassignedStudentId)
  })

  it('runs the compliance engine for one student', async () => {
    const result = await call(
      `query ($id: ID!, $asOf: Date) {
         studentCompliance(studentId: $id, asOf: $asOf) {
           studentId violationCount atRiskCount
           findings { ruleId severity message citation remedy }
         }
       }`,
      { id: district.studentId, asOf: '2026-03-01' },
      bearer({
        districtId: district.districtId,
        userId: district.directorId,
        role: 'special-education-director',
      }),
    )

    const compliance = result.data.studentCompliance
    expect(compliance.studentId).toBe(district.studentId)
    expect(compliance.findings.length).toBeGreaterThan(0)
    // Every finding carries a citation, which is what makes it checkable.
    expect(compliance.findings.every((f: { citation: string }) => f.citation.length > 0)).toBe(true)
  })

  it('logs the read as a disclosure', async () => {
    const token = bearer({
      districtId: district.districtId,
      userId: district.directorId,
      role: 'special-education-director',
    })
    await call(
      'query ($id: ID!) { studentCompliance(studentId: $id, asOf: "2026-03-01") { studentId } }',
      { id: district.studentId },
      token,
    )
    const trail = await call(
      'query ($id: ID!) { studentAuditTrail(studentId: $id) { action actorId } }',
      { id: district.studentId },
      token,
    )
    expect(trail.data.studentAuditTrail.map((e: { action: string }) => e.action)).toContain(
      'record.viewed',
    )
  })

  it('summarizes the district and reports a verifiable audit chain', async () => {
    const token = bearer({
      districtId: district.districtId,
      userId: district.directorId,
      role: 'special-education-director',
    })
    const result = await call(
      `{
         districtCompliance(asOf: "2026-03-01", topFindingLimit: 5) {
           studentsEvaluated studentsClear violations atRisk
           topFindings { ruleId severity }
         }
         verifyAuditChain { valid brokenAt }
       }`,
      {},
      token,
    )
    expect(result.data.districtCompliance.studentsEvaluated).toBeGreaterThan(0)
    expect(result.data.districtCompliance.topFindings.length).toBeLessThanOrEqual(5)
    expect(result.data.verifyAuditChain.valid).toBe(true)
  })

  it('records and signs a service log through mutations', async () => {
    const cmToken = bearer({
      districtId: district.districtId,
      userId: district.caseManagerId,
      role: 'case-manager',
    })

    const created = await call(
      'mutation ($input: ServiceLogInput!) { recordServiceLog(input: $input) }',
      {
        input: {
          serviceId: district.serviceId,
          studentId: district.studentId,
          deliveredOn: '2026-02-11',
          minutesDelivered: 30,
          providerId: district.caseManagerId,
          providerCredential: 'Speech Language Pathologist',
          setting: 'special-education',
          groupSize: 1,
          narrative: 'Fluency practice with delayed auditory feedback.',
          status: 'delivered',
        },
      },
      cmToken,
    )
    expect(created.errors).toBeUndefined()
    const logId = created.data.recordServiceLog as string

    const signed = await call(
      'mutation ($id: ID!) { signServiceLog(logId: $id) }',
      { id: logId },
      cmToken,
    )
    expect(signed.data.signServiceLog).toBe(true)
  })

  it('surfaces a domain error message rather than masking it', async () => {
    const directorToken = bearer({
      districtId: district.districtId,
      userId: district.directorId,
      role: 'special-education-director',
    })
    const request = await call(
      `mutation ($input: ApprovalRequestInput!) {
         requestApproval(input: $input) { id state }
       }`,
      {
        input: {
          action: 'finalize-iep',
          subjectType: 'iep',
          subjectId: district.iepId,
          studentId: district.studentId,
          justification: 'Ready to finalize.',
        },
      },
      directorToken,
    )
    const requestId = request.data.requestApproval.id as string

    // The director requested it, so the director cannot approve it.
    const decided = await call(
      'mutation ($id: ID!) { decideApproval(requestId: $id, approve: true) { state } }',
      { id: requestId },
      directorToken,
    )
    expectError(decided, /cannot approve it/, 'APPROVAL_REFUSED')
  })

  it('cannot reach another district by supplying its ids', async () => {
    let other: SeededDistrict
    await withoutTenantScope(h.admin, async (tx) => {
      other = await seedDistrict(tx, h.keys, { stateCode: 'TX' })
    })

    const result = await call(
      'query ($id: ID!) { studentCompliance(studentId: $id, asOf: "2026-03-01") { studentId } }',
      { id: other!.studentId },
      bearer({
        districtId: district.districtId,
        userId: district.directorId,
        role: 'special-education-director',
      }),
    )
    expectError(result, /not found, or not visible/, 'NOT_FOUND')
  })
})
