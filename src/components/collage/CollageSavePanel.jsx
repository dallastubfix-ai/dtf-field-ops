import { useEffect, useMemo, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import Button from '../ui/Button'
import Card from '../ui/Card'
import Input from '../ui/Input'
import {
  FIXTURE_LABELS, SURFACE_LABELS, SERVICE_LABELS, DAMAGE_LABELS,
  getAllowedSurfaces, getAllowedServices, getFixtureTitles, summarizeJobFixtures,
} from '../../lib/fixtures'
import { buildCollageFilename, getCardDamages, getJobCity, getJobFilenameInputs } from '../../lib/collageFiles'

const MAX_DAMAGES = 2
const ALL_DAMAGES = Object.keys(DAMAGE_LABELS)
const EMPTY_PICK = { fixture: '', surface: '', service: '' }
const DOT = ` ${String.fromCharCode(183)} `

const chipClass = (selected) =>
  `px-3 py-1.5 min-h-[44px] rounded-full text-sm border transition-all disabled:opacity-40 ${
    selected ? 'bg-navy text-white border-navy' : 'border-dtf-border text-dtf-sub'
  }`

// The Save step's choices live here (called from CollageMaker) so they survive closing the
// panel and "Make another". mode: 'one' card, 'many' cards (must pick), 'old' (fixture_type /
// surface_type only), 'pick' (nothing recorded; optional pick-lists).
export function useSaveChoices({ job, appointments, existingNames }) {
  const cards = useMemo(() => (job && Array.isArray(job.fixtures) ? job.fixtures.filter(Boolean) : []), [job])
  const titles = useMemo(() => getFixtureTitles(cards), [cards])
  const mode = cards.length > 1 ? 'many'
    : cards.length === 1 ? 'one'
    : (job && (job.fixture_type || job.surface_type)) ? 'old'
    : 'pick'

  const [cardIndex, setCardIndexState] = useState(null)
  const [pick, setPick] = useState(EMPTY_PICK)
  const [view, setView] = useState(null) // 'wide' | 'close-up' | null
  const [damagePick, setDamagePick] = useState(null) // null = untouched, so a lone damage is pre-ticked

  const autoCity = useMemo(() => getJobCity(appointments), [appointments])
  const cityEdited = useRef(false)
  const [city, setCityState] = useState(autoCity)
  useEffect(() => { if (!cityEdited.current) setCityState(autoCity) }, [autoCity])
  const setCity = (value) => { cityEdited.current = true; setCityState(value) }

  const card = mode === 'one' ? cards[0] : mode === 'many' ? (cards[cardIndex] ?? null) : null
  const inputs = mode === 'pick' ? pick : getJobFilenameInputs(job, card)

  // A card offers its own repair damages; with no card, every damage is offered.
  const damageOptions = card ? getCardDamages(card) : mode === 'many' ? [] : ALL_DAMAGES
  const autoDamages = card && damageOptions.length === 1 ? damageOptions : []
  const damages = (damagePick ?? autoDamages).filter(d => damageOptions.includes(d))

  const toggleDamage = (damage) => {
    if (damages.includes(damage)) setDamagePick(damages.filter(d => d !== damage))
    else if (damages.length < MAX_DAMAGES) setDamagePick([...damages, damage])
  }

  const setCardIndex = (index) => { setCardIndexState(index); setDamagePick(null) }

  // Tapping the chosen chip again clears it. A fixture change drops a surface/service it doesn't allow.
  const setPickField = (field, value) => setPick(prev => {
    const next = { ...prev, [field]: prev[field] === value ? '' : value }
    if (!getAllowedSurfaces(next.fixture).includes(next.surface)) next.surface = ''
    if (!getAllowedServices(next.fixture, next.surface).includes(next.service)) next.service = ''
    return next
  })

  let missing = ''
  if (mode === 'many' && !card) missing = 'Choose which fixture this collage is for.'
  else if (!view) missing = 'Choose Wide or Close-up.'

  const filename = missing
    ? ''
    : buildCollageFilename({ ...inputs, damages, view, city, existingNames })

  const fixtureText = mode === 'one'
    ? [SURFACE_LABELS[card.surface], SERVICE_LABELS[card.service]].filter(Boolean).join(DOT)
    : mode === 'old' ? summarizeJobFixtures(job) : ''

  // After a save: forget the view and damages; keep the fixture and city.
  const resetForNext = () => { setView(null); setDamagePick(null) }

  return {
    mode, titles, card, cardIndex, setCardIndex, pick, setPickField, fixtureText,
    view, setView, damageOptions, damages, toggleDamage,
    city, setCity, hasAutoCity: !!autoCity,
    filename, missing, canSave: !missing, resetForNext,
  }
}

function Section({ title, children }) {
  return (
    <Card className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-dtf-sub">{title}</h2>
      {children}
    </Card>
  )
}

function Chips({ values, labels, selected, onSelect }) {
  return (
    <div className="flex flex-wrap gap-2">
      {values.map(v => (
        <button
          key={v}
          type="button"
          aria-pressed={selected === v}
          onClick={() => onSelect(v)}
          className={chipClass(selected === v)}
        >
          {labels[v]}
        </button>
      ))}
    </div>
  )
}

const VIEWS = [['wide', 'Wide'], ['close-up', 'Close-up']]

// status: 'idle' | 'saving' | 'saved'. The Save / Back / Make another buttons live in the maker's bottom bar.
export default function SavePanel({ choices: c, status, savedName, warning }) {
  if (status === 'saved') {
    return (
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        <Card className="space-y-3 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-green-100 text-green-600 flex items-center justify-center">
            <Check size={26} />
          </div>
          <h2 className="text-base font-bold text-dtf-text">Collage saved</h2>
          <p className="text-xs text-dtf-sub break-all">{savedName}</p>
          <p className="text-sm text-dtf-text">It is in this job's photos and in Google Drive. You can share it now.</p>
          {warning && (
            <p role="status" className="text-xs text-left text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {warning}
            </p>
          )}
        </Card>
      </div>
    )
  }

  const locked = status === 'saving'
  const surfaces = getAllowedSurfaces(c.pick.fixture)
  const services = getAllowedServices(c.pick.fixture, c.pick.surface)
  const damagesFull = c.damages.length >= MAX_DAMAGES

  return (
    <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
      <fieldset disabled={locked} className={`space-y-4 min-w-0 ${locked ? 'opacity-60' : ''}`}>
        <Section title="Fixture">
          {c.mode === 'one' && (
            <div>
              <div className="text-sm font-semibold text-dtf-text">{c.titles[0]}</div>
              {c.fixtureText && <div className="text-xs text-dtf-sub mt-0.5">{c.fixtureText}</div>}
            </div>
          )}

          {c.mode === 'many' && (
            <>
              <p className="text-xs text-dtf-sub">Which fixture is this collage for?</p>
              <div className="flex flex-wrap gap-2">
                {c.titles.map((title, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-pressed={c.cardIndex === i}
                    onClick={() => c.setCardIndex(i)}
                    className={chipClass(c.cardIndex === i)}
                  >
                    {title}
                  </button>
                ))}
              </div>
            </>
          )}

          {c.mode === 'old' && (
            <div>
              <div className="text-sm font-semibold text-dtf-text">{c.fixtureText}</div>
              <div className="text-xs text-dtf-sub mt-0.5">Recorded before fixture cards</div>
            </div>
          )}

          {c.mode === 'pick' && (
            <div className="space-y-3">
              <p className="text-xs text-dtf-sub">
                Nothing is recorded for this job. These are optional and only shape the file name.
              </p>
              <Chips
                values={Object.keys(FIXTURE_LABELS)}
                labels={FIXTURE_LABELS}
                selected={c.pick.fixture}
                onSelect={v => c.setPickField('fixture', v)}
              />
              {surfaces.length > 0 && (
                <Chips values={surfaces} labels={SURFACE_LABELS} selected={c.pick.surface} onSelect={v => c.setPickField('surface', v)} />
              )}
              {services.length > 0 && (
                <Chips values={services} labels={SERVICE_LABELS} selected={c.pick.service} onSelect={v => c.setPickField('service', v)} />
              )}
            </div>
          )}
        </Section>

        <Section title="View">
          <div className="flex gap-2">
            {VIEWS.map(([value, label]) => (
              <Button
                key={value}
                type="button"
                variant={c.view === value ? 'primary' : 'secondary'}
                className="flex-1 min-h-[44px]"
                aria-pressed={c.view === value}
                onClick={() => c.setView(value)}
              >
                {label}
              </Button>
            ))}
          </div>
        </Section>

        {c.view === 'close-up' && (c.damageOptions.length > 0 || c.card) && (
          <Section title="Damage shown">
            {c.damageOptions.length === 0 ? (
              <p className="text-xs text-dtf-sub">No damage is recorded on this fixture, so none goes in the file name.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {c.damageOptions.map(d => {
                    const on = c.damages.includes(d)
                    return (
                      <button
                        key={d}
                        type="button"
                        aria-pressed={on}
                        disabled={!on && damagesFull}
                        onClick={() => c.toggleDamage(d)}
                        className={chipClass(on)}
                      >
                        {DAMAGE_LABELS[d]}
                      </button>
                    )
                  })}
                </div>
                <p className="text-xs text-dtf-sub">
                  {damagesFull
                    ? 'Two picked, the most the file name holds. Untick one to choose a different damage.'
                    : 'Pick up to 2 for the file name. Skipping is fine.'}
                </p>
              </>
            )}
          </Section>
        )}

        <Section title="City">
          <Input
            id="collage-city"
            value={c.city}
            onChange={e => c.setCity(e.target.value)}
            placeholder="City"
            autoComplete="off"
            className="min-h-[44px]"
          />
          <p className="text-xs text-dtf-sub">
            {c.hasAutoCity
              ? 'Taken from the appointment address. Change it if it is wrong.'
              : 'No city found in the appointment address. Type one, or leave it blank.'}
          </p>
        </Section>

        <Section title="File name">
          {c.filename
            ? <p className="text-sm text-dtf-text break-all font-mono">{c.filename}</p>
            : <p className="text-sm text-dtf-sub">{c.missing}</p>}
        </Section>
      </fieldset>
    </div>
  )
}
