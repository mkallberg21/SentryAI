import {
  consentId,
  districtId,
  evaluationId,
  goalId,
  iepId,
  meetingId,
  noticeId,
  plainDate,
  schoolId,
  serviceId,
  studentId,
  userId,
  type Evaluation,
  type Iep,
  type Meeting,
  type Notice,
  type PlainDate,
  type Student,
} from '@sentryai/domain'
import type { SchoolCalendar } from '../calendar.js'
import { FEDERAL_POLICY } from '../packs/federal.js'
import type { RuleContext } from '../types.js'

const d = plainDate

/**
 * A 2025-26 calendar with the breaks that actually trip up day counting:
 * a week at Thanksgiving, two weeks at winter, and a week in spring.
 */
export const CALENDAR_2025_26: SchoolCalendar = {
  districtId: 'district-1',
  year: '2025-2026',
  firstInstructionalDay: d('2025-08-18'),
  lastInstructionalDay: d('2026-06-05'),
  nonInstructionalDays: [d('2025-09-01'), d('2025-11-11'), d('2026-01-19'), d('2026-02-16')],
  extendedBreaks: [
    { from: d('2025-11-24'), to: d('2025-11-28') },
    { from: d('2025-12-22'), to: d('2026-01-02') },
    { from: d('2026-03-30'), to: d('2026-04-03') },
  ],
}

export function makeStudent(overrides: Partial<Student> = {}): Student {
  return {
    id: studentId('student-1'),
    districtId: districtId('district-1'),
    schoolId: schoolId('school-1'),
    localId: 'L-1001',
    stateId: 'S-9001',
    firstName: 'Test',
    lastName: 'Student',
    dateOfBirth: d('2012-04-15'),
    gradeLevel: '7',
    homeLanguage: 'English',
    decisionMakers: [{ kind: 'parent', name: 'Test Parent', preferredLanguage: 'English' }],
    enrolledOn: d('2024-08-19'),
    exitedOn: null,
    ...overrides,
  }
}

export function makeEvaluation(overrides: Partial<Evaluation> = {}): Evaluation {
  return {
    id: evaluationId('eval-1'),
    studentId: studentId('student-1'),
    kind: 'initial',
    status: 'in-progress',
    referredOn: d('2025-09-02'),
    consentRequestedOn: d('2025-09-05'),
    consentReceivedOn: d('2025-09-15'),
    consentId: consentId('consent-1'),
    reportCompletedOn: null,
    eligibilityDeterminedOn: null,
    assignedTo: userId('user-psych'),
    tolledPeriods: [],
    ...overrides,
  }
}

export function makeIep(overrides: Partial<Iep> = {}): Iep {
  return {
    id: iepId('iep-1'),
    studentId: studentId('student-1'),
    kind: 'annual',
    status: 'active',
    primaryDisability: 'specific-learning-disability',
    secondaryDisabilities: [],
    meetingId: meetingId('meeting-1'),
    effectiveOn: d('2025-09-01'),
    annualReviewDueOn: d('2026-08-31'),
    presentLevels: 'Reads at a fourth-grade level with grade-level comprehension supports.',
    presentLevelsProvenance: {
      source: 'human',
      authoredBy: userId('user-case-manager'),
      acceptedBy: userId('user-case-manager'),
      acceptedOn: d('2025-09-01'),
      modelId: null,
    },
    goals: [
      {
        id: goalId('goal-1'),
        area: 'reading',
        statement:
          'Given a grade-level passage, the student will read aloud with 95% accuracy in 4 of 5 trials.',
        baseline: { value: 78, unit: 'percent accuracy', condition: 'grade-level passage, cold read' },
        target: { value: 95, unit: 'percent accuracy', condition: 'grade-level passage, cold read' },
        measurementMethod: 'curriculum-based-measurement',
        reportingFrequency: 'quarterly',
        objectives: [],
        provenance: {
          source: 'human',
          authoredBy: userId('user-case-manager'),
          acceptedBy: userId('user-case-manager'),
          acceptedOn: d('2025-09-01'),
          modelId: null,
        },
      },
    ],
    services: [
      {
        id: serviceId('service-1'),
        type: 'specialized-academic-instruction',
        minutesPerSession: 30,
        sessionsPerPeriod: 4,
        period: 'week',
        setting: 'special-education',
        providerRole: 'Education Specialist',
        startsOn: d('2025-09-01'),
        endsOn: d('2026-08-31'),
        medicaidBillable: false,
      },
    ],
    placement: {
      percentInGeneralEducation: 80,
      settingCode: 'REG80',
      removalJustification:
        'Intensive decoding instruction cannot be delivered in the general education setting without reducing access to core content.',
      supplementaryAidsConsidered: ['Push-in reading support', 'Preferential seating'],
    },
    accommodations: [],
    transitionPlan: null,
    extendedSchoolYear: { considered: true, eligible: false, justification: 'No regression documented over breaks.' },
    signedOn: d('2025-09-01'),
    supersedesIepId: null,
    ...overrides,
  }
}

export function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: meetingId('meeting-1'),
    studentId: studentId('student-1'),
    purpose: 'annual-review',
    noticeSentOn: d('2025-08-15'),
    scheduledFor: d('2025-09-01'),
    heldOn: d('2025-09-01'),
    attendance: [
      { userId: null, name: 'Test Parent', role: 'parent', status: 'attended', writtenInputProvided: false },
      { userId: userId('u2'), name: 'A Teacher', role: 'general-education-teacher', status: 'attended', writtenInputProvided: false },
      { userId: userId('u3'), name: 'B Specialist', role: 'special-education-teacher', status: 'attended', writtenInputProvided: false },
      { userId: userId('u4'), name: 'C Admin', role: 'lea-representative', status: 'attended', writtenInputProvided: false },
    ],
    interpreterProvided: false,
    interpreterLanguage: null,
    rescheduledFrom: [],
    parentRequestedReschedule: false,
    ...overrides,
  }
}

export function makeNotice(overrides: Partial<Notice> = {}): Notice {
  return {
    id: noticeId('notice-1'),
    studentId: studentId('student-1'),
    kind: 'prior-written-notice',
    sentOn: d('2025-08-20'),
    delivery: 'mail',
    language: 'English',
    translationReviewedBy: null,
    content: {
      actionProposedOrRefused: 'Continue specialized academic instruction at 120 minutes weekly.',
      explanationOfWhy: 'Progress data show continued need for intensive decoding support.',
      evaluationProceduresRelied: 'Curriculum-based measurement, teacher report, work samples.',
      otherOptionsConsidered: 'Full general education placement with push-in support.',
      reasonsOptionsRejected: 'Push-in support did not produce sufficient growth in the prior year.',
      otherFactorsRelevant: 'None.',
    },
    documentUri: null,
    ...overrides,
  }
}

export function makeContext(overrides: Partial<RuleContext> = {}): RuleContext {
  return {
    asOf: d('2025-10-01'),
    student: makeStudent(),
    calendar: CALENDAR_2025_26,
    policy: FEDERAL_POLICY,
    evaluations: [],
    ieps: [],
    meetings: [],
    notices: [],
    consents: [],
    progress: [],
    serviceLogs: [],
    ...overrides,
  }
}

export const date = (v: string): PlainDate => d(v)
