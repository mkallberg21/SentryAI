import { goalId, iepId, serviceId, studentId, userId } from '@sentryai/domain'
import { describe, expect, it } from 'vitest'
import {
  date,
  makeContext,
  makeEvaluation,
  makeIep,
  makeMeeting,
  makeNotice,
} from '../__fixtures__/index.js'
import { evaluateStudent, summarize } from '../engine.js'
import { CALIFORNIA_POLICY } from '../packs/california.js'
import { TEXAS_POLICY } from '../packs/texas.js'
import type { Finding, Rule, RuleContext } from '../types.js'
import {
  aiContentRequiresHumanAcceptance,
  lreJustification,
  measurableGoals,
  nativeLanguageNotice,
  priorWrittenNoticeContent,
  teamComposition,
} from './documents.js'
import { serviceDeliveryShortfall } from './services.js'
import {
  annualReviewTimeline,
  initialEvaluationTimeline,
  meetingNoticeLeadTime,
  transitionPlanRequired,
} from './timelines.js'

const run = (rule: Rule, ctx: RuleContext): Finding[] => rule.evaluate(ctx)

describe('initial evaluation timeline', () => {
  it('is silent while the evaluation is comfortably within the window', () => {
    const ctx = makeContext({
      asOf: date('2025-09-20'),
      evaluations: [makeEvaluation({ consentReceivedOn: date('2025-09-15') })],
    })
    expect(run(initialEvaluationTimeline, ctx)).toHaveLength(0)
  })

  it('warns inside the at-risk window before the deadline passes', () => {
    // Consent Sep 15 + 60 calendar days = Nov 14. At Nov 1 that is 13 days out.
    const ctx = makeContext({
      asOf: date('2025-11-01'),
      evaluations: [makeEvaluation({ consentReceivedOn: date('2025-09-15') })],
    })
    const [f] = run(initialEvaluationTimeline, ctx)
    expect(f?.severity).toBe('at-risk')
    expect(f?.dueOn).toBe('2025-11-14')
    expect(f?.daysRemaining).toBe(13)
  })

  it('reports a violation once the deadline passes with no determination', () => {
    const ctx = makeContext({
      asOf: date('2025-11-20'),
      evaluations: [makeEvaluation({ consentReceivedOn: date('2025-09-15') })],
    })
    const [f] = run(initialEvaluationTimeline, ctx)
    expect(f?.severity).toBe('violation')
    expect(f?.message).toContain('6 day(s) overdue')
  })

  it('reports a completed-but-late evaluation, not just an open one', () => {
    const ctx = makeContext({
      asOf: date('2026-01-15'),
      evaluations: [
        makeEvaluation({
          consentReceivedOn: date('2025-09-15'),
          status: 'eligibility-determined',
          eligibilityDeterminedOn: date('2025-11-20'),
        }),
      ],
    })
    const [f] = run(initialEvaluationTimeline, ctx)
    expect(f?.severity).toBe('violation')
    expect(f?.message).toContain('6 day(s) past')
    expect(f?.remedy).toContain('compensatory')
  })

  it('extends the deadline for a lawfully tolled period', () => {
    const ctx = makeContext({
      asOf: date('2025-11-20'),
      evaluations: [
        makeEvaluation({
          consentReceivedOn: date('2025-09-15'),
          tolledPeriods: [
            {
              from: date('2025-10-01'),
              to: date('2025-10-14'),
              reason: 'parent-unavailable',
              note: 'Parent did not produce the student for three scheduled sessions.',
            },
          ],
        }),
      ],
    })
    // 14 tolled days push Nov 14 out to Nov 28, so Nov 20 is at-risk, not late.
    const [f] = run(initialEvaluationTimeline, ctx)
    expect(f?.severity).toBe('at-risk')
    expect(f?.dueOn).toBe('2025-11-28')
  })

  it('excludes extended breaks in California but not under the federal baseline', () => {
    const evaluations = [makeEvaluation({ consentReceivedOn: date('2025-11-01') })]

    const federal = makeContext({ asOf: date('2026-01-05'), evaluations })
    const california = makeContext({
      asOf: date('2026-01-05'),
      evaluations,
      policy: CALIFORNIA_POLICY,
    })

    const [fed] = run(initialEvaluationTimeline, federal)
    const [ca] = run(initialEvaluationTimeline, california)

    expect(fed?.dueOn).toBe('2025-12-31')
    expect(fed?.severity).toBe('violation')
    // California tolls the 5-day Thanksgiving and 12-day winter breaks.
    expect(ca?.dueOn).toBe('2026-01-17')
    expect(ca?.severity).toBe('at-risk')
  })

  it('counts school days in Texas, so the same facts are late federally but not yet in Texas', () => {
    const evaluations = [makeEvaluation({ consentReceivedOn: date('2025-09-15') })]
    const asOf = date('2025-11-16')

    const [fed] = run(initialEvaluationTimeline, makeContext({ asOf, evaluations }))
    const [tx] = run(
      initialEvaluationTimeline,
      makeContext({ asOf, evaluations, policy: TEXAS_POLICY }),
    )

    // 60 calendar days from Sep 15 is Nov 14 -- already past.
    expect(fed?.dueOn).toBe('2025-11-14')
    expect(fed?.severity).toBe('violation')

    // 45 school days is Nov 18, because weekends and the Nov 11 holiday do not
    // count. Identical facts, and the district still has two days.
    expect(tx?.dueOn).toBe('2025-11-18')
    expect(tx?.severity).toBe('at-risk')
  })
})

describe('annual review timeline', () => {
  it('flags an expired IEP as a violation', () => {
    const ctx = makeContext({
      asOf: date('2026-09-15'),
      ieps: [makeIep({ annualReviewDueOn: date('2026-08-31') })],
    })
    const [f] = run(annualReviewTimeline, ctx)
    expect(f?.severity).toBe('violation')
    expect(f?.message).toContain('has expired')
  })

  it('ignores superseded IEPs', () => {
    const ctx = makeContext({
      asOf: date('2026-09-15'),
      ieps: [makeIep({ status: 'superseded', annualReviewDueOn: date('2026-08-31') })],
    })
    expect(run(annualReviewTimeline, ctx)).toHaveLength(0)
  })
})

describe('meeting notice lead time', () => {
  it('accepts notice sent with the full lead time', () => {
    const ctx = makeContext({ meetings: [makeMeeting()] })
    expect(run(meetingNoticeLeadTime, ctx)).toHaveLength(0)
  })

  it('flags short notice on a meeting that already happened', () => {
    const ctx = makeContext({
      meetings: [makeMeeting({ noticeSentOn: date('2025-08-28'), heldOn: date('2025-09-01') })],
    })
    const [f] = run(meetingNoticeLeadTime, ctx)
    expect(f?.severity).toBe('violation')
    expect(f?.remedy).toContain('Document parental agreement')
  })

  it('does not penalize short notice the parent asked for', () => {
    const ctx = makeContext({
      meetings: [
        makeMeeting({
          noticeSentOn: date('2025-08-28'),
          heldOn: date('2025-09-01'),
          parentRequestedReschedule: true,
        }),
      ],
    })
    expect(run(meetingNoticeLeadTime, ctx)).toHaveLength(0)
  })

  it('flags a missing notice on an upcoming meeting as at-risk, not a violation', () => {
    const ctx = makeContext({
      meetings: [makeMeeting({ noticeSentOn: null, heldOn: null, scheduledFor: date('2025-10-20') })],
    })
    const [f] = run(meetingNoticeLeadTime, ctx)
    expect(f?.severity).toBe('at-risk')
  })
})

describe('team composition', () => {
  it('flags a meeting held without the general education teacher', () => {
    const base = makeMeeting()
    const ctx = makeContext({
      meetings: [
        makeMeeting({
          attendance: base.attendance.filter((a) => a.role !== 'general-education-teacher'),
        }),
      ],
    })
    const [f] = run(teamComposition, ctx)
    expect(f?.severity).toBe('violation')
    expect(f?.message).toContain('general education teacher')
  })

  it('accepts a proper excusal with written input', () => {
    const base = makeMeeting()
    const ctx = makeContext({
      meetings: [
        makeMeeting({
          attendance: [
            ...base.attendance.filter((a) => a.role !== 'general-education-teacher'),
            {
              userId: userId('u2'),
              name: 'A Teacher',
              role: 'general-education-teacher',
              status: 'excused-with-consent',
              writtenInputProvided: true,
            },
          ],
        }),
      ],
    })
    expect(run(teamComposition, ctx)).toHaveLength(0)
  })

  it('rejects an excusal with no written input', () => {
    const base = makeMeeting()
    const ctx = makeContext({
      meetings: [
        makeMeeting({
          attendance: [
            ...base.attendance.filter((a) => a.role !== 'general-education-teacher'),
            {
              userId: userId('u2'),
              name: 'A Teacher',
              role: 'general-education-teacher',
              status: 'excused-with-consent',
              writtenInputProvided: false,
            },
          ],
        }),
      ],
    })
    expect(run(teamComposition, ctx)).toHaveLength(1)
  })
})

describe('prior written notice content', () => {
  it('accepts a complete notice', () => {
    const ctx = makeContext({ notices: [makeNotice()] })
    expect(run(priorWrittenNoticeContent, ctx)).toHaveLength(0)
  })

  it('names each missing element', () => {
    const base = makeNotice()
    const ctx = makeContext({
      notices: [
        makeNotice({
          content: { ...base.content!, otherOptionsConsidered: '', reasonsOptionsRejected: '   ' },
        }),
      ],
    })
    const [f] = run(priorWrittenNoticeContent, ctx)
    expect(f?.message).toContain('missing 2 required element(s)')
    expect(f?.message).toContain('other options')
  })
})

describe('native language notice', () => {
  const spanishFamily = {
    student: {
      ...makeContext().student,
      homeLanguage: 'Spanish',
      decisionMakers: [{ kind: 'parent' as const, name: 'Madre', preferredLanguage: 'Spanish' }],
    },
  }

  it('flags an English notice sent to a Spanish-speaking family', () => {
    const ctx = makeContext({ ...spanishFamily, notices: [makeNotice({ language: 'English' })] })
    const [f] = run(nativeLanguageNotice, ctx)
    expect(f?.severity).toBe('violation')
    expect(f?.remedy).toContain('Spanish')
  })

  it('flags a translated notice that no human reviewed', () => {
    const ctx = makeContext({
      ...spanishFamily,
      notices: [makeNotice({ language: 'Spanish', translationReviewedBy: null })],
    })
    const [f] = run(nativeLanguageNotice, ctx)
    expect(f?.severity).toBe('weak-documentation')
    expect(f?.message).toContain('no recorded human reviewer')
  })

  it('is satisfied by a reviewed translation', () => {
    const ctx = makeContext({
      ...spanishFamily,
      notices: [makeNotice({ language: 'Spanish', translationReviewedBy: userId('u-bilingual') })],
    })
    expect(run(nativeLanguageNotice, ctx)).toHaveLength(0)
  })
})

describe('least restrictive environment', () => {
  it('is silent for full general education placement', () => {
    const ctx = makeContext({
      ieps: [
        makeIep({
          placement: {
            percentInGeneralEducation: 100,
            settingCode: 'REG100',
            removalJustification: null,
            supplementaryAidsConsidered: [],
          },
        }),
      ],
    })
    expect(run(lreJustification, ctx)).toHaveLength(0)
  })

  it('requires a written justification for any removal', () => {
    const ctx = makeContext({
      ieps: [
        makeIep({
          placement: {
            percentInGeneralEducation: 40,
            settingCode: 'SEP',
            removalJustification: '  ',
            supplementaryAidsConsidered: [],
          },
        }),
      ],
    })
    const findings = run(lreJustification, ctx)
    expect(findings.map((f) => f.severity)).toEqual(['violation', 'weak-documentation'])
    expect(findings[0]?.message).toContain('60% of the day outside')
  })
})

describe('measurable goals', () => {
  it('rejects a goal whose baseline and target use different units', () => {
    const base = makeIep()
    const ctx = makeContext({
      ieps: [
        makeIep({
          goals: [
            {
              ...base.goals[0]!,
              baseline: { value: 78, unit: 'percent accuracy', condition: 'cold read' },
              target: { value: 4, unit: 'reading level', condition: 'cold read' },
            },
          ],
        }),
      ],
    })
    const [f] = run(measurableGoals, ctx)
    expect(f?.message).toContain('progress cannot be computed')
  })

  it('flags an IEP with no goals at all', () => {
    const ctx = makeContext({ ieps: [makeIep({ goals: [] })] })
    expect(run(measurableGoals, ctx)[0]?.message).toContain('no annual goals')
  })
})

describe('AI governance rule', () => {
  it('blocks AI-drafted content that no human accepted', () => {
    const base = makeIep()
    const ctx = makeContext({
      ieps: [
        makeIep({
          presentLevelsProvenance: {
            source: 'ai-drafted',
            authoredBy: userId('system'),
            acceptedBy: null,
            acceptedOn: null,
            modelId: 'claude-opus-5',
          },
          goals: [
            {
              ...base.goals[0]!,
              provenance: {
                source: 'ai-drafted',
                authoredBy: userId('system'),
                acceptedBy: null,
                acceptedOn: null,
                modelId: 'claude-opus-5',
              },
            },
          ],
        }),
      ],
    })
    const [f] = run(aiContentRequiresHumanAcceptance, ctx)
    expect(f?.severity).toBe('violation')
    expect(f?.message).toContain('present levels')
    expect(f?.message).toContain('reading goal')
  })

  it('passes once a person accepted the draft', () => {
    const base = makeIep()
    const ctx = makeContext({
      ieps: [
        makeIep({
          goals: [
            {
              ...base.goals[0]!,
              provenance: {
                source: 'ai-drafted',
                authoredBy: userId('system'),
                acceptedBy: userId('user-case-manager'),
                acceptedOn: date('2025-09-01'),
                modelId: 'claude-opus-5',
              },
            },
          ],
        }),
      ],
    })
    expect(run(aiContentRequiresHumanAcceptance, ctx)).toHaveLength(0)
  })
})

describe('service delivery', () => {
  const service = makeIep().services[0]!

  it('is silent when delivery matches the offer', () => {
    // 4 sessions x 30 min per week over 60 days is about 34 sessions.
    const logs = Array.from({ length: 34 }, (_, i) => ({
      serviceId: service.id,
      studentId: studentId('student-1'),
      deliveredOn: date(`2025-10-${String((i % 28) + 1).padStart(2, '0')}`),
      minutesDelivered: 30,
      providerId: userId('u-provider'),
      providerCredential: 'Education Specialist',
      setting: 'special-education' as const,
      groupSize: 3,
      narrative: 'Decoding drill and guided reading.',
      status: 'delivered' as const,
      signedOn: date('2025-10-31'),
    }))
    const ctx = makeContext({ asOf: date('2025-11-01'), ieps: [makeIep()], serviceLogs: logs })
    expect(run(serviceDeliveryShortfall, ctx)).toHaveLength(0)
  })

  it('flags a severe shortfall as a violation', () => {
    const ctx = makeContext({ asOf: date('2025-11-01'), ieps: [makeIep()], serviceLogs: [] })
    const [f] = run(serviceDeliveryShortfall, ctx)
    expect(f?.severity).toBe('violation')
    expect(f?.message).toContain('0% of offered minutes')
    expect(f?.remedy).toContain('compensatory')
  })
})

describe('transition planning', () => {
  it('follows the state age, flagging at 14 in Texas and not yet in California', () => {
    // Student born 2012-04-15 is 13 on 2025-10-01 and turns 14 in April 2026.
    const ieps = [makeIep({ annualReviewDueOn: date('2026-08-31'), transitionPlan: null })]

    const texas = makeContext({ ieps, policy: TEXAS_POLICY })
    const california = makeContext({ ieps, policy: CALIFORNIA_POLICY })

    expect(run(transitionPlanRequired, texas)).toHaveLength(1)
    expect(run(transitionPlanRequired, california)).toHaveLength(0)
  })
})

describe('engine', () => {
  it('sorts violations ahead of at-risk findings', () => {
    const ctx = makeContext({
      asOf: date('2026-09-15'),
      ieps: [makeIep({ annualReviewDueOn: date('2026-08-31'), goals: [] })],
      meetings: [makeMeeting({ noticeSentOn: null })],
    })
    const findings = evaluateStudent(ctx)
    expect(findings.length).toBeGreaterThan(1)
    const severities = findings.map((f) => f.severity)
    expect(severities.indexOf('violation')).toBeLessThan(
      severities.lastIndexOf('at-risk') === -1 ? Infinity : severities.lastIndexOf('at-risk'),
    )
  })

  it('contains a throwing rule instead of blanking the student', () => {
    const exploding: Rule = {
      id: 'test.explodes',
      title: 'Rule that throws',
      citation: 'n/a',
      source: 'district',
      evaluate() {
        throw new Error('boom')
      },
    }
    const findings = evaluateStudent(makeContext(), [exploding, annualReviewTimeline])
    expect(findings).toHaveLength(1)
    expect(findings[0]?.message).toContain('could not be evaluated')
    expect(findings[0]?.message).toContain('boom')
  })

  it('counts a student with only weak documentation as clear', () => {
    const byStudent = new Map<string, Finding[]>([
      ['a', []],
      [
        'b',
        [
          {
            ruleId: 'x',
            severity: 'weak-documentation',
            studentId: 'b',
            message: '',
            citation: '',
            remedy: null,
            dueOn: null,
            daysRemaining: null,
            subject: { kind: 'student', id: 'b' },
          },
        ],
      ],
      [
        'c',
        [
          {
            ruleId: 'y',
            severity: 'violation',
            studentId: 'c',
            message: '',
            citation: '',
            remedy: null,
            dueOn: null,
            daysRemaining: null,
            subject: { kind: 'student', id: 'c' },
          },
        ],
      ],
    ])
    const summary = summarize(byStudent)
    expect(summary.studentsEvaluated).toBe(3)
    expect(summary.studentsClear).toBe(2)
    expect(summary.violations).toBe(1)
  })
})

// Referenced to keep the import list honest about what the suite covers.
void iepId
void goalId
void serviceId
