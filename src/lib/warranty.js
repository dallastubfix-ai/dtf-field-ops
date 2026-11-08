import { format, addYears, parseISO, isValid } from 'date-fns'

// Warranty length is stored on the invoice as 1, 2 or 6. Anything else (null,
// undefined, bad data) behaves as 2 so older invoices print exactly as before.
// Only a number or a plain-digit string counts: true, [1], '' and the like become 2.
export function normalize(value) {
  const n = typeof value === 'number'
    ? value
    : (typeof value === 'string' && /^\s*[126]\s*$/.test(value) ? Number(value) : NaN)
  return n === 1 || n === 6 ? n : 2
}

// Used to spell out the length in warranty terms: "two (2) years" / "six (6) years".
// 1 is 'one'.
export const YEARS_WORD = { 1: 'one', 2: 'two', 6: 'six' }

// Length as words: "1 year" / "2 years" / "6 years". Not used anywhere yet.
// Goes through normalize, so bad data reads "2 years".
export function yearsText(years) {
  const n = normalize(years)
  return n === 1 ? '1 year' : `${n} years`
}

// Service date is a calendar date ('yyyy-MM-dd'), not an instant. parseISO reads
// it as a LOCAL date; new Date('2026-10-12') would read it as UTC and shift the
// result back a day in Dallas.
export function warrantyExpiry(serviceDateString, years) {
  if (!serviceDateString) return ''
  const start = parseISO(String(serviceDateString).slice(0, 10))
  if (!isValid(start)) return ''
  return format(addYears(start, normalize(years)), 'yyyy-MM-dd')
}
