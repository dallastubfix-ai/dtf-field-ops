import { format, addYears, parseISO, isValid } from 'date-fns'

// Warranty length is stored on the invoice as 2 or 6. Anything else (null,
// undefined, bad data) behaves as 2 so older invoices print exactly as before.
export function normalize(value) {
  return Number(value) === 6 ? 6 : 2
}

// Used to spell out the length in warranty terms: "two (2) years" / "six (6) years".
export const YEARS_WORD = { 2: 'two', 6: 'six' }

// Service date is a calendar date ('yyyy-MM-dd'), not an instant. parseISO reads
// it as a LOCAL date; new Date('2026-10-12') would read it as UTC and shift the
// result back a day in Dallas.
export function warrantyExpiry(serviceDateString, years) {
  if (!serviceDateString) return ''
  const start = parseISO(String(serviceDateString).slice(0, 10))
  if (!isValid(start)) return ''
  return format(addYears(start, normalize(years)), 'yyyy-MM-dd')
}
