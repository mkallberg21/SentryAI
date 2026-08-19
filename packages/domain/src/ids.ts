/**
 * Branded identifiers.
 *
 * Every entity in SentryAI carries a distinct ID type. Special education data
 * is cross-referenced constantly -- a student, their evaluation, their IEP, the
 * meeting that produced it -- and passing the wrong ID into the wrong lookup is
 * the kind of bug that silently attaches one child's services to another child's
 * document. The compiler should catch it, not a due process hearing.
 */

declare const brand: unique symbol

type Brand<T, B extends string> = T & { readonly [brand]: B }

export type StudentId = Brand<string, 'StudentId'>
export type IepId = Brand<string, 'IepId'>
export type GoalId = Brand<string, 'GoalId'>
export type ServiceId = Brand<string, 'ServiceId'>
export type EvaluationId = Brand<string, 'EvaluationId'>
export type MeetingId = Brand<string, 'MeetingId'>
export type ConsentId = Brand<string, 'ConsentId'>
export type NoticeId = Brand<string, 'NoticeId'>
export type UserId = Brand<string, 'UserId'>
export type DistrictId = Brand<string, 'DistrictId'>
export type SchoolId = Brand<string, 'SchoolId'>

export const studentId = (v: string): StudentId => v as StudentId
export const iepId = (v: string): IepId => v as IepId
export const goalId = (v: string): GoalId => v as GoalId
export const serviceId = (v: string): ServiceId => v as ServiceId
export const evaluationId = (v: string): EvaluationId => v as EvaluationId
export const meetingId = (v: string): MeetingId => v as MeetingId
export const consentId = (v: string): ConsentId => v as ConsentId
export const noticeId = (v: string): NoticeId => v as NoticeId
export const userId = (v: string): UserId => v as UserId
export const districtId = (v: string): DistrictId => v as DistrictId
export const schoolId = (v: string): SchoolId => v as SchoolId
