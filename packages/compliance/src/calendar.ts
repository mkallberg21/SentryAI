import { addDays, compareDates, daysBetween, isWeekend, type PlainDate } from '@sentryai/domain'

/**
 * A district's instructional calendar.
 *
 * Day counting is where IEP compliance software quietly breaks. Federal
 * timelines are counted in calendar days, most state evaluation timelines in
 * school days, and discipline timelines in school days that exclude any day the
 * student was not in attendance. Getting this wrong by one day is the
 * difference between a clean monitoring visit and a finding, so the counting
 * lives in one place with tests rather than being inlined at each call site.
 */
export interface SchoolCalendar {
  readonly districtId: string
  readonly year: string
  readonly firstInstructionalDay: PlainDate
  readonly lastInstructionalDay: PlainDate
  /** Days school is closed: holidays, breaks, staff development days. */
  readonly nonInstructionalDays: readonly PlainDate[]
  /**
   * Breaks of more than five consecutive school days. Several states exclude
   * these from evaluation timelines, so they are tracked distinctly rather than
   * inferred from gaps in the non-instructional list.
   */
  readonly extendedBreaks: readonly DateRange[]
}

export interface DateRange {
  readonly from: PlainDate
  readonly to: PlainDate
}

export type DayCountBasis =
  /** Every day, including weekends and holidays. */
  | 'calendar'
  /** Monday through Friday, excluding calendar holidays. */
  | 'business'
  /** Days school is actually in session for students. */
  | 'school'

export function inRange(date: PlainDate, range: DateRange): boolean {
  return compareDates(date, range.from) >= 0 && compareDates(date, range.to) <= 0
}

export function isInstructionalDay(cal: SchoolCalendar, date: PlainDate): boolean {
  if (compareDates(date, cal.firstInstructionalDay) < 0) return false
  if (compareDates(date, cal.lastInstructionalDay) > 0) return false
  if (isWeekend(date)) return false
  if (cal.nonInstructionalDays.includes(date)) return false
  return !cal.extendedBreaks.some((b) => inRange(date, b))
}

function isBusinessDay(cal: SchoolCalendar, date: PlainDate): boolean {
  if (isWeekend(date)) return false
  return !cal.nonInstructionalDays.includes(date)
}

function counts(cal: SchoolCalendar, date: PlainDate, basis: DayCountBasis): boolean {
  switch (basis) {
    case 'calendar':
      return true
    case 'business':
      return isBusinessDay(cal, date)
    case 'school':
      return isInstructionalDay(cal, date)
  }
}

/**
 * The date that falls `count` days after `start` on the given basis.
 *
 * The start date itself is day zero -- "60 days from receipt of consent" means
 * the day after consent is day one. Counting the start day as day one is the
 * classic off-by-one that costs districts a day on every evaluation.
 *
 * Guarded against runaway iteration: a school-day count that extends past the
 * end of the calendar year cannot be satisfied, and callers get an explicit
 * failure rather than a silently wrong date.
 */
export function addDaysOnBasis(
  cal: SchoolCalendar,
  start: PlainDate,
  count: number,
  basis: DayCountBasis,
): PlainDate {
  if (basis === 'calendar') return addDays(start, count)

  let remaining = count
  let cursor = start
  let guard = 0
  const maxIterations = count * 10 + 3650

  while (remaining > 0) {
    cursor = addDays(cursor, 1)
    if (counts(cal, cursor, basis)) remaining -= 1
    if (++guard > maxIterations) {
      throw new RangeError(
        `Could not advance ${count} ${basis} days from ${start} within the ${cal.year} calendar`,
      )
    }
  }
  return cursor
}

/** Days elapsed between two dates on the given basis, excluding the start day. */
export function countDaysOnBasis(
  cal: SchoolCalendar,
  from: PlainDate,
  to: PlainDate,
  basis: DayCountBasis,
): number {
  if (basis === 'calendar') return daysBetween(from, to)

  const direction = compareDates(from, to)
  if (direction === 0) return 0

  const [early, late] = direction < 0 ? [from, to] : [to, from]
  let total = 0
  let cursor = early
  while (compareDates(cursor, late) < 0) {
    cursor = addDays(cursor, 1)
    if (counts(cal, cursor, basis)) total += 1
  }
  return direction < 0 ? total : -total
}

/**
 * Advance `count` calendar days, skipping days inside an extended break.
 *
 * This is the correct reading of a rule like California's "60 days, not
 * counting school vacations in excess of five schooldays" (Ed Code 56344).
 *
 * The tempting shortcut -- count 60 days, then add however many break days fell
 * inside that window -- is wrong, because pushing the deadline forward can move
 * it across a break the first pass never saw. A consent received on November 1
 * comes out six days early that way. Counting forward and skipping cannot drift.
 */
export function addCalendarDaysExcludingBreaks(
  cal: SchoolCalendar,
  start: PlainDate,
  count: number,
): PlainDate {
  let remaining = count
  let cursor = start
  let guard = 0
  const maxIterations = count * 10 + 3650

  while (remaining > 0) {
    cursor = addDays(cursor, 1)
    if (!cal.extendedBreaks.some((b) => inRange(cursor, b))) remaining -= 1
    if (++guard > maxIterations) {
      throw new RangeError(
        `Could not advance ${count} non-break days from ${start} within the ${cal.year} calendar`,
      )
    }
  }
  return cursor
}

/**
 * Calendar days falling inside an extended break.
 *
 * California excludes school vacations longer than five days from the 60-day
 * evaluation timeline (Ed Code 56344), so the engine needs this figure to toll
 * the clock correctly rather than flagging a compliant district as late.
 */
export function extendedBreakDaysBetween(
  cal: SchoolCalendar,
  from: PlainDate,
  to: PlainDate,
): number {
  let total = 0
  for (const brk of cal.extendedBreaks) {
    const start = compareDates(brk.from, from) > 0 ? brk.from : from
    const end = compareDates(brk.to, to) < 0 ? brk.to : to
    const span = daysBetween(start, end)
    if (span >= 0) total += span + 1
  }
  return total
}
