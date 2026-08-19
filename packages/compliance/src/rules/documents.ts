import { missingPwnElements, unexcusedMissingRoles } from '@sentryai/domain'
import type { Finding, Rule, RuleContext } from '../types.js'
import { activeIep, familyLanguage, finding, isBlank } from './helpers.js'

/** Every required IEP team role present, or properly excused. */
export const teamComposition: Rule = {
  id: 'meeting.team-composition',
  title: 'Required IEP team members present or properly excused',
  citation: '34 CFR 300.321(a), (e)',
  source: 'federal',
  evaluate(ctx: RuleContext): Finding[] {
    const out: Finding[] = []
    for (const meeting of ctx.meetings) {
      if (meeting.heldOn === null) continue
      const missing = unexcusedMissingRoles(meeting)
      if (missing.length === 0) continue

      out.push(
        finding(
          this.id,
          ctx,
          'violation',
          { kind: 'meeting', id: meeting.id },
          `Meeting on ${meeting.heldOn} was held without ${missing.map((r) => r.replace(/-/g, ' ')).join(', ')}, and without a written excusal.`,
          this.citation,
          {
            remedy:
              'Obtain written parental consent to the excusal with the member’s written input, or reconvene with the full team.',
          },
        ),
      )
    }
    return out
  },
}

/** An interpreter was provided when the family needs one. */
export const interpreterProvided: Rule = {
  id: 'meeting.interpreter',
  title: 'Interpreter provided when the family needs one to participate',
  citation: '34 CFR 300.322(e)',
  source: 'federal',
  evaluate(ctx: RuleContext): Finding[] {
    const language = familyLanguage(ctx)
    if (language.toLowerCase() === 'english') return []

    return ctx.meetings
      .filter((m) => m.heldOn !== null && !m.interpreterProvided)
      .map((m) =>
        finding(
          this.id,
          ctx,
          'violation',
          { kind: 'meeting', id: m.id },
          `Meeting on ${m.heldOn} was held without an interpreter, but the family’s language is ${language}.`,
          this.citation,
          {
            remedy:
              'Document that the parent declined an interpreter, or reconvene with interpretation provided.',
          },
        ),
      )
  },
}

/** Prior Written Notice contains all six required content elements. */
export const priorWrittenNoticeContent: Rule = {
  id: 'notice.pwn-content',
  title: 'Prior Written Notice contains all required elements',
  citation: '34 CFR 300.503(b)',
  source: 'federal',
  evaluate(ctx: RuleContext): Finding[] {
    const out: Finding[] = []
    for (const notice of ctx.notices) {
      if (notice.kind !== 'prior-written-notice') continue

      if (notice.content === null) {
        out.push(
          finding(
            this.id,
            ctx,
            'violation',
            { kind: 'notice', id: notice.id },
            `Prior Written Notice sent ${notice.sentOn} has no recorded content.`,
            this.citation,
            { remedy: 'Attach the notice content to the record, or reissue the notice.' },
          ),
        )
        continue
      }

      const missing = missingPwnElements(notice.content)
      if (missing.length > 0) {
        out.push(
          finding(
            this.id,
            ctx,
            'violation',
            { kind: 'notice', id: notice.id },
            `Prior Written Notice sent ${notice.sentOn} is missing ${missing.length} required element(s): ${missing.join('; ')}.`,
            this.citation,
            { remedy: 'Reissue the notice with the missing elements completed.' },
          ),
        )
      }
    }
    return out
  },
}

/**
 * Notices go to the parent in their native language.
 *
 * Paired with a check that a machine translation was reviewed by a human before
 * it went out -- an unreviewed automatic translation of a legally operative
 * notice is a procedural risk, not a convenience feature.
 */
export const nativeLanguageNotice: Rule = {
  id: 'notice.native-language',
  title: 'Notices provided in the parent’s native language',
  citation: '34 CFR 300.503(c)',
  source: 'federal',
  evaluate(ctx: RuleContext): Finding[] {
    const language = familyLanguage(ctx)
    const out: Finding[] = []

    for (const notice of ctx.notices) {
      const legallyOperative =
        notice.kind === 'prior-written-notice' ||
        notice.kind === 'meeting-invitation' ||
        notice.kind === 'procedural-safeguards'
      if (!legallyOperative) continue

      if (notice.language.toLowerCase() !== language.toLowerCase()) {
        out.push(
          finding(
            this.id,
            ctx,
            'violation',
            { kind: 'notice', id: notice.id },
            `Notice sent ${notice.sentOn} was in ${notice.language}, but the family’s native language is ${language}.`,
            this.citation,
            {
              remedy: `Reissue the notice in ${language}, or document why that was not feasible.`,
            },
          ),
        )
        continue
      }

      if (language.toLowerCase() !== 'english' && notice.translationReviewedBy === null) {
        out.push(
          finding(
            this.id,
            ctx,
            'weak-documentation',
            { kind: 'notice', id: notice.id },
            `Translated notice sent ${notice.sentOn} has no recorded human reviewer.`,
            'SentryAI translation governance policy',
            {
              remedy:
                'Have a qualified reviewer confirm the translation and record their name against the notice.',
            },
          ),
        )
      }
    }
    return out
  },
}

/** Removal from general education is justified in writing. */
export const lreJustification: Rule = {
  id: 'iep.lre-justification',
  title: 'Removal from general education is justified',
  citation: '34 CFR 300.114(a)(2), 300.320(a)(5)',
  source: 'federal',
  evaluate(ctx: RuleContext): Finding[] {
    const iep = activeIep(ctx)
    if (iep === null) return []
    if (iep.placement.percentInGeneralEducation >= 100) return []

    const out: Finding[] = []

    if (isBlank(iep.placement.removalJustification)) {
      out.push(
        finding(
          this.id,
          ctx,
          'violation',
          { kind: 'iep', id: iep.id },
          `Student spends ${100 - iep.placement.percentInGeneralEducation}% of the day outside general education with no written justification.`,
          this.citation,
          {
            remedy:
              'Record why education in general education with supplementary aids and services cannot be achieved satisfactorily.',
          },
        ),
      )
    }

    if (iep.placement.supplementaryAidsConsidered.length === 0) {
      out.push(
        finding(
          this.id,
          ctx,
          'weak-documentation',
          { kind: 'iep', id: iep.id },
          'No supplementary aids and services are recorded as considered before removal.',
          this.citation,
          { remedy: 'Document the aids and services the team considered and why they were insufficient.' },
        ),
      )
    }

    return out
  },
}

/** Annual goals are actually measurable. */
export const measurableGoals: Rule = {
  id: 'iep.measurable-goals',
  title: 'Annual goals are measurable',
  citation: '34 CFR 300.320(a)(2)',
  source: 'federal',
  evaluate(ctx: RuleContext): Finding[] {
    const iep = activeIep(ctx)
    if (iep === null) return []

    const out: Finding[] = []

    if (iep.goals.length === 0) {
      out.push(
        finding(
          this.id,
          ctx,
          'violation',
          { kind: 'iep', id: iep.id },
          'The IEP contains no annual goals.',
          this.citation,
          { remedy: 'Add measurable annual goals in each area of identified need.' },
        ),
      )
      return out
    }

    for (const goal of iep.goals) {
      const problems: string[] = []
      if (isBlank(goal.statement)) problems.push('no goal statement')
      if (isBlank(goal.baseline.condition)) problems.push('no baseline condition')
      if (isBlank(goal.target.condition)) problems.push('no target condition')
      if (goal.target.unit !== goal.baseline.unit) {
        problems.push(
          `baseline is in ${goal.baseline.unit} but the target is in ${goal.target.unit}, so progress cannot be computed`,
        )
      }

      if (problems.length > 0) {
        out.push(
          finding(
            this.id,
            ctx,
            'violation',
            { kind: 'iep', id: iep.id },
            `Goal in ${goal.area} is not measurable as written: ${problems.join('; ')}.`,
            this.citation,
            { remedy: 'Rewrite the goal with a baseline and target in the same unit and a stated condition.' },
          ),
        )
      }
    }

    return out
  },
}

/** Extended school year was considered, and the decision was recorded. */
export const esyConsidered: Rule = {
  id: 'iep.esy-considered',
  title: 'Extended school year services considered',
  citation: '34 CFR 300.106',
  source: 'federal',
  evaluate(ctx: RuleContext): Finding[] {
    const iep = activeIep(ctx)
    if (iep === null) return []

    if (!iep.extendedSchoolYear.considered) {
      return [
        finding(
          this.id,
          ctx,
          'violation',
          { kind: 'iep', id: iep.id },
          'The IEP does not record whether extended school year services were considered.',
          this.citation,
          { remedy: 'Document the team’s ESY determination and the basis for it.' },
        ),
      ]
    }

    if (!iep.extendedSchoolYear.eligible && isBlank(iep.extendedSchoolYear.justification)) {
      return [
        finding(
          this.id,
          ctx,
          'weak-documentation',
          { kind: 'iep', id: iep.id },
          'ESY was declined without a recorded justification.',
          this.citation,
          { remedy: 'Record why the student does not require ESY to receive FAPE.' },
        ),
      ]
    }

    return []
  },
}

/**
 * No AI-drafted content reaches a signed IEP without a named human acceptance.
 *
 * This is SentryAI's own rule rather than a federal one, and it is the reason
 * the platform can put a model anywhere near an IEP at all. An active document
 * containing model output that nobody accepted is treated as a violation with
 * the same weight as a missed deadline, because in a due process hearing it
 * would be worse.
 */
export const aiContentRequiresHumanAcceptance: Rule = {
  id: 'governance.ai-human-acceptance',
  title: 'AI-drafted content was reviewed and accepted by a person',
  citation: 'SentryAI AI governance policy; 34 CFR 300.320(a) (IEP is the team’s determination)',
  source: 'district',
  evaluate(ctx: RuleContext): Finding[] {
    const out: Finding[] = []

    for (const iep of ctx.ieps) {
      if (iep.status !== 'active' && iep.status !== 'proposed') continue

      const unaccepted: string[] = []

      const pl = iep.presentLevelsProvenance
      if (pl.source !== 'human' && pl.acceptedBy === null) {
        unaccepted.push('present levels')
      }
      for (const goal of iep.goals) {
        if (goal.provenance.source !== 'human' && goal.provenance.acceptedBy === null) {
          unaccepted.push(`the ${goal.area} goal`)
        }
      }

      if (unaccepted.length > 0) {
        out.push(
          finding(
            this.id,
            ctx,
            'violation',
            { kind: 'iep', id: iep.id },
            `AI-drafted content reached a ${iep.status} IEP without human acceptance: ${unaccepted.join(', ')}.`,
            this.citation,
            {
              remedy:
                'A credentialed team member must review and accept each drafted section before the IEP is finalized.',
            },
          ),
        )
      }
    }

    return out
  },
}

export const DOCUMENT_RULES: readonly Rule[] = [
  teamComposition,
  interpreterProvided,
  priorWrittenNoticeContent,
  nativeLanguageNotice,
  lreJustification,
  measurableGoals,
  esyConsidered,
  aiContentRequiresHumanAcceptance,
]
