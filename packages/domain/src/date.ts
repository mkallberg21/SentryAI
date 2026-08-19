/**
 * Calendar dates without time zones.
 *
 * IDEA timelines are counted in whole days against a school calendar, not in
 * instants. Storing a deadline as a timestamp invites a class of bug where a
 * district in Hawaii and a server in Virginia disagree about whether an
 * evaluation was completed on day 60 or day 61. Everything date-shaped in
 * SentryAI is an ISO `YYYY-MM-DD` string interpreted in the district's local
 * calendar, and never a Date.
 */

declare const brand: unique symbol
export type PlainDate = string & { readonly [brand]: 'PlainDate' }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function plainDate(value: string): PlainDate {
  if (!ISO_DATE.test(value)) {
    throw new TypeError(`Expected a YYYY-MM-DD date, received "${value}"`)
  }
  const [y, m, d] = value.split('-').map(Number) as [number, number, number]
  const probe = new Date(Date.UTC(y, m - 1, d))
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m - 1 ||
    probe.getUTCDate() !== d
  ) {
    throw new RangeError(`"${value}" is not a real calendar date`)
  }
  return value as PlainDate
}

export function isPlainDate(value: string): value is PlainDate {
  try {
    plainDate(value)
    return true
  } catch {
    return false
  }
}

const MS_PER_DAY = 86_400_000

function toUtc(date: PlainDate): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return Date.UTC(y, m - 1, d)
}

function fromUtc(ms: number): PlainDate {
  return new Date(ms).toISOString().slice(0, 10) as PlainDate
}

/** Calendar days from `a` to `b`. Negative when `b` precedes `a`. */
export function daysBetween(a: PlainDate, b: PlainDate): number {
  return Math.round((toUtc(b) - toUtc(a)) / MS_PER_DAY)
}

export function addDays(date: PlainDate, days: number): PlainDate {
  return fromUtc(toUtc(date) + days * MS_PER_DAY)
}

export function addYears(date: PlainDate, years: number): PlainDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  // Feb 29 + 1 year clamps to Feb 28 rather than rolling into March, so an
  // annual review anniversary never silently slips a day past its deadline.
  const lastDayOfTargetMonth = new Date(Date.UTC(y + years, m, 0)).getUTCDate()
  return fromUtc(Date.UTC(y + years, m - 1, Math.min(d, lastDayOfTargetMonth)))
}

export function compareDates(a: PlainDate, b: PlainDate): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export const minDate = (a: PlainDate, b: PlainDate): PlainDate => (a <= b ? a : b)
export const maxDate = (a: PlainDate, b: PlainDate): PlainDate => (a >= b ? a : b)

/** Day of week, 0 = Sunday. */
export function dayOfWeek(date: PlainDate): number {
  return new Date(toUtc(date)).getUTCDay()
}

export function isWeekend(date: PlainDate): boolean {
  const d = dayOfWeek(date)
  return d === 0 || d === 6
}

/** Age in whole years on a given date. */
export function ageOn(dateOfBirth: PlainDate, on: PlainDate): number {
  const [by, bm, bd] = dateOfBirth.split('-').map(Number) as [number, number, number]
  const [oy, om, od] = on.split('-').map(Number) as [number, number, number]
  let age = oy - by
  if (om < bm || (om === bm && od < bd)) age -= 1
  return age
}

/** The student's Nth birthday. */
export function birthdayAtAge(dateOfBirth: PlainDate, age: number): PlainDate {
  return addYears(dateOfBirth, age)
}
