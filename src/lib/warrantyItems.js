// Per-item warranty length, expiry, labels and title for the new warranty print.
// Pure logic: no React, Dexie, Supabase or browser-only code, so it runs in Node.
// Never throws: junk input (null cards, non-arrays, missing fields) is skipped or falls back
// to the invoice-only result. The file is plain ASCII.
import { normalize, warrantyExpiry, yearsText } from './warranty'
import { FIXTURE_LABELS, SERVICE_LABELS } from './fixtures'

// Em dash (8212) and middle dot (183), built from their codes so the file stays plain ASCII.
const EM_DASH = String.fromCharCode(8212)
const MIDDLE_DOT = String.fromCharCode(183)

// Order the groups are listed in (and the order their text prints in).
export const GROUP_ORDER = ['repair', 'bottom_refinish', 'refinish', 'countertop']

// WORK COVERED shows this many lines; the rest collapse into one "+N more" line.
export const MAX_WORK_LINES = 8

const NEUTRAL_TITLE = 'Warranty & Service Guarantee'

// Length in years by service. A countertop refinish is the one exception (1 year).
const SERVICE_YEARS = { repair: 2, bottom_rebuild: 2, bottom_refinish: 2, refinish: 6 }
const COUNTERTOP_REFINISH_YEARS = 1

// Short word for each fixture, used in the WORK COVERED line.
const SHORT_WORDS = {
  bathtub: 'tub',
  bathtub_shower_walls: 'tub + shower walls',
  shower_pan: 'shower pan',
  shower_walls: 'shower walls',
  countertop: 'countertop',
  sink: 'sink',
  toilet: 'toilet',
}

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key)

// Which warranty group a card belongs to, or null when the card cannot be used
// (not an object, unknown or missing fixture, unknown or missing service).
export function groupOf(card) {
  if (!card || typeof card !== 'object') return null
  if (!has(FIXTURE_LABELS, card.fixture) || !has(SERVICE_LABELS, card.service)) return null
  switch (card.service) {
    case 'repair':
    case 'bottom_rebuild':
      return 'repair'
    case 'bottom_refinish':
      return 'bottom_refinish'
    case 'refinish':
      return card.fixture === 'countertop' ? 'countertop' : 'refinish'
    default:
      return null
  }
}

// Length in years this card suggests on its own, or null for an unusable card.
export function cardYears(card) {
  const group = groupOf(card)
  if (!group) return null
  return group === 'countertop' ? COUNTERTOP_REFINISH_YEARS : SERVICE_YEARS[card.service]
}

// yyyy-MM-dd -> mm/dd/yyyy ('' stays '').
function toMDY(ymd) {
  const [y, m, d] = String(ymd).split('-')
  return y && m && d ? `${m}/${d}/${y}` : ''
}

// "<name> <short word> (em dash) <service>". The word is skipped when the name already has it;
// an unnamed card gets the capitalized word on its own.
function buildLabel(card) {
  const word = SHORT_WORDS[card.fixture]
  const name = typeof card.name === 'string' ? card.name.trim() : ''
  let subject
  if (name) subject = name.toLowerCase().includes(word.toLowerCase()) ? name : `${name} ${word}`
  else subject = word.charAt(0).toUpperCase() + word.slice(1)
  return `${subject} ${EM_DASH} ${SERVICE_LABELS[card.service]}`.trim()
}

// Trimmed text of a value; '' for null, undefined, or anything that cannot be turned into text.
function safeText(value) {
  try {
    return value === null || value === undefined ? '' : String(value).trim()
  } catch {
    return ''
  }
}

function safeExpiry(serviceDate, years) {
  try {
    return warrantyExpiry(serviceDate, years)
  } catch {
    return ''
  }
}

// Text for the covered / expect sections when there are no usable cards:
// derived from the invoice length alone.
function contentGroupsForYears(invoiceYears) {
  if (invoiceYears === 6) return ['refinish']
  if (invoiceYears === 1) return ['countertop']
  return ['repair']
}

function workLineWithoutCards(invoiceNumber) {
  return invoiceNumber
    ? `The work listed on Invoice #${invoiceNumber}`
    : 'The work listed on the invoice'
}

// Result when there are no usable cards (or something unexpected went wrong).
function fallbackResult(invoiceYears, serviceDate, invoiceNumber) {
  return {
    items: [],
    longest: invoiceYears,
    latestExpiry: safeExpiry(serviceDate, invoiceYears),
    warn: false,
    groups: [],
    hasRebuild: false,
    title: NEUTRAL_TITLE,
    workLines: [workLineWithoutCards(invoiceNumber)],
    contentGroups: contentGroupsForYears(invoiceYears),
  }
}

function titleFor(groups, hasRebuild) {
  if (groups.length !== 1) return NEUTRAL_TITLE
  switch (groups[0]) {
    case 'repair':
      return hasRebuild ? 'Repair Warranty, with Bottom Rebuild Coverage' : 'Repair Warranty'
    case 'bottom_refinish':
      return 'Bottom Refinishing Warranty'
    case 'refinish':
      return 'Refinishing Warranty'
    case 'countertop':
      return 'Countertop Refinishing Warranty'
    default:
      return NEUTRAL_TITLE
  }
}

// Everything the new warranty print needs from the job's fixture cards.
//   cards: job.fixtures (anything else is treated as no cards)
//   invoiceYears: the invoice's warranty_years (goes through normalize)
//   serviceDate: 'yyyy-MM-dd' (no valid date means no expiry text)
//   invoiceNumber: shown in the no-cards line and the "+N more" line
// Each item's years = min(card length, invoice length). warn is true when any card
// suggests a longer length than the invoice (on-screen only).
export function buildWarrantyItems(cards, invoiceYears, serviceDate, invoiceNumber) {
  const inv = normalize(invoiceYears)
  const number = safeText(invoiceNumber)
  try {
    const valid = (Array.isArray(cards) ? cards : []).filter(card => groupOf(card))
    if (valid.length === 0) return fallbackResult(inv, serviceDate, number)

    const items = valid.map(card => {
      const suggested = cardYears(card)
      const years = Math.min(suggested, inv)
      const expiry = safeExpiry(serviceDate, years)
      const label = buildLabel(card)
      const line = `${label} ${MIDDLE_DOT} ${yearsText(years)}` +
        (expiry ? ` ${MIDDLE_DOT} expires ${toMDY(expiry)}` : '')
      return { label, group: groupOf(card), years, expiry, line, suggested }
    })

    const groups = GROUP_ORDER.filter(g => items.some(item => item.group === g))
    const hasRebuild = valid.some(card => card.service === 'bottom_rebuild')
    const expiries = items.map(item => item.expiry).filter(Boolean).sort()

    const lines = items.map(item => item.line)
    const workLines = lines.length > MAX_WORK_LINES
      ? [
          ...lines.slice(0, MAX_WORK_LINES),
          `+${lines.length - MAX_WORK_LINES} more, see ${number ? `Invoice #${number}` : 'the invoice'}`,
        ]
      : lines

    return {
      items: items.map(({ suggested, ...item }) => item),
      longest: Math.max(...items.map(item => item.years)),
      latestExpiry: expiries.length ? expiries[expiries.length - 1] : '',
      warn: items.some(item => item.suggested > inv),
      groups,
      hasRebuild,
      title: titleFor(groups, hasRebuild),
      workLines,
      contentGroups: groups,
    }
  } catch {
    return fallbackResult(inv, serviceDate, number)
  }
}
