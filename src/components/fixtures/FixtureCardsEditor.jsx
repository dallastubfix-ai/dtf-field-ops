import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Minus, Plus } from 'lucide-react'
import Card from '../ui/Card'
import Button from '../ui/Button'
import Input from '../ui/Input'
import Modal from '../ui/Modal'
import {
  FIXTURE_LABELS, SURFACE_LABELS, SERVICE_LABELS, NAME_QUICK_PICKS,
  createEmptyFixture, sanitizeFixture, getAllowedSurfaces, getAllowedWallsSurfaces,
  getAllowedServices, canStrip, needsSquareFeet, validateFixture, getFixtureTitles,
} from '../../lib/fixtures'

const MAX_CARDS = 10

const SERVICE_HELP = {
  bottom_refinish: 'Bottom of the tub up to just above the rolled edge, or a whole shower pan.',
  bottom_rebuild: 'Rebuild a damaged fiberglass or acrylic floor.',
}

const chipClass = (selected) =>
  `px-3 py-1.5 min-h-[44px] rounded-full text-sm border transition-all ${
    selected ? 'bg-navy text-white border-navy' : 'border-dtf-border text-dtf-sub'
  }`

// True if the card has anything filled in (used to decide whether removing needs a confirm).
function hasContent(card) {
  const sqFt = card.square_feet
  return !!(
    (card.name && card.name.trim()) || card.fixture || card.surface || card.walls_surface ||
    card.service || card.strip || (sqFt !== null && sqFt !== undefined && sqFt !== '') ||
    (card.repairs && card.repairs.length)
  )
}

function FieldLabel({ children }) {
  return <div className="text-xs font-semibold uppercase tracking-wide text-dtf-sub mb-2">{children}</div>
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

export default function FixtureCardsEditor({ cards, onChange }) {
  const [confirmRemove, setConfirmRemove] = useState(false)
  const list = Array.isArray(cards) ? cards : []
  const titles = getFixtureTitles(list)
  const last = list[list.length - 1]

  const updateCard = (index, patch) =>
    onChange(list.map((c, i) => (i === index ? sanitizeFixture({ ...c, ...patch }) : c)))

  const addCard = () => {
    if (list.length < MAX_CARDS) onChange([...list, sanitizeFixture(createEmptyFixture())])
  }

  const removeLast = () => {
    onChange(list.slice(0, -1))
    setConfirmRemove(false)
  }

  const handleMinus = () => {
    if (!last) return
    if (hasContent(last)) setConfirmRemove(true)
    else removeLast()
  }

  return (
    <div className="space-y-3">
      {/* Top row: label + stepper */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-dtf-sub">Fixtures</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Remove last fixture"
            disabled={list.length === 0}
            onClick={handleMinus}
            className="w-11 h-11 rounded-lg border border-dtf-border flex items-center justify-center text-navy disabled:opacity-40"
          >
            <Minus size={18} />
          </button>
          <span className="w-6 text-center text-base font-semibold text-dtf-text">{list.length}</span>
          <button
            type="button"
            aria-label="Add a fixture"
            disabled={list.length >= MAX_CARDS}
            onClick={addCard}
            className="w-11 h-11 rounded-lg border border-dtf-border flex items-center justify-center text-navy disabled:opacity-40"
          >
            <Plus size={18} />
          </button>
        </div>
      </div>

      {list.map((card, i) => {
        const surfaces = getAllowedSurfaces(card.fixture)
        const wallsSurfaces = getAllowedWallsSurfaces(card.fixture)
        const services = getAllowedServices(card.fixture, card.surface)
        // Repair details come in Phase 2b, so repair-related problems stay hidden for now.
        const notes = validateFixture(card).filter(p => !/repair/i.test(p))

        return (
          <div key={card.id}>
            <Card className="space-y-4">
              <h3 className="font-bold text-dtf-text">{titles[i]}</h3>

              <div>
                <FieldLabel>Name (optional)</FieldLabel>
                <div className="flex flex-wrap gap-2 mb-2">
                  {NAME_QUICK_PICKS.map(pick => (
                    <button
                      key={pick}
                      type="button"
                      aria-pressed={card.name === pick}
                      onClick={() => updateCard(i, { name: card.name === pick ? '' : pick })}
                      className={chipClass(card.name === pick)}
                    >
                      {pick}
                    </button>
                  ))}
                </div>
                <Input
                  id={`fixture-name-${card.id}`}
                  value={card.name}
                  onChange={e => updateCard(i, { name: e.target.value })}
                  placeholder="Or type a name"
                  className="min-h-[44px]"
                />
              </div>

              <div>
                <FieldLabel>Fixture</FieldLabel>
                <Chips
                  values={Object.keys(FIXTURE_LABELS)}
                  labels={FIXTURE_LABELS}
                  selected={card.fixture}
                  onSelect={v => updateCard(i, { fixture: v })}
                />
              </div>

              {surfaces.length > 0 && (
                <div>
                  <FieldLabel>Surface</FieldLabel>
                  <Chips
                    values={surfaces}
                    labels={SURFACE_LABELS}
                    selected={card.surface}
                    onSelect={v => updateCard(i, { surface: v })}
                  />
                </div>
              )}

              {wallsSurfaces.length > 0 && (
                <div>
                  <FieldLabel>Shower walls surface</FieldLabel>
                  <Chips
                    values={wallsSurfaces}
                    labels={SURFACE_LABELS}
                    selected={card.walls_surface}
                    onSelect={v => updateCard(i, { walls_surface: v })}
                  />
                </div>
              )}

              {services.length > 0 && (
                <div>
                  <FieldLabel>Service</FieldLabel>
                  <div className="flex flex-wrap gap-2">
                    {services.map(s => (
                      <Button
                        key={s}
                        type="button"
                        variant={card.service === s ? 'primary' : 'secondary'}
                        className="min-h-[44px]"
                        aria-pressed={card.service === s}
                        onClick={() => updateCard(i, { service: s })}
                      >
                        {SERVICE_LABELS[s]}
                      </Button>
                    ))}
                  </div>
                  {SERVICE_HELP[card.service] && (
                    <p className="text-xs text-dtf-sub mt-2">{SERVICE_HELP[card.service]}</p>
                  )}
                </div>
              )}

              {canStrip(card) && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={card.strip}
                  onClick={() => updateCard(i, { strip: !card.strip })}
                  className="w-full min-h-[44px] flex items-center justify-between gap-3"
                >
                  <span className="text-sm font-medium text-dtf-text">Strip</span>
                  <span className={`w-10 h-6 rounded-full transition-colors flex items-center px-1 ${card.strip ? 'bg-navy' : 'bg-gray-300'}`}>
                    <span className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${card.strip ? 'translate-x-4' : 'translate-x-0'}`} />
                  </span>
                </button>
              )}

              {needsSquareFeet(card) && (
                <Input
                  label="Square feet"
                  id={`fixture-sqft-${card.id}`}
                  inputMode="decimal"
                  value={card.square_feet ?? ''}
                  onChange={e => updateCard(i, { square_feet: e.target.value })}
                  placeholder="e.g. 22"
                  className="min-h-[44px]"
                />
              )}

              {card.service === 'repair' && (
                <p className="text-xs text-gray-500 bg-gray-100 rounded-lg px-3 py-2">
                  Repair details are added in the next update.
                </p>
              )}
            </Card>

            {notes.length > 0 && (
              <ul className="mt-1.5 px-1 space-y-0.5 text-xs text-dtf-sub">
                {notes.map(n => <li key={n}>{n}</li>)}
              </ul>
            )}
          </div>
        )
      })}

      {/* Portal keeps the Modal's un-typed close button outside the surrounding <form>. */}
      {createPortal(
        <Modal open={confirmRemove} onClose={() => setConfirmRemove(false)} title="Remove fixture?">
          <p className="text-sm text-dtf-text mb-4">
            {last ? `"${titles[titles.length - 1]}"` : 'This fixture'} has details filled in. Remove it?
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" className="flex-1 min-h-[44px]" onClick={() => setConfirmRemove(false)}>
              Keep it
            </Button>
            <Button type="button" variant="destructive" className="flex-1 min-h-[44px]" onClick={removeLast}>
              Remove
            </Button>
          </div>
        </Modal>,
        document.body
      )}
    </div>
  )
}
