import { policyForState, type RuleContext, type SchoolCalendar } from '@sentryai/compliance'
import {
  plainDate,
  type Consent,
  type ContentProvenance,
  type Evaluation,
  type Goal,
  type Iep,
  type Meeting,
  type Notice,
  type PlainDate,
  type ProgressEntry,
  type ServiceLine,
  type ServiceLog,
  type Student,
} from '@sentryai/domain'
import type { KeyProvider } from '@sentryai/governance'
import type { Queryable } from './client.js'
import { fieldContext, opened, openedJson } from './crypto.js'
import { NotFoundError } from './errors.js'

/**
 * Assembles the full RuleContext for one student.
 *
 * The compliance engine is a pure function of this object, which means this
 * loader is where correctness actually lives: a rule that never sees a
 * student's meetings will cheerfully report them as compliant. Everything the
 * rules can read is loaded here, unconditionally, rather than lazily -- an
 * empty array must mean "there are none," never "we did not look."
 */

/** Postgres returns DATE as a JS Date in local time; take the calendar parts. */
function toPlainDate(value: Date | string | null): PlainDate | null {
  if (value === null) return null
  if (typeof value === 'string') return plainDate(value.slice(0, 10))
  const y = value.getFullYear()
  const m = String(value.getMonth() + 1).padStart(2, '0')
  const d = String(value.getDate()).padStart(2, '0')
  return plainDate(`${y}-${m}-${d}`)
}

function requireDate(value: Date | string | null, field: string): PlainDate {
  const date = toPlainDate(value)
  if (date === null) throw new Error(`Expected ${field} to be present`)
  return date
}

export interface LoadOptions {
  readonly studentId: string
  readonly asOf: PlainDate
  readonly keys: KeyProvider
  /** Calendar year key, e.g. "2025-2026". Defaults to the district's newest. */
  readonly calendarYear?: string
}

export async function loadRuleContext(
  tx: Queryable,
  options: LoadOptions,
): Promise<RuleContext> {
  const { studentId, asOf, keys } = options

  const studentRow = await one(
    tx,
    `SELECT s.*, d.state_code
       FROM students s JOIN districts d ON d.id = s.district_id
      WHERE s.id = $1`,
    [studentId],
    `Student ${studentId} not found, or not visible to this session`,
  )

  const student: Student = {
    id: studentRow['id'] as Student['id'],
    districtId: studentRow['district_id'] as Student['districtId'],
    schoolId: studentRow['school_id'] as Student['schoolId'],
    localId: studentRow['local_id'] as string,
    stateId: (studentRow['state_id'] as string | null) ?? null,
    firstName: studentRow['first_name'] as string,
    lastName: studentRow['last_name'] as string,
    dateOfBirth: requireDate(studentRow['date_of_birth'] as Date, 'date_of_birth'),
    gradeLevel: studentRow['grade_level'] as string,
    homeLanguage: studentRow['home_language'] as string,
    decisionMakers: studentRow['decision_makers'] as Student['decisionMakers'],
    enrolledOn: requireDate(studentRow['enrolled_on'] as Date, 'enrolled_on'),
    exitedOn: toPlainDate(studentRow['exited_on'] as Date | null),
  }

  const policy = policyForState(studentRow['state_code'] as string)
  const calendar = await loadCalendar(tx, student.districtId, options.calendarYear)

  const [evaluations, ieps, meetings, notices, consents, progress, serviceLogs] =
    await Promise.all([
      loadEvaluations(tx, studentId),
      loadIeps(tx, studentId, keys),
      loadMeetings(tx, studentId),
      loadNotices(tx, studentId),
      loadConsents(tx, studentId),
      loadProgress(tx, studentId, keys),
      loadServiceLogs(tx, studentId, keys),
    ])

  return {
    asOf,
    student,
    calendar,
    policy,
    evaluations,
    ieps,
    meetings,
    notices,
    consents,
    progress,
    serviceLogs,
  }
}

async function one(
  tx: Queryable,
  sql: string,
  values: readonly unknown[],
  missingMessage: string,
): Promise<Record<string, unknown>> {
  const { rows } = await tx.query(sql, values)
  const row = rows[0]
  if (row === undefined) throw new NotFoundError(missingMessage)
  return row as Record<string, unknown>
}

async function loadCalendar(
  tx: Queryable,
  districtId: string,
  year: string | undefined,
): Promise<SchoolCalendar> {
  const { rows } = await tx.query(
    year === undefined
      ? `SELECT * FROM school_calendars WHERE district_id = $1 ORDER BY year DESC LIMIT 1`
      : `SELECT * FROM school_calendars WHERE district_id = $1 AND year = $2`,
    year === undefined ? [districtId] : [districtId, year],
  )
  const row = rows[0] as Record<string, unknown> | undefined
  if (row === undefined) {
    // Falling back to a synthetic calendar would produce plausible-looking but
    // wrong school-day deadlines, which is the failure this system exists to
    // prevent. Better to refuse.
    throw new Error(
      `No school calendar for district ${districtId}${year === undefined ? '' : ` and year ${year}`}. ` +
        'School-day timelines cannot be computed without one.',
    )
  }

  return {
    districtId,
    year: row['year'] as string,
    firstInstructionalDay: requireDate(row['first_instructional_day'] as Date, 'first day'),
    lastInstructionalDay: requireDate(row['last_instructional_day'] as Date, 'last day'),
    nonInstructionalDays: (row['non_instructional_days'] as Date[]).map(
      (d) => requireDate(d, 'non_instructional_day'),
    ),
    extendedBreaks: (row['extended_breaks'] as Array<{ from: string; to: string }>).map((b) => ({
      from: plainDate(b.from),
      to: plainDate(b.to),
    })),
  }
}

async function loadEvaluations(tx: Queryable, studentId: string): Promise<Evaluation[]> {
  const { rows } = await tx.query(
    'SELECT * FROM evaluations WHERE student_id = $1 ORDER BY referred_on ASC',
    [studentId],
  )
  return (rows as Record<string, unknown>[]).map((r) => ({
    id: r['id'] as Evaluation['id'],
    studentId: r['student_id'] as Evaluation['studentId'],
    kind: r['kind'] as Evaluation['kind'],
    status: r['status'] as Evaluation['status'],
    referredOn: requireDate(r['referred_on'] as Date, 'referred_on'),
    consentRequestedOn: toPlainDate(r['consent_requested_on'] as Date | null),
    consentReceivedOn: toPlainDate(r['consent_received_on'] as Date | null),
    consentId: (r['consent_id'] as Evaluation['consentId']) ?? null,
    reportCompletedOn: toPlainDate(r['report_completed_on'] as Date | null),
    eligibilityDeterminedOn: toPlainDate(r['eligibility_determined_on'] as Date | null),
    assignedTo: (r['assigned_to'] as Evaluation['assignedTo']) ?? null,
    tolledPeriods: (r['tolled_periods'] as Evaluation['tolledPeriods']) ?? [],
  }))
}

async function loadIeps(tx: Queryable, studentId: string, keys: KeyProvider): Promise<Iep[]> {
  const { rows } = await tx.query(
    'SELECT * FROM ieps WHERE student_id = $1 ORDER BY effective_on ASC',
    [studentId],
  )

  const ieps: Iep[] = []

  for (const raw of rows as Record<string, unknown>[]) {
    const iepId = raw['id'] as string
    const [goals, services] = await Promise.all([
      loadGoals(tx, studentId, iepId, keys),
      loadServices(tx, iepId),
    ])

    ieps.push({
      id: iepId as Iep['id'],
      studentId: raw['student_id'] as Iep['studentId'],
      kind: raw['kind'] as Iep['kind'],
      status: raw['status'] as Iep['status'],
      primaryDisability:
        openedJson<Iep['primaryDisability']>(
          raw['primary_disability_encrypted'],
          fieldContext(studentId, 'iep', iepId, 'primaryDisability'),
          keys,
        ) ?? 'other-health-impairment',
      secondaryDisabilities:
        openedJson<Iep['secondaryDisabilities']>(
          raw['secondary_disabilities_encrypted'],
          fieldContext(studentId, 'iep', iepId, 'secondaryDisabilities'),
          keys,
        ) ?? [],
      meetingId: (raw['meeting_id'] as Iep['meetingId']) ?? null,
      effectiveOn: requireDate(raw['effective_on'] as Date, 'effective_on'),
      annualReviewDueOn: requireDate(raw['annual_review_due_on'] as Date, 'annual_review_due_on'),
      presentLevels:
        opened(
          raw['present_levels_encrypted'],
          fieldContext(studentId, 'iep', iepId, 'presentLevels'),
          keys,
        ) ?? '',
      presentLevelsProvenance: raw['present_levels_provenance'] as ContentProvenance,
      goals,
      services,
      placement: raw['placement'] as Iep['placement'],
      accommodations: raw['accommodations'] as Iep['accommodations'],
      transitionPlan: (raw['transition_plan'] as Iep['transitionPlan']) ?? null,
      extendedSchoolYear: raw['extended_school_year'] as Iep['extendedSchoolYear'],
      signedOn: toPlainDate(raw['signed_on'] as Date | null),
      supersedesIepId: (raw['supersedes_iep_id'] as Iep['supersedesIepId']) ?? null,
    })
  }

  return ieps
}

async function loadGoals(
  tx: Queryable,
  studentId: string,
  iepId: string,
  keys: KeyProvider,
): Promise<Goal[]> {
  const { rows } = await tx.query(
    'SELECT * FROM goals WHERE iep_id = $1 ORDER BY position ASC, id ASC',
    [iepId],
  )
  return (rows as Record<string, unknown>[]).map((r) => {
    const goalId = r['id'] as string
    return {
      id: goalId as Goal['id'],
      area: r['area'] as Goal['area'],
      statement:
        opened(
          r['statement_encrypted'],
          fieldContext(studentId, 'goal', goalId, 'statement'),
          keys,
        ) ?? '',
      baseline: r['baseline'] as Goal['baseline'],
      target: r['target'] as Goal['target'],
      measurementMethod: r['measurement_method'] as Goal['measurementMethod'],
      reportingFrequency: r['reporting_frequency'] as Goal['reportingFrequency'],
      objectives: (r['objectives'] as Goal['objectives']) ?? [],
      provenance: r['provenance'] as ContentProvenance,
    }
  })
}

async function loadServices(tx: Queryable, iepId: string): Promise<ServiceLine[]> {
  const { rows } = await tx.query('SELECT * FROM services WHERE iep_id = $1 ORDER BY id ASC', [
    iepId,
  ])
  return (rows as Record<string, unknown>[]).map((r) => ({
    id: r['id'] as ServiceLine['id'],
    type: r['type'] as ServiceLine['type'],
    minutesPerSession: Number(r['minutes_per_session']),
    sessionsPerPeriod: Number(r['sessions_per_period']),
    period: r['period'] as ServiceLine['period'],
    setting: r['setting'] as ServiceLine['setting'],
    providerRole: r['provider_role'] as string,
    startsOn: requireDate(r['starts_on'] as Date, 'starts_on'),
    endsOn: requireDate(r['ends_on'] as Date, 'ends_on'),
    medicaidBillable: r['medicaid_billable'] as boolean,
  }))
}

async function loadMeetings(tx: Queryable, studentId: string): Promise<Meeting[]> {
  const { rows } = await tx.query(
    'SELECT * FROM meetings WHERE student_id = $1 ORDER BY scheduled_for ASC',
    [studentId],
  )
  const meetings = rows as Record<string, unknown>[]
  if (meetings.length === 0) return []

  const { rows: attendance } = await tx.query(
    'SELECT * FROM meeting_attendance WHERE meeting_id = ANY($1::uuid[])',
    [meetings.map((m) => m['id'])],
  )

  const byMeeting = new Map<string, Meeting['attendance'][number][]>()
  for (const a of attendance as Record<string, unknown>[]) {
    const list = byMeeting.get(a['meeting_id'] as string) ?? []
    list.push({
      userId: (a['user_id'] as Meeting['attendance'][number]['userId']) ?? null,
      name: a['name'] as string,
      role: a['role'] as Meeting['attendance'][number]['role'],
      status: a['status'] as Meeting['attendance'][number]['status'],
      writtenInputProvided: a['written_input_provided'] as boolean,
    })
    byMeeting.set(a['meeting_id'] as string, list)
  }

  return meetings.map((m) => ({
    id: m['id'] as Meeting['id'],
    studentId: m['student_id'] as Meeting['studentId'],
    purpose: m['purpose'] as Meeting['purpose'],
    noticeSentOn: toPlainDate(m['notice_sent_on'] as Date | null),
    scheduledFor: requireDate(m['scheduled_for'] as Date, 'scheduled_for'),
    heldOn: toPlainDate(m['held_on'] as Date | null),
    attendance: byMeeting.get(m['id'] as string) ?? [],
    interpreterProvided: m['interpreter_provided'] as boolean,
    interpreterLanguage: (m['interpreter_language'] as string | null) ?? null,
    rescheduledFrom: ((m['rescheduled_from'] as Date[]) ?? []).map((d) =>
      requireDate(d, 'rescheduled_from'),
    ),
    parentRequestedReschedule: m['parent_requested_reschedule'] as boolean,
  }))
}

async function loadNotices(tx: Queryable, studentId: string): Promise<Notice[]> {
  const { rows } = await tx.query(
    'SELECT * FROM notices WHERE student_id = $1 ORDER BY sent_on ASC',
    [studentId],
  )
  return (rows as Record<string, unknown>[]).map((r) => ({
    id: r['id'] as Notice['id'],
    studentId: r['student_id'] as Notice['studentId'],
    kind: r['kind'] as Notice['kind'],
    sentOn: requireDate(r['sent_on'] as Date, 'sent_on'),
    delivery: r['delivery'] as Notice['delivery'],
    language: r['language'] as string,
    translationReviewedBy: (r['translation_reviewed_by'] as Notice['translationReviewedBy']) ?? null,
    // PWN content is loaded by the notice repository, which holds the key
    // context; the compliance engine only needs to know whether it is present.
    content: r['content_encrypted'] === null ? null : PLACEHOLDER_PWN,
    documentUri: (r['document_uri'] as string | null) ?? null,
  }))
}

/**
 * The `notice.pwn-content` rule inspects the six required elements, so a notice
 * whose content is encrypted must be decrypted by the caller that holds the key
 * context before that rule can judge it. Loading it here would require the
 * student key context for every notice on every dashboard render.
 *
 * This placeholder keeps the "content exists" signal without claiming the
 * elements are complete -- it is filled with blanks, so a caller who forgets to
 * decrypt sees findings rather than false confidence.
 */
const PLACEHOLDER_PWN = {
  actionProposedOrRefused: '',
  explanationOfWhy: '',
  evaluationProceduresRelied: '',
  otherOptionsConsidered: '',
  reasonsOptionsRejected: '',
  otherFactorsRelevant: '',
} as const

async function loadConsents(tx: Queryable, studentId: string): Promise<Consent[]> {
  const { rows } = await tx.query(
    'SELECT * FROM consents WHERE student_id = $1 ORDER BY requested_on ASC',
    [studentId],
  )
  return (rows as Record<string, unknown>[]).map((r) => ({
    id: r['id'] as Consent['id'],
    studentId: r['student_id'] as Consent['studentId'],
    kind: r['kind'] as Consent['kind'],
    requestedOn: requireDate(r['requested_on'] as Date, 'requested_on'),
    respondedOn: toPlainDate(r['responded_on'] as Date | null),
    response: r['response'] as Consent['response'],
    signedBy: (r['signed_by'] as string | null) ?? null,
    presentedInLanguage: r['presented_in_language'] as string,
    documentUri: (r['document_uri'] as string | null) ?? null,
  }))
}

async function loadProgress(
  tx: Queryable,
  studentId: string,
  keys: KeyProvider,
): Promise<ProgressEntry[]> {
  const { rows } = await tx.query(
    'SELECT * FROM progress_entries WHERE student_id = $1 ORDER BY recorded_on ASC',
    [studentId],
  )
  return (rows as Record<string, unknown>[]).map((r) => {
    const id = r['id'] as string
    return {
      goalId: r['goal_id'] as ProgressEntry['goalId'],
      recordedOn: requireDate(r['recorded_on'] as Date, 'recorded_on'),
      recordedBy: r['recorded_by'] as ProgressEntry['recordedBy'],
      value: Number(r['value']),
      unit: r['unit'] as string,
      narrative:
        opened(
          r['narrative_encrypted'],
          fieldContext(studentId, 'progress', id, 'narrative'),
          keys,
        ) ?? '',
      onTrack: r['on_track'] as boolean,
    }
  })
}

async function loadServiceLogs(
  tx: Queryable,
  studentId: string,
  keys: KeyProvider,
): Promise<ServiceLog[]> {
  const { rows } = await tx.query(
    'SELECT * FROM service_logs WHERE student_id = $1 ORDER BY delivered_on ASC',
    [studentId],
  )
  return (rows as Record<string, unknown>[]).map((r) => {
    const id = r['id'] as string
    return {
      serviceId: r['service_id'] as ServiceLog['serviceId'],
      studentId: r['student_id'] as ServiceLog['studentId'],
      deliveredOn: requireDate(r['delivered_on'] as Date, 'delivered_on'),
      minutesDelivered: Number(r['minutes_delivered']),
      providerId: r['provider_id'] as ServiceLog['providerId'],
      providerCredential: r['provider_credential'] as string,
      setting: r['setting'] as ServiceLog['setting'],
      groupSize: Number(r['group_size']),
      narrative:
        opened(
          r['narrative_encrypted'],
          fieldContext(studentId, 'service-log', id, 'narrative'),
          keys,
        ) ?? '',
      status: r['status'] as ServiceLog['status'],
      signedOn: toPlainDate(r['signed_on'] as Date | null),
    }
  })
}
