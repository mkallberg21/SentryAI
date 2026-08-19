import { describe, expect, it } from 'vitest'
import { CALENDAR_2025_26, date } from './__fixtures__/index.js'
import {
  addDaysOnBasis,
  countDaysOnBasis,
  extendedBreakDaysBetween,
  isInstructionalDay,
} from './calendar.js'

describe('school calendar', () => {
  it('treats weekends, holidays, and breaks as non-instructional', () => {
    expect(isInstructionalDay(CALENDAR_2025_26, date('2025-09-03'))).toBe(true)
    // Labor Day.
    expect(isInstructionalDay(CALENDAR_2025_26, date('2025-09-01'))).toBe(false)
    // Saturday.
    expect(isInstructionalDay(CALENDAR_2025_26, date('2025-09-06'))).toBe(false)
    // Inside winter break.
    expect(isInstructionalDay(CALENDAR_2025_26, date('2025-12-24'))).toBe(false)
    // Before the year starts.
    expect(isInstructionalDay(CALENDAR_2025_26, date('2025-07-04'))).toBe(false)
  })
})

describe('addDaysOnBasis', () => {
  it('counts calendar days straight through breaks', () => {
    expect(addDaysOnBasis(CALENDAR_2025_26, date('2025-09-15'), 60, 'calendar')).toBe('2025-11-14')
  })

  it('does not count the start date as day one', () => {
    // The classic off-by-one: 1 day from Monday is Tuesday, not Monday.
    expect(addDaysOnBasis(CALENDAR_2025_26, date('2025-09-15'), 1, 'calendar')).toBe('2025-09-16')
    expect(addDaysOnBasis(CALENDAR_2025_26, date('2025-09-15'), 1, 'school')).toBe('2025-09-16')
  })

  it('skips weekends and holidays when counting school days', () => {
    // Friday + 1 school day is Monday.
    expect(addDaysOnBasis(CALENDAR_2025_26, date('2025-09-05'), 1, 'school')).toBe('2025-09-08')
  })

  it('pushes a school-day count past winter break', () => {
    // Only four school days remain before winter break (Dec 16-19), so the
    // remaining six land Jan 5-12 once the break and weekends are skipped.
    // A calendar-day reading of the same deadline would say Dec 25 -- almost
    // three weeks early, and wrong in the direction that produces a finding.
    const due = addDaysOnBasis(CALENDAR_2025_26, date('2025-12-15'), 10, 'school')
    expect(due).toBe('2026-01-12')
    expect(addDaysOnBasis(CALENDAR_2025_26, date('2025-12-15'), 10, 'calendar')).toBe('2025-12-25')
  })

  it('is the reason a Texas 45-school-day clock started in May ends in September', () => {
    // Consent on May 1 2026. 45 school days cannot fit before the June 5 year
    // end, so the deadline lands in the following school year -- the trap that
    // calendar-day arithmetic hides.
    const calendar = {
      ...CALENDAR_2025_26,
      lastInstructionalDay: date('2026-06-05'),
    }
    const due = addDaysOnBasis(calendar, date('2026-05-01'), 20, 'school')
    expect(due).toBe('2026-05-29')
    expect(() => addDaysOnBasis(calendar, date('2026-05-01'), 45, 'school')).toThrow(RangeError)
  })

  it('refuses to invent a date it cannot reach', () => {
    expect(() => addDaysOnBasis(CALENDAR_2025_26, date('2026-06-01'), 100, 'school')).toThrow(
      /Could not advance/,
    )
  })
})

describe('countDaysOnBasis', () => {
  it('counts calendar days between two dates', () => {
    expect(countDaysOnBasis(CALENDAR_2025_26, date('2025-09-15'), date('2025-11-14'), 'calendar')).toBe(60)
  })

  it('counts school days, excluding closures', () => {
    // Sep 1 is Labor Day, so the first full week yields four school days.
    expect(countDaysOnBasis(CALENDAR_2025_26, date('2025-08-29'), date('2025-09-05'), 'school')).toBe(4)
  })

  it('returns a negative count when the range runs backwards', () => {
    expect(countDaysOnBasis(CALENDAR_2025_26, date('2025-11-14'), date('2025-09-15'), 'calendar')).toBe(-60)
  })

  it('is zero for an empty range', () => {
    expect(countDaysOnBasis(CALENDAR_2025_26, date('2025-09-15'), date('2025-09-15'), 'school')).toBe(0)
  })
})

describe('extendedBreakDaysBetween', () => {
  it('sums only the break days inside the window', () => {
    // Thanksgiving (5 days) and winter (12 days) fall inside; spring does not.
    expect(extendedBreakDaysBetween(CALENDAR_2025_26, date('2025-11-01'), date('2026-01-31'))).toBe(17)
  })

  it('clips a break that straddles the window edge', () => {
    // Only Dec 22-31 of the winter break falls before Jan 1.
    expect(extendedBreakDaysBetween(CALENDAR_2025_26, date('2025-12-01'), date('2025-12-31'))).toBe(10)
  })

  it('is zero when no break falls in the window', () => {
    expect(extendedBreakDaysBetween(CALENDAR_2025_26, date('2025-09-01'), date('2025-10-31'))).toBe(0)
  })
})
