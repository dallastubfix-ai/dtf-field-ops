// Fixture rules, labels and pricing for DTF Field Ops.
// Single source of truth for fixture lists, allowed choices and prices.
// Pure JavaScript: no React, Dexie, Supabase or browser-only imports, so it runs in Node.
// All money math is done in whole cents; results come back as dollars rounded to 2 decimals.

// ---------- Labels (value -> label) ----------

export const FIXTURE_LABELS = {
  bathtub: 'Bathtub',
  bathtub_shower_walls: 'Bathtub + shower walls',
  shower_pan: 'Shower pan',
  shower_walls: 'Shower walls',
  countertop: 'Countertop',
  sink: 'Sink',
  toilet: 'Toilet',
}

export const SURFACE_LABELS = {
  porcelain_cast_iron: 'Porcelain / Cast Iron',
  fiberglass: 'Fiberglass',
  acrylic: 'Acrylic',
  cultured_marble: 'Cultured Marble',
  tile: 'Tile',
  laminate: 'Laminate',
  granite_stone: 'Granite / Stone',
}

export const SERVICE_LABELS = {
  repair: 'Repair',
  refinish: 'Refinish',
  bottom_refinish: 'Bottom refinish',
  bottom_rebuild: 'Bottom rebuild',
}

export const DAMAGE_LABELS = {
  chip: 'Chip',
  crack: 'Crack',
  hole: 'Hole',
  scratch: 'Scratch',
  rust: 'Rust',
  burn: 'Burn',
  stain: 'Stain',
  peeling_finish: 'Peeling finish',
}

export const REPAIR_SIZE_LABELS = {
  small: 'Small',
  large: 'Large',
}

// Suggested names for the optional "name" field on a card.
export const NAME_QUICK_PICKS = ['Kitchen', 'Master bath', 'Hall bath', 'Guest bath']

// ---------- Rules ----------

const TUB_SURFACES = ['porcelain_cast_iron', 'fiberglass', 'acrylic', 'cultured_marble']
const SHOWER_WALLS_SURFACES = ['tile', 'fiberglass', 'acrylic', 'cultured_marble']

// Bottom rebuild only works on these surfaces.
const REBUILD_SURFACES = ['fiberglass', 'acrylic']

// Strip is only offered with these services.
const STRIP_SERVICES = ['refinish', 'bottom_refinish']

// Prices are in cents. stripCents is a flat price; perSqFt prices are cents per square foot.
// A fixture with neither stripCents nor perSqFt.strip cannot be stripped (toilet).
const FIXTURE_RULES = {
  bathtub: {
    surfaces: TUB_SURFACES,
    services: ['repair', 'refinish', 'bottom_refinish', 'bottom_rebuild'],
    prices: { refinish: 73500, bottom_refinish: 48500, bottom_rebuild: 58500 },
    stripCents: 32500,
  },
  // Only this fixture has a second surface (walls_surface), and only one price and one strip line.
  bathtub_shower_walls: {
    surfaces: TUB_SURFACES,
    wallsSurfaces: SHOWER_WALLS_SURFACES,
    services: ['refinish'],
    prices: { refinish: 135000 },
    stripCents: 68500,
  },
  shower_pan: {
    surfaces: ['fiberglass', 'acrylic', 'cultured_marble', 'tile'],
    services: ['repair', 'bottom_refinish', 'bottom_rebuild'],
    prices: { bottom_refinish: 48500, bottom_rebuild: 58500 },
    stripCents: 22500,
  },
  shower_walls: {
    surfaces: SHOWER_WALLS_SURFACES,
    services: ['repair', 'refinish'],
    prices: { refinish: 73500 },
    stripCents: 42500,
  },
  countertop: {
    surfaces: ['laminate', 'tile', 'cultured_marble', 'granite_stone'],
    services: ['repair', 'refinish'],
    perSqFt: { refinish: 4000, strip: 1350 },
  },
  sink: {
    surfaces: ['porcelain_cast_iron', 'cultured_marble', 'acrylic'],
    services: ['repair', 'refinish'],
    prices: { refinish: 48500 },
    stripCents: 12500,
  },
  // Toilet has no surface, repair only, no strip.
  toilet: {
    surfaces: [],
    services: ['repair'],
  },
}

// Repair price is the same for any fixture: $385 for up to 3 small repairs, $435 otherwise.
const REPAIR_SMALL_CENTS = 38500
const REPAIR_LARGE_CENTS = 43500
const REPAIR_MAX_SMALL = 3

// Countertops are billed for at least 10 sq ft, unless the job has a non-countertop fixture.
const COUNTERTOP_MIN_SQFT = 10

// ---------- Small helpers ----------

// Cents in, dollars out (rounded to 2 decimals).
function toDollars(cents) {
  return Math.round(cents) / 100
}

function newId() {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  // Fallback for insecure contexts (e.g. phone testing over plain http).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
    const r = Math.floor(Math.random() * 16)
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

// Square feet may arrive as a number or a typed string. Returns a number > 0, or null.
function parseSquareFeet(value) {
  let n = NaN
  if (typeof value === 'number') n = value
  else if (typeof value === 'string' && value.trim() !== '') n = Number(value.trim())
  return Number.isFinite(n) && n > 0 ? n : null
}

function isBlank(value) {
  return value === null || value === undefined || value === ''
}

function hasName(card) {
  return typeof card.name === 'string' && card.name.trim() !== ''
}

// Same output as src/lib/formatEnum.js, reproduced here so this file has no imports.
function formatLegacyEnum(value) {
  if (!value) return ''
  return value
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .replace('Porcelain Cast Iron', 'Porcelain / Cast Iron')
}

// ---------- Card shape ----------

// A blank fixture card. Each repair looks like { size: 'small' | 'large', damage: <damage value> }.
export function createEmptyFixture() {
  return {
    id: newId(),
    name: '',
    fixture: '',
    surface: '',
    walls_surface: '',
    service: '',
    strip: false,
    square_feet: null,
    repairs: [],
  }
}

// ---------- Allowed choices ----------

// Surfaces the fixture can have (empty for a toilet or an unknown fixture).
export function getAllowedSurfaces(fixture) {
  const rule = FIXTURE_RULES[fixture]
  return rule ? [...rule.surfaces] : []
}

// Shower-wall surfaces; only the combined tub + walls card has these.
export function getAllowedWallsSurfaces(fixture) {
  const rule = FIXTURE_RULES[fixture]
  return rule && rule.wallsSurfaces ? [...rule.wallsSurfaces] : []
}

// Services the fixture offers. Bottom rebuild only shows up once the surface is fiberglass or acrylic.
export function getAllowedServices(fixture, surface) {
  const rule = FIXTURE_RULES[fixture]
  if (!rule) return []
  return rule.services.filter(s => s !== 'bottom_rebuild' || REBUILD_SURFACES.includes(surface))
}

// Strip is allowed only on refinish or bottom refinish, for fixtures that have a strip price.
export function canStrip(card) {
  const rule = FIXTURE_RULES[card.fixture]
  if (!rule || !(rule.stripCents || (rule.perSqFt && rule.perSqFt.strip))) return false
  return (
    STRIP_SERVICES.includes(card.service) &&
    getAllowedServices(card.fixture, card.surface).includes(card.service)
  )
}

// Countertop refinish is priced by square foot. Countertop strip is only offered with refinish,
// so this one check covers both.
export function needsSquareFeet(card) {
  return card.fixture === 'countertop' && card.service === 'refinish'
}

// Only the repair service records individual repairs.
export function needsRepairs(card) {
  return card.service === 'repair' && getAllowedServices(card.fixture, card.surface).includes('repair')
}

// ---------- Cleanup and validation ----------

// After any change, clear fields that no longer make sense. Returns a new object.
export function sanitizeFixture(card) {
  const next = { ...card }

  if (!FIXTURE_LABELS[next.fixture]) next.fixture = ''

  // Surface must be one the fixture allows (toilet allows none).
  if (!getAllowedSurfaces(next.fixture).includes(next.surface)) next.surface = ''

  // Walls surface only exists on the combined tub + walls card.
  if (!getAllowedWallsSurfaces(next.fixture).includes(next.walls_surface)) next.walls_surface = ''

  // Service must be allowed (this also drops bottom rebuild on the wrong surface).
  if (!getAllowedServices(next.fixture, next.surface).includes(next.service)) next.service = ''

  next.strip = canStrip(next) && !!next.strip

  if (!needsSquareFeet(next)) next.square_feet = null

  // Repairs are only kept for the repair service.
  next.repairs = needsRepairs(next)
    ? (Array.isArray(next.repairs) ? next.repairs : []).map(r => ({ ...r }))
    : []

  return next
}

// Plain-English problems that stop a card from being priced. Empty list = good to go.
export function validateFixture(card) {
  const problems = []

  if (!card.fixture || !FIXTURE_LABELS[card.fixture]) {
    problems.push('Choose a fixture.')
    return problems
  }

  const surfaces = getAllowedSurfaces(card.fixture)
  if (surfaces.length) {
    if (!card.surface) problems.push('Choose a surface.')
    else if (!surfaces.includes(card.surface)) problems.push("That surface isn't available for this fixture.")
  }

  if (getAllowedWallsSurfaces(card.fixture).length) {
    if (!card.walls_surface) problems.push('Choose a shower walls surface.')
    else if (!getAllowedWallsSurfaces(card.fixture).includes(card.walls_surface)) {
      problems.push("That shower walls surface isn't available.")
    }
  }

  if (!card.service) {
    problems.push('Choose a service.')
  } else if (!getAllowedServices(card.fixture, card.surface).includes(card.service)) {
    if (card.service === 'bottom_rebuild' && FIXTURE_RULES[card.fixture].services.includes('bottom_rebuild')) {
      problems.push('Bottom rebuild only works on a fiberglass or acrylic surface.')
    } else {
      problems.push("That service isn't available for this fixture.")
    }
  }

  if (needsSquareFeet(card)) {
    if (isBlank(card.square_feet)) problems.push('Enter the countertop square feet.')
    else if (parseSquareFeet(card.square_feet) === null) {
      problems.push('Square feet must be a number greater than 0.')
    }
  }

  if (needsRepairs(card)) {
    const repairs = Array.isArray(card.repairs) ? card.repairs : []
    if (repairs.length === 0) {
      problems.push('Add at least one repair.')
    } else {
      repairs.forEach((r, i) => {
        if (!r || !REPAIR_SIZE_LABELS[r.size]) problems.push(`Repair ${i + 1}: choose a size.`)
        if (!r || !DAMAGE_LABELS[r.damage]) problems.push(`Repair ${i + 1}: choose the damage.`)
      })
    }
  }

  return problems
}

// ---------- Titles ----------

// One title per card. Named: "Kitchen - Countertop". Unnamed and alone of its type: "Countertop".
// Unnamed duplicates are numbered in list order: "Countertop 1", "Countertop 2".
export function getFixtureTitles(cards) {
  const list = Array.isArray(cards) ? cards : []

  const unnamedTotals = {}
  list.forEach(c => {
    if (!hasName(c)) unnamedTotals[c.fixture] = (unnamedTotals[c.fixture] || 0) + 1
  })

  const seen = {}
  return list.map(c => {
    const label = FIXTURE_LABELS[c.fixture] || 'Fixture'
    if (hasName(c)) return `${c.name.trim()} - ${label}`
    if (unnamedTotals[c.fixture] === 1) return label
    seen[c.fixture] = (seen[c.fixture] || 0) + 1
    return `${label} ${seen[c.fixture]}`
  })
}

// ---------- Pricing ----------

// Short subject for a line, e.g. "Fiberglass bathtub", "Toilet", "Bathtub + shower walls".
function describeSubject(card) {
  const fixtureLabel = FIXTURE_LABELS[card.fixture]
  if (card.fixture === 'bathtub_shower_walls' || !card.surface) return fixtureLabel
  return `${SURFACE_LABELS[card.surface]} ${fixtureLabel.toLowerCase()}`
}

// Billable square feet for a countertop card, plus the note shown on the line.
function countertopSqFt(card, waiveMinimum) {
  const sqFt = parseSquareFeet(card.square_feet)
  const minApplied = !waiveMinimum && sqFt < COUNTERTOP_MIN_SQFT
  return {
    billable: minApplied ? COUNTERTOP_MIN_SQFT : sqFt,
    note: minApplied ? `${COUNTERTOP_MIN_SQFT} sq ft minimum` : `${sqFt} sq ft`,
  }
}

// Prices every card and adds them up. Cards with problems add no lines, only problems.
export function priceJob(cards) {
  const list = Array.isArray(cards) ? cards.filter(Boolean) : []
  const titles = getFixtureTitles(list)

  // The countertop minimum is waived only if some card is a fixture other than a countertop.
  // Two countertops do not waive it. A card with no fixture chosen yet does not count.
  const waiveMinimum = list.some(c => c.fixture && c.fixture !== 'countertop')

  const lines = []
  const problems = []
  let totalCents = 0

  list.forEach((card, i) => {
    const title = titles[i]
    const issues = validateFixture(card)
    if (issues.length) {
      issues.forEach(message => problems.push({ cardId: card.id, title, message }))
      return
    }

    const rule = FIXTURE_RULES[card.fixture]
    const subject = describeSubject(card)
    const add = (description, cents) => {
      lines.push({ cardId: card.id, title, description, amount: toDollars(cents) })
      totalCents += cents
    }

    // Main service line.
    if (card.service === 'repair') {
      // $385 if every repair is small and there are 3 or fewer; otherwise $435.
      const small = card.repairs.filter(r => r.size === 'small').length
      const large = card.repairs.length - small
      const cents = large === 0 && small <= REPAIR_MAX_SMALL ? REPAIR_SMALL_CENTS : REPAIR_LARGE_CENTS
      const counts = [small && `${small} small`, large && `${large} large`].filter(Boolean).join(', ')
      add(`${subject} - Repair (${counts})`, cents)
    } else if (rule.perSqFt) {
      // Countertop refinish: price per square foot, with the 10 sq ft minimum.
      const { billable, note } = countertopSqFt(card, waiveMinimum)
      add(`${subject} - Refinish (${note})`, Math.round(billable * rule.perSqFt.refinish))
    } else {
      add(`${subject} - ${SERVICE_LABELS[card.service]}`, rule.prices[card.service])
    }

    // Strip is its own line.
    if (card.strip && canStrip(card)) {
      if (rule.perSqFt) {
        const { billable, note } = countertopSqFt(card, waiveMinimum)
        add(`Strip (${note})`, Math.round(billable * rule.perSqFt.strip))
      } else {
        add('Strip', rule.stripCents)
      }
    }
  })

  return { lines, total: toDollars(totalCents), problems }
}

// ---------- Job list helpers ----------

// Short text for a job list line. New fixture cards win; old jobs fall back to fixture_type / surface_type.
// Middle dot (char code 183) between parts, built from the code so the file stays plain ASCII.
const SUMMARY_SEPARATOR = ` ${String.fromCharCode(183)} `

export function summarizeJobFixtures(job) {
  const cards = job && Array.isArray(job.fixtures) ? job.fixtures : []
  if (cards.length) {
    const first = cards[0]
    const text = [FIXTURE_LABELS[first.fixture] || 'Fixture', SURFACE_LABELS[first.surface]]
      .filter(Boolean)
      .join(SUMMARY_SEPARATOR)
    return cards.length > 1 ? `${text} + ${cards.length - 1} more` : text
  }
  if (!job) return ''
  return [formatLegacyEnum(job.fixture_type), formatLegacyEnum(job.surface_type)]
    .filter(Boolean)
    .join(SUMMARY_SEPARATOR)
}

// True if the job has any fixture info, new or old.
export function hasJobDetails(job) {
  if (!job) return false
  return (Array.isArray(job.fixtures) && job.fixtures.length > 0) || !!job.fixture_type || !!job.surface_type
}

// Surface text pre-filled on a new invoice. With cards: distinct surface labels in card order
// (the tub + walls card gives its surface, then its walls surface), joined with ", ".
// Cards but no surfaces (e.g. toilet only) gives ''. Old jobs: their surface_type, exactly as before.
export function getJobSurfaceText(job) {
  const cards = job && Array.isArray(job.fixtures) ? job.fixtures : []
  if (!cards.length) return (job && job.surface_type) ?? ''
  const labels = []
  for (const card of cards) {
    if (!card) continue
    for (const value of [card.surface, card.walls_surface]) {
      const label = SURFACE_LABELS[value]
      if (label && !labels.includes(label)) labels.push(label)
    }
  }
  return labels.join(', ')
}
