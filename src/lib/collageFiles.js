// Filenames for saved before/after collages.
// Pure JavaScript: no React, Dexie, Supabase or browser-only imports, so it runs in Node.
import { cityFromAddress } from './cityFromAddress'

const MAX_DAMAGES = 2

// Shorter names for two surfaces; everything else is just lowercased with hyphens.
const SLUG_OVERRIDES = new Map([
  ['porcelain_cast_iron', 'porcelain'],
  ['granite_stone', 'granite'],
])

// Lowercase; every run of characters other than a-z and 0-9 (underscores too) becomes one hyphen.
function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const slugValue = (value) => SLUG_OVERRIDES.get(value) ?? slugify(value)

// <surface>-<fixture>-<service>[-<damage>[-<damage>]]-<city>-tx-before-after-<wide|close-up>.jpg
// Missing parts are skipped. Damages only count for the close-up view (max 2, in the given order).
// Strip is never part of the name. existingNames: this job's saved collage filenames; a clash gets -2, -3...
export function buildCollageFilename({ fixture, surface, service, damages, view, city, existingNames } = {}) {
  const closeUp = view === 'close-up'
  const parts = [slugValue(surface), slugValue(fixture), slugValue(service)]

  if (closeUp) {
    const picked = []
    for (const damage of Array.isArray(damages) ? damages : []) {
      const slug = slugValue(damage)
      if (slug && !picked.includes(slug)) picked.push(slug)
      if (picked.length === MAX_DAMAGES) break
    }
    parts.push(...picked)
  }

  const citySlug = slugify(city)
  if (citySlug) parts.push(citySlug, 'tx')
  parts.push('before', 'after', closeUp ? 'close-up' : 'wide')

  const base = parts.filter(Boolean).join('-')
  const taken = new Set((existingNames ?? []).map(n => String(n).toLowerCase()))
  let name = `${base}.jpg`
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}.jpg`
  return name
}

// Distinct damage values from a repair card's repairs, in order. Empty for any other card.
export function getCardDamages(card) {
  if (!card || card.service !== 'repair' || !Array.isArray(card.repairs)) return []
  const damages = []
  for (const repair of card.repairs) {
    if (repair && repair.damage && !damages.includes(repair.damage)) damages.push(repair.damage)
  }
  return damages
}

// City from the earliest appointment (by date) whose address has one; '' if none does.
export function getJobCity(appointments) {
  const time = (a) => {
    const t = Date.parse(a?.appointment_datetime)
    return Number.isNaN(t) ? Infinity : t
  }
  const sorted = [...(appointments ?? [])].filter(Boolean).sort((a, b) => time(a) - time(b))
  for (const appointment of sorted) {
    const city = cityFromAddress(appointment.location_address)
    if (city) return city
  }
  return ''
}

// Filename inputs for one card: the chosen card, or the job's only card. Old jobs (no cards)
// use fixture_type / surface_type and have no service. Several cards with none chosen gives blanks.
// damageOptions are the damages the Save step can offer to tick.
export function getJobFilenameInputs(job, card) {
  const cards = job && Array.isArray(job.fixtures) ? job.fixtures.filter(Boolean) : []
  const chosen = card ?? (cards.length === 1 ? cards[0] : null)
  if (chosen) {
    return {
      fixture: chosen.fixture || '',
      surface: chosen.surface || '',
      service: chosen.service || '',
      damageOptions: getCardDamages(chosen),
    }
  }
  if (job && !cards.length) {
    return { fixture: job.fixture_type || '', surface: job.surface_type || '', service: '', damageOptions: [] }
  }
  return { fixture: '', surface: '', service: '', damageOptions: [] }
}
