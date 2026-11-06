/**
 * Dates in the app's voice (design § 8). English words, Romania-style order,
 * weeks start on Monday.
 *
 * The API sends calendar days as "YYYY-MM-DD" (`occurredOn`, `nextDueOn`,
 * `household.today`). They are *days*, not instants: never `new Date('2026-11-18')`
 * (that is UTC midnight and shows the previous day west of Greenwich). Every helper
 * here treats them as plain calendar days, and "today" should come from
 * `household.today` (the household's time zone) — `localToday()` is the fallback.
 *
 *   formatDay('2026-11-18', today)        → "Today"   ("Yesterday", "Tomorrow", else "Mon 16 Nov")
 *   formatShortDate('2026-11-16')         → "Mon 16 Nov"
 *   formatDayHeader('2026-11-18', today)  → "Today · Wed 18 Nov"   (older: "Monday, 16 November")
 *   formatLongDate('2026-11-18')          → "Wednesday, 18 November"
 *   formatEyebrow('2026-11-18')           → "WEDNESDAY, 18 NOVEMBER"
 *   formatDue('2026-11-21', today)        → "In 3 days · Sat 21 Nov"
 *   formatMediumDate('2026-11-17')        → "17 Nov 2026"
 *   formatDateTime('2026-11-17T19:14:00Z', 'Europe/Bucharest') → "17 Nov 2026, 21:14"
 *   formatMonthName('2026-11')            → "November"
 */

/** A calendar day, "YYYY-MM-DD". */
export type CalendarDay = string
/** A budget month, "YYYY-MM". */
export type MonthKey = string

const DAY_MS = 86_400_000

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

interface Ymd {
  y: number
  m: number // 1–12
  d: number
}

function parse(day: CalendarDay): Ymd {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(day)
  if (!match) throw new RangeError(`Not a calendar day: ${day}`)
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }
}

/** Days since 1970-01-01 for a calendar day (time-zone free). */
function dayNumber(day: CalendarDay): number {
  const { y, m, d } = parse(day)
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS)
}

function fromDayNumber(n: number): CalendarDay {
  const dt = new Date(n * DAY_MS)
  return toDayString(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

function toDayString(y: number, m: number, d: number): CalendarDay {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** 0 = Sunday … 6 = Saturday */
function weekday(day: CalendarDay): number {
  return new Date(dayNumber(day) * DAY_MS).getUTCDay()
}

/** Today on this device, as a calendar day. Prefer `household.today` from the API. */
export function localToday(now: Date = new Date()): CalendarDay {
  return toDayString(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

/** b − a in whole days ("2026-11-18" → "2026-11-21" = 3). */
export function daysBetween(a: CalendarDay, b: CalendarDay): number {
  return dayNumber(b) - dayNumber(a)
}

export function addDays(day: CalendarDay, n: number): CalendarDay {
  return fromDayNumber(dayNumber(day) + n)
}

/** The Monday on or before `day`. */
export function startOfWeek(day: CalendarDay): CalendarDay {
  return addDays(day, -((weekday(day) + 6) % 7))
}

/** "2026-11-18" → "2026-11" */
export function monthOf(day: CalendarDay): MonthKey {
  return day.slice(0, 7)
}

/** "2026-11" + n months → "2027-01" */
export function addMonths(month: MonthKey, n: number): MonthKey {
  const [y, m] = month.split('-').map(Number)
  const index = y * 12 + (m - 1) + n
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`
}

/** "Mon 16 Nov" (adds the year when it differs from `today`'s: "Mon 16 Nov 2025"). */
export function formatShortDate(day: CalendarDay, today?: CalendarDay): string {
  const { y, m, d } = parse(day)
  const base = `${WEEKDAYS_SHORT[weekday(day)]} ${d} ${MONTHS_SHORT[m - 1]}`
  return today && parse(today).y !== y ? `${base} ${y}` : base
}

/** "Today", "Yesterday", "Tomorrow", else "Mon 16 Nov". */
export function formatDay(day: CalendarDay, today: CalendarDay = localToday()): string {
  const diff = daysBetween(today, day)
  if (diff === 0) return 'Today'
  if (diff === -1) return 'Yesterday'
  if (diff === 1) return 'Tomorrow'
  return formatShortDate(day, today)
}

/** "Wednesday, 18 November" */
export function formatLongDate(day: CalendarDay): string {
  const { m, d } = parse(day)
  return `${WEEKDAYS_LONG[weekday(day)]}, ${d} ${MONTHS_LONG[m - 1]}`
}

/** "WEDNESDAY, 18 NOVEMBER" — the compact large-title eyebrow. */
export function formatEyebrow(day: CalendarDay): string {
  return formatLongDate(day).toUpperCase()
}

/** Activity day group header, split so the detail can be styled in `label-2`. */
export function dayHeaderParts(day: CalendarDay, today: CalendarDay = localToday()): { title: string; detail: string | null } {
  const diff = daysBetween(today, day)
  if (diff === 0) return { title: 'Today', detail: formatShortDate(day) }
  if (diff === -1) return { title: 'Yesterday', detail: formatShortDate(day) }
  const long = formatLongDate(day)
  return { title: parse(day).y === parse(today).y ? long : `${long} ${parse(day).y}`, detail: null }
}

/** "Today · Wed 18 Nov", "Yesterday · Tue 17 Nov", "Monday, 16 November" */
export function formatDayHeader(day: CalendarDay, today: CalendarDay = localToday()): string {
  const { title, detail } = dayHeaderParts(day, today)
  return detail ? `${title} · ${detail}` : title
}

/**
 * When something is due. `relative` is set only within the next 7 days (and for
 * overdue days) and is the emphasized part in the design.
 *   in 3 days → { relative: "In 3 days", date: "Sat 21 Nov" }
 *   in 13 days → { relative: null, date: "Tue 1 Dec" }
 */
export function dueParts(day: CalendarDay, today: CalendarDay = localToday()): { relative: string | null; date: string } {
  const diff = daysBetween(today, day)
  const date = formatShortDate(day, today)
  let relative: string | null = null
  if (diff === 0) relative = 'Today'
  else if (diff === 1) relative = 'Tomorrow'
  else if (diff > 1 && diff <= 7) relative = `In ${diff} days`
  else if (diff === -1) relative = 'Yesterday'
  else if (diff < -1) relative = `${-diff} days ago`
  return { relative, date }
}

/** "In 3 days · Sat 21 Nov", "Tomorrow · Thu 19 Nov", "Tue 1 Dec" */
export function formatDue(day: CalendarDay, today: CalendarDay = localToday()): string {
  const { relative, date } = dueParts(day, today)
  return relative ? `${relative} · ${date}` : date
}

/** "17 Nov 2026" */
export function formatMediumDate(day: CalendarDay): string {
  const { y, m, d } = parse(day)
  return `${d} ${MONTHS_SHORT[m - 1]} ${y}`
}

function zonedParts(iso: string, timeZone?: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).formatToParts(new Date(iso))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return {
    y: Number(get('year')),
    m: Number(get('month')),
    d: Number(get('day')),
    time: `${get('hour')}:${get('minute')}`,
  }
}

/** A timestamp → "17 Nov 2026, 21:14" in the given IANA zone (default: the device's). */
export function formatDateTime(iso: string, timeZone?: string): string {
  const { y, m, d, time } = zonedParts(iso, timeZone)
  return `${d} ${MONTHS_SHORT[m - 1]} ${y}, ${time}`
}

/** A timestamp → "21:14" */
export function formatTime(iso: string, timeZone?: string): string {
  return zonedParts(iso, timeZone).time
}

/** "2026-11" (or a day) → "November" */
export function formatMonthName(month: MonthKey | CalendarDay): string {
  return MONTHS_LONG[Number(month.slice(5, 7)) - 1]
}

/** "2026-11" → "Nov" */
export function formatMonthShort(month: MonthKey | CalendarDay): string {
  return MONTHS_SHORT[Number(month.slice(5, 7)) - 1]
}

/** "2026-11" → "November 2026" */
export function formatMonthYear(month: MonthKey | CalendarDay): string {
  return `${formatMonthName(month)} ${month.slice(0, 4)}`
}

/** 0 = Monday … 6 = Sunday (Romania-style week). */
export function weekdayIndexMondayFirst(day: CalendarDay): number {
  return (weekday(day) + 6) % 7
}

/** "Mon"…"Sun" for chart labels, Monday first. */
export const WEEKDAY_LABELS_MONDAY_FIRST = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/** "Saturday" — for copy like "Netflix renews on Saturday". */
export function formatWeekday(day: CalendarDay): string {
  return WEEKDAYS_LONG[weekday(day)]
}
