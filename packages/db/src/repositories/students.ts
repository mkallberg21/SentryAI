import type { Queryable, Session } from '../client.js'

export interface CaseloadEntry {
  readonly id: string
  readonly localId: string
  readonly firstName: string
  readonly lastName: string
  readonly gradeLevel: string
  readonly schoolName: string
  readonly annualReviewDueOn: string | null
  readonly openEvaluationDueHint: string | null
}

/**
 * The students this session may see.
 *
 * No district filter appears in this SQL, and none should: row-level security
 * applies it. Duplicating the predicate here would make the query pass its
 * tests while masking a broken policy -- the test would be checking the WHERE
 * clause, not the isolation.
 */
export async function listCaseload(tx: Queryable): Promise<CaseloadEntry[]> {
  const { rows } = await tx.query(
    `SELECT s.id,
            s.local_id,
            s.first_name,
            s.last_name,
            s.grade_level,
            sc.name AS school_name,
            active.annual_review_due_on,
            ev.consent_received_on
       FROM students s
       JOIN schools sc ON sc.id = s.school_id
       LEFT JOIN LATERAL (
         SELECT annual_review_due_on FROM ieps i
          WHERE i.student_id = s.id AND i.status = 'active'
          LIMIT 1
       ) active ON true
       LEFT JOIN LATERAL (
         SELECT consent_received_on FROM evaluations e
          WHERE e.student_id = s.id AND e.eligibility_determined_on IS NULL
            AND e.status NOT IN ('withdrawn', 'consent-refused')
          ORDER BY e.referred_on DESC LIMIT 1
       ) ev ON true
      WHERE s.exited_on IS NULL
      ORDER BY s.last_name, s.first_name`,
  )

  return (rows as Record<string, unknown>[]).map((r) => ({
    id: r['id'] as string,
    localId: r['local_id'] as string,
    firstName: r['first_name'] as string,
    lastName: r['last_name'] as string,
    gradeLevel: r['grade_level'] as string,
    schoolName: r['school_name'] as string,
    annualReviewDueOn: asIsoDate(r['annual_review_due_on']),
    openEvaluationDueHint: asIsoDate(r['consent_received_on']),
  }))
}

function asIsoDate(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) {
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  return String(value).slice(0, 10)
}

/** Student ids visible to this session, for district-wide compliance sweeps. */
export async function listVisibleStudentIds(tx: Queryable): Promise<string[]> {
  const { rows } = await tx.query(
    'SELECT id FROM students WHERE exited_on IS NULL ORDER BY id',
  )
  return (rows as { id: string }[]).map((r) => r.id)
}

export async function assignStudent(
  tx: Queryable,
  session: Session,
  studentId: string,
  userId: string,
  role: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO student_assignments (student_id, user_id, district_id, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (student_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [studentId, userId, session.districtId, role],
  )
}
