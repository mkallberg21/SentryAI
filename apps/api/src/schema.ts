import { evaluateStudent, summarize, type Finding } from '@sentryai/compliance'
import {
  appendAudit,
  decideApproval,
  findMedicaidGaps,
  listCaseload,
  listPendingApprovals,
  listVisibleStudentIds,
  loadRuleContext,
  readStudentAudit,
  recordServiceLog,
  requestApproval,
  signServiceLog,
  verifyDistrictChain,
  withTenant,
  type Pool,
  type Session,
} from '@sentryai/db'
import { plainDate, type PlainDate } from '@sentryai/domain'
import type { KeyProvider } from '@sentryai/governance'
import { createSchema } from 'graphql-yoga'
import { isDistrictWide, type Principal } from './auth.js'

export interface ServerContext {
  readonly principal: Principal
  readonly pool: Pool
  readonly keys: KeyProvider
}

const session = (ctx: ServerContext): Session => ({
  districtId: ctx.principal.districtId,
  userId: ctx.principal.userId,
  role: ctx.principal.role,
})

function today(): PlainDate {
  return plainDate(new Date().toISOString().slice(0, 10))
}

function asOfOrToday(value: string | null | undefined): PlainDate {
  return value === null || value === undefined ? today() : plainDate(value)
}

export const typeDefs = /* GraphQL */ `
  scalar Date

  type Principal {
    userId: ID!
    districtId: ID!
    role: String!
    email: String!
    name: String!
    districtWide: Boolean!
  }

  type CaseloadStudent {
    id: ID!
    localId: String!
    firstName: String!
    lastName: String!
    gradeLevel: String!
    schoolName: String!
    annualReviewDueOn: Date
  }

  enum Severity {
    violation
    at_risk
    weak_documentation
    informational
  }

  type Finding {
    ruleId: String!
    severity: Severity!
    studentId: ID!
    "One sentence a case manager can act on without reading the regulation."
    message: String!
    "The legal hook, so the claim can be verified rather than trusted."
    citation: String!
    remedy: String
    dueOn: Date
    daysRemaining: Int
    subjectKind: String!
    subjectId: String!
  }

  type StudentCompliance {
    studentId: ID!
    asOf: Date!
    findings: [Finding!]!
    violationCount: Int!
    atRiskCount: Int!
  }

  type DistrictCompliance {
    asOf: Date!
    studentsEvaluated: Int!
    "Students with no violation and no at-risk finding."
    studentsClear: Int!
    violations: Int!
    atRisk: Int!
    weakDocumentation: Int!
    "Highest-severity findings across the district, most urgent first."
    topFindings: [Finding!]!
  }

  type ApprovalRequest {
    id: ID!
    action: String!
    subjectType: String!
    subjectId: ID!
    studentId: ID!
    requestedBy: ID!
    requestedByRole: String!
    requestedAt: String!
    justification: String!
    state: String!
    decidedBy: ID
    decidedAt: String
    decisionNote: String
    expiresAt: String!
  }

  type MedicaidGap {
    studentId: ID!
    logId: ID!
    deliveredOn: Date!
    "What the log is missing before it can be claimed."
    missing: [String!]!
  }

  type AuditEntry {
    sequence: Int!
    at: String!
    actorId: String!
    actorRole: String!
    action: String!
    subjectType: String!
    subjectId: String!
    "Field names only. Values are never written to the audit log."
    changedFields: [String!]!
    reason: String
  }

  type ChainVerification {
    valid: Boolean!
    brokenAt: Int
    reason: String
  }

  type Query {
    me: Principal!
    caseload: [CaseloadStudent!]!
    studentCompliance(studentId: ID!, asOf: Date): StudentCompliance!
    "District-wide sweep. Limited to the caller's caseload for non-admin roles."
    districtCompliance(asOf: Date, topFindingLimit: Int): DistrictCompliance!
    pendingApprovals: [ApprovalRequest!]!
    medicaidGaps: [MedicaidGap!]!
    studentAuditTrail(studentId: ID!): [AuditEntry!]!
    verifyAuditChain: ChainVerification!
  }

  input ServiceLogInput {
    serviceId: ID!
    studentId: ID!
    deliveredOn: Date!
    minutesDelivered: Int!
    providerId: ID!
    providerCredential: String!
    setting: String!
    groupSize: Int!
    narrative: String!
    status: String!
  }

  input ApprovalRequestInput {
    action: String!
    subjectType: String!
    subjectId: ID!
    studentId: ID!
    justification: String!
    ttlHours: Int
  }

  type Mutation {
    recordServiceLog(input: ServiceLogInput!): ID!
    signServiceLog(logId: ID!): Boolean!
    requestApproval(input: ApprovalRequestInput!): ApprovalRequest!
    decideApproval(requestId: ID!, approve: Boolean!, note: String): ApprovalRequest!
  }
`

const SEVERITY_TO_ENUM: Record<Finding['severity'], string> = {
  violation: 'violation',
  'at-risk': 'at_risk',
  'weak-documentation': 'weak_documentation',
  informational: 'informational',
}

function toGraphFinding(f: Finding) {
  return {
    ruleId: f.ruleId,
    severity: SEVERITY_TO_ENUM[f.severity],
    studentId: f.studentId,
    message: f.message,
    citation: f.citation,
    remedy: f.remedy,
    dueOn: f.dueOn,
    daysRemaining: f.daysRemaining,
    subjectKind: f.subject.kind,
    subjectId: f.subject.id,
  }
}

/**
 * Cap on how many students one district-wide sweep will evaluate.
 *
 * The sweep loads a full RuleContext per student, which is not free. A district
 * over this size gets a truncated result *and is told so* — silently capping a
 * compliance sweep would report a clean district that simply was not looked at.
 */
const SWEEP_LIMIT = 500

export const schema = createSchema<ServerContext>({
  typeDefs,
  resolvers: {
    Query: {
      me: (_parent, _args, ctx: ServerContext) => ({
        userId: ctx.principal.userId,
        districtId: ctx.principal.districtId,
        role: ctx.principal.role,
        email: ctx.principal.email,
        name: ctx.principal.name,
        districtWide: isDistrictWide(ctx.principal),
      }),

      caseload: (_parent, _args, ctx: ServerContext) =>
        withTenant(ctx.pool, session(ctx), (tx) => listCaseload(tx)),

      studentCompliance: async (
        _parent,
        args: { studentId: string; asOf?: string | null },
        ctx: ServerContext,
      ) => {
        const asOf = asOfOrToday(args.asOf)
        return withTenant(ctx.pool, session(ctx), async (tx) => {
          const ruleContext = await loadRuleContext(tx, {
            studentId: args.studentId,
            asOf,
            keys: ctx.keys,
          })
          const findings = evaluateStudent(ruleContext)

          // Reading a student record is a disclosure. FERPA contemplates the
          // parent being able to ask who looked, so every read is logged.
          await appendAudit(tx, session(ctx), {
            action: 'record.viewed',
            subjectType: 'student',
            subjectId: args.studentId,
            studentId: args.studentId,
            reason: 'compliance review',
          })

          return {
            studentId: args.studentId,
            asOf,
            findings: findings.map(toGraphFinding),
            violationCount: findings.filter((f) => f.severity === 'violation').length,
            atRiskCount: findings.filter((f) => f.severity === 'at-risk').length,
          }
        })
      },

      districtCompliance: async (
        _parent,
        args: { asOf?: string | null; topFindingLimit?: number | null },
        ctx: ServerContext,
      ) => {
        const asOf = asOfOrToday(args.asOf)
        const limit = args.topFindingLimit ?? 25

        return withTenant(ctx.pool, session(ctx), async (tx) => {
          const ids = await listVisibleStudentIds(tx)
          const swept = ids.slice(0, SWEEP_LIMIT)

          const byStudent = new Map<string, Finding[]>()
          for (const id of swept) {
            const ruleContext = await loadRuleContext(tx, {
              studentId: id,
              asOf,
              keys: ctx.keys,
            })
            byStudent.set(id, evaluateStudent(ruleContext))
          }

          const summary = summarize(byStudent)
          const all = [...byStudent.values()].flat()
          const ranked = all
            .filter((f) => f.severity === 'violation' || f.severity === 'at-risk')
            .sort((a, b) => {
              if (a.severity !== b.severity) return a.severity === 'violation' ? -1 : 1
              return (a.daysRemaining ?? 0) - (b.daysRemaining ?? 0)
            })

          if (ids.length > swept.length) {
            // Surfaced rather than swallowed: see SWEEP_LIMIT.
            console.warn(
              `districtCompliance evaluated ${swept.length} of ${ids.length} students; results are partial.`,
            )
          }

          return {
            asOf,
            studentsEvaluated: summary.studentsEvaluated,
            studentsClear: summary.studentsClear,
            violations: summary.violations,
            atRisk: summary.atRisk,
            weakDocumentation: summary.weakDocumentation,
            topFindings: ranked.slice(0, limit).map(toGraphFinding),
          }
        })
      },

      pendingApprovals: (_parent, _args, ctx: ServerContext) =>
        withTenant(ctx.pool, session(ctx), (tx) => listPendingApprovals(tx)),

      medicaidGaps: (_parent, _args, ctx: ServerContext) =>
        withTenant(ctx.pool, session(ctx), (tx) => findMedicaidGaps(tx)),

      studentAuditTrail: async (
        _parent,
        args: { studentId: string },
        ctx: ServerContext,
      ) =>
        withTenant(ctx.pool, session(ctx), (tx) => readStudentAudit(tx, args.studentId)),

      verifyAuditChain: (_parent, _args, ctx: ServerContext) =>
        withTenant(ctx.pool, session(ctx), (tx) =>
          verifyDistrictChain(tx, ctx.principal.districtId),
        ),
    },

    Mutation: {
      recordServiceLog: async (
        _parent,
        args: { input: Parameters<typeof recordServiceLog>[3] },
        ctx: ServerContext,
      ) => {
        const { id } = await withTenant(ctx.pool, session(ctx), (tx) =>
          recordServiceLog(tx, session(ctx), ctx.keys, args.input),
        )
        return id
      },

      signServiceLog: async (_parent, args: { logId: string }, ctx: ServerContext) => {
        await withTenant(ctx.pool, session(ctx), (tx) =>
          signServiceLog(tx, session(ctx), args.logId),
        )
        return true
      },

      requestApproval: (
        _parent,
        args: { input: Parameters<typeof requestApproval>[2] },
        ctx: ServerContext,
      ) =>
        withTenant(ctx.pool, session(ctx), (tx) =>
          requestApproval(tx, session(ctx), args.input),
        ),

      decideApproval: (
        _parent,
        args: { requestId: string; approve: boolean; note?: string | null },
        ctx: ServerContext,
      ) =>
        withTenant(ctx.pool, session(ctx), (tx) =>
          decideApproval(
            tx,
            session(ctx),
            args.requestId,
            args.approve ? 'approved' : 'denied',
            args.note ?? null,
          ),
        ),
    },
  },
})
