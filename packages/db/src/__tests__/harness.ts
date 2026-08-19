import { randomUUID } from 'node:crypto'
import { LocalKeyProvider, encryptField } from '@sentryai/governance'
import pg from 'pg'
import { createPool, withoutTenantScope, type Queryable } from '../client.js'
import { migrate } from '../migrate.js'

/**
 * Integration test harness.
 *
 * The important subtlety: **superusers bypass row-level security entirely**,
 * and FORCE ROW LEVEL SECURITY does not apply to them. A test suite that
 * connects as `postgres` would assert isolation that is not actually being
 * enforced, and would keep passing after someone dropped every policy.
 *
 * So the harness maintains two connections: an admin pool that runs migrations
 * and seeds data, and an application pool connected as a plain, non-superuser
 * role. Every isolation assertion runs through the application pool.
 */

export const DATABASE_URL = process.env['DATABASE_URL'] ?? ''
export const hasDatabase = DATABASE_URL.length > 0

const APP_ROLE = 'sentryai_test_app'
const APP_PASSWORD = 'sentryai_test_only'

export interface Harness {
  readonly admin: pg.Pool
  /** Non-superuser connection. RLS applies here. */
  readonly app: pg.Pool
  readonly keys: LocalKeyProvider
  close(): Promise<void>
}

export async function setupHarness(): Promise<Harness> {
  const admin = createPool(DATABASE_URL)
  await migrate(admin)

  await withoutTenantScope(admin, async (tx) => {
    // A plain role: no SUPERUSER, no BYPASSRLS. This is what makes the
    // isolation assertions meaningful.
    await tx.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
          CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}';
        END IF;
      END $$;
    `)
    await tx.query(`GRANT sentryai_app TO ${APP_ROLE}`)
    await tx.query(`GRANT USAGE ON SCHEMA public, sentryai TO ${APP_ROLE}`)
    await tx.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`,
    )
    await tx.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`)
    await tx.query(`REVOKE UPDATE, DELETE ON audit_log FROM ${APP_ROLE}`)
  })

  const url = new URL(DATABASE_URL)
  url.username = APP_ROLE
  url.password = APP_PASSWORD
  const app = createPool(url.toString())

  return {
    admin,
    app,
    keys: LocalKeyProvider.generate(),
    async close() {
      await app.end()
      await admin.end()
    },
  }
}

export interface SeededDistrict {
  readonly districtId: string
  readonly schoolId: string
  readonly directorId: string
  readonly caseManagerId: string
  readonly otherCaseManagerId: string
  /** District-wide visibility, but not a permitted approver for IEP finalization. */
  readonly administratorId: string
  readonly studentId: string
  readonly unassignedStudentId: string
  readonly iepId: string
  readonly serviceId: string
  readonly goalId: string
}

/**
 * Seeds one district with two case managers and two students, only one of which
 * is assigned to the first case manager. That asymmetry is what the caseload
 * tests hang on.
 */
export async function seedDistrict(
  tx: Queryable,
  keys: LocalKeyProvider,
  options: { stateCode?: string; name?: string } = {},
): Promise<SeededDistrict> {
  const suffix = randomUUID().slice(0, 8)

  const district = await scalar(
    tx,
    `INSERT INTO districts (name, state_code) VALUES ($1, $2) RETURNING id`,
    [options.name ?? `Test District ${suffix}`, options.stateCode ?? 'CA'],
  )

  const school = await scalar(
    tx,
    `INSERT INTO schools (district_id, name) VALUES ($1, 'Test Middle School') RETURNING id`,
    [district],
  )

  await tx.query(
    `INSERT INTO school_calendars
       (district_id, year, first_instructional_day, last_instructional_day,
        non_instructional_days, extended_breaks)
     VALUES ($1, '2025-2026', '2025-08-18', '2026-06-05',
             ARRAY['2025-09-01','2025-11-11','2026-01-19']::date[],
             $2::jsonb)`,
    [
      district,
      JSON.stringify([
        { from: '2025-11-24', to: '2025-11-28' },
        { from: '2025-12-22', to: '2026-01-02' },
      ]),
    ],
  )

  const director = await scalar(
    tx,
    `INSERT INTO users (district_id, email, name, role, credential)
     VALUES ($1, $2, 'Dana Director', 'special-education-director', 'Admin Credential')
     RETURNING id`,
    [district, `director-${suffix}@example.invalid`],
  )

  const caseManager = await scalar(
    tx,
    `INSERT INTO users (district_id, email, name, role, credential)
     VALUES ($1, $2, 'Casey Manager', 'case-manager', 'Education Specialist')
     RETURNING id`,
    [district, `cm-${suffix}@example.invalid`],
  )

  const otherCaseManager = await scalar(
    tx,
    `INSERT INTO users (district_id, email, name, role, credential)
     VALUES ($1, $2, 'Other Manager', 'case-manager', 'Education Specialist')
     RETURNING id`,
    [district, `cm2-${suffix}@example.invalid`],
  )

  const administrator = await scalar(
    tx,
    `INSERT INTO users (district_id, email, name, role, credential)
     VALUES ($1, $2, 'Avery Admin', 'district-administrator', 'Administrative Services')
     RETURNING id`,
    [district, `admin-${suffix}@example.invalid`],
  )

  const student = await scalar(
    tx,
    `INSERT INTO students (district_id, school_id, local_id, first_name, last_name,
                           date_of_birth, grade_level, home_language, decision_makers, enrolled_on)
     VALUES ($1, $2, $3, 'Assigned', 'Student', '2012-04-15', '7', 'Spanish', $4::jsonb, '2024-08-19')
     RETURNING id`,
    [
      district,
      school,
      `L-${suffix}-1`,
      JSON.stringify([{ kind: 'parent', name: 'Test Parent', preferredLanguage: 'Spanish' }]),
    ],
  )

  const unassigned = await scalar(
    tx,
    `INSERT INTO students (district_id, school_id, local_id, first_name, last_name,
                           date_of_birth, grade_level, home_language, decision_makers, enrolled_on)
     VALUES ($1, $2, $3, 'Unassigned', 'Student', '2013-02-02', '6', 'English', $4::jsonb, '2024-08-19')
     RETURNING id`,
    [
      district,
      school,
      `L-${suffix}-2`,
      JSON.stringify([{ kind: 'parent', name: 'Other Parent', preferredLanguage: 'English' }]),
    ],
  )

  await tx.query(
    `INSERT INTO student_assignments (student_id, user_id, district_id, role)
     VALUES ($1, $2, $3, 'case-manager')`,
    [student, caseManager, district],
  )

  const provenance = JSON.stringify({
    source: 'human',
    authoredBy: caseManager,
    acceptedBy: caseManager,
    acceptedOn: '2025-09-01',
    modelId: null,
  })

  const iep = await scalar(
    tx,
    `INSERT INTO ieps (district_id, student_id, kind, status, effective_on,
                       annual_review_due_on, present_levels_provenance, placement,
                       accommodations, extended_school_year, signed_on)
     VALUES ($1, $2, 'annual', 'active', '2025-09-01', '2026-08-31', $3::jsonb, $4::jsonb,
             '[]'::jsonb, $5::jsonb, '2025-09-01')
     RETURNING id`,
    [
      district,
      student,
      provenance,
      JSON.stringify({
        percentInGeneralEducation: 80,
        settingCode: 'REG80',
        removalJustification: 'Intensive decoding instruction requires a separate setting.',
        supplementaryAidsConsidered: ['Push-in support'],
      }),
      JSON.stringify({ considered: true, eligible: false, justification: 'No regression.' }),
    ],
  )

  // Encrypted fields are written after insert because the AAD binds to the
  // row id the database assigns.
  await tx.query(
    `UPDATE ieps SET present_levels_encrypted = $2,
                     primary_disability_encrypted = $3
      WHERE id = $1`,
    [
      iep,
      encrypt(keys, student, 'iep', iep, 'presentLevels', 'Reads at a fourth-grade level.'),
      encryptJson(keys, student, 'iep', iep, 'primaryDisability', 'specific-learning-disability'),
    ],
  )

  const goal = await scalar(
    tx,
    `INSERT INTO goals (district_id, iep_id, area, baseline, target,
                        measurement_method, reporting_frequency, objectives, provenance)
     VALUES ($1, $2, 'reading', $3::jsonb, $4::jsonb,
             'curriculum-based-measurement', 'quarterly', '[]'::jsonb, $5::jsonb)
     RETURNING id`,
    [
      district,
      iep,
      JSON.stringify({ value: 78, unit: 'percent accuracy', condition: 'cold read' }),
      JSON.stringify({ value: 95, unit: 'percent accuracy', condition: 'cold read' }),
      provenance,
    ],
  )

  await tx.query('UPDATE goals SET statement_encrypted = $2 WHERE id = $1', [
    goal,
    encrypt(
      keys,
      student,
      'goal',
      goal,
      'statement',
      'Read a grade-level passage with 95% accuracy in 4 of 5 trials.',
    ),
  ])

  const service = await scalar(
    tx,
    `INSERT INTO services (district_id, iep_id, type, minutes_per_session, sessions_per_period,
                           period, setting, provider_role, starts_on, ends_on, medicaid_billable)
     VALUES ($1, $2, 'speech-language', 30, 2, 'week', 'special-education',
             'Speech Language Pathologist', '2025-09-01', '2026-08-31', true)
     RETURNING id`,
    [district, iep],
  )

  await tx.query(
    `INSERT INTO consents (district_id, student_id, kind, requested_on, responded_on,
                           response, signed_by, presented_in_language)
     VALUES ($1, $2, 'medicaid-billing', '2025-08-20', '2025-08-25', 'granted',
             'Test Parent', 'Spanish')`,
    [district, student],
  )

  return {
    districtId: district,
    schoolId: school,
    directorId: director,
    caseManagerId: caseManager,
    otherCaseManagerId: otherCaseManager,
    administratorId: administrator,
    studentId: student,
    unassignedStudentId: unassigned,
    iepId: iep,
    serviceId: service,
    goalId: goal,
  }
}

/**
 * Encrypts through the same primitive the application uses, so seeded rows are
 * byte-for-byte the shape production rows have. Returns the JSON string the
 * jsonb column expects.
 */
function encrypt(
  keys: LocalKeyProvider,
  studentId: string,
  recordType: string,
  recordId: string,
  fieldName: string,
  value: string,
): string {
  return JSON.stringify(
    encryptField(value, { studentId, recordType, recordId, fieldName }, keys),
  )
}

function encryptJson(
  keys: LocalKeyProvider,
  studentId: string,
  recordType: string,
  recordId: string,
  fieldName: string,
  value: unknown,
): string {
  return encrypt(keys, studentId, recordType, recordId, fieldName, JSON.stringify(value))
}

async function scalar(
  tx: Queryable,
  sql: string,
  values: readonly unknown[],
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(sql, values)
  return rows[0]!.id
}
