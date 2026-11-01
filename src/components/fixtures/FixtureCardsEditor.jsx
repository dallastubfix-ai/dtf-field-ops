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
  DAMAGE_LABELS, REPAIR_SIZE_LABELS, priceJob,
} from '../../lib/fixtures'

const MAX_CARDS = 10
const MAX_REPAIRS = 10

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

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

function Stepper({ label, count, min, max, onMinus, onPlus, minusLabel, plusLabel }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs font-semibold uppercase tracking-wide text-dtf-sub">{label}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={minusLabel}
          disabled={count <= min}
          onClick={onMinus}
          className="w-11 h-11 rounded-lg border border-dtf-border flex items-center justify-center text-navy disabled:opacity-40"
        >
          <Minus size={18} />
        </button>
        <span className="w-6 text-center text-base font-semibold text-dtf-text">{count}</span>
        <button
          type="button"
          aria-label={plusLabel}
          disabled={count >= max}
          onClick={onPlus}
          className="w-11 h-11 rounded-lg border border-dtf-border flex items-center justify-center text-navy disabled:opacity-40"
        >
          <Plus size={18} />
        </button>
      </div>
    </div>
  )
}

export default function FixtureCardsEditor({ cards, onChange }) {
  const [confirmRemove, setConfirmRemove] = useState(false)
  const list = Array.isArray(cards) ? cards : []
  const titles = getFixtureTitles(list)
  const last = list[list.length - 1]
  const priced = priceJob(list)
  const cardsNeedingDetails = new Set(priced.problems.map(p => p.cardId)).size

  const updateCard = (index, patch) =>
    onChange(list.map((c, i) => {
      if (i !== index) return c
      const next = { ...c, ...patch }
      // Switching to repair starts the card with one empty repair.
      if (next.service === 'repair' && c.service !== 'repair' && !(next.repairs && next.repairs.length)) {
        next.repairs = [{ size: '', damage: '' }]
      }
      return sanitizeFixture(next)
    }))

  const updateRepair = (index, repairIndex, patch) =>
    updateCard(index, {
      repairs: list[index].repairs.map((r, j) => (j === repairIndex ? { ...r, ...patch } : r)),
    })

  const addRepair = (index) => {
    const repairs = list[index].repairs
    if (repairs.length < MAX_REPAIRS) updateCard(index, { repairs: [...repairs, { size: '', damage: '' }] })
  }

  const removeLastRepair = (index) => {
    const repairs = list[index].repairs
    if (repairs.length > 1) updateCard(index, { repairs: repairs.slice(0, -1) })
  }

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
      <Stepper
        label="Fixtures"
        count={list.length}
        min={0}
        max={MAX_CARDS}
        onMinus={handleMinus}
        onPlus={addCard}
        minusLabel="Remove last fixture"
        plusLabel="Add a fixture"
      />

      {list.map((card, i) => {
        const surfaces = getAllowedSurfaces(card.fixture)
        const wallsSurfaces = getAllowedWallsSurfaces(card.fixture)
        const services = getAllowedServices(card.fixture, card.surface)
        const notes = validateFixture(card)
        const cardLines = priced.lines.filter(l => l.cardId === card.id)

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
                <div className="space-y-3">
                  <Stepper
                    label="Repairs"
                    count={card.repairs.length}
                    min={1}
                    max={MAX_REPAIRS}
                    onMinus={() => removeLastRepair(i)}
                    onPlus={() => addRepair(i)}
                    minusLabel="Remove last repair"
                    plusLabel="Add a repair"
                  />
                  {card.repairs.map((r, j) => (
                    <div key={j} className="rounded-lg border border-dtf-border p-3 space-y-3">
                      <div className="text-sm font-semibold text-dtf-text">Repair {j + 1}</div>
                      <div className="flex gap-2">
                        {Object.keys(REPAIR_SIZE_LABELS).map(size => (
                          <Button
                            key={size}
                            type="button"
                            variant={r.size === size ? 'primary' : 'secondary'}
                            className="flex-1 min-h-[44px]"
                            aria-pressed={r.size === size}
                            onClick={() => updateRepair(i, j, { size })}
                          >
                            {REPAIR_SIZE_LABELS[size]}
                          </Button>
                        ))}
                      </div>
                      <Chips
                        values={Object.keys(DAMAGE_LABELS)}
                        labels={DAMAGE_LABELS}
                        selected={r.damage}
                        onSelect={damage => updateRepair(i, j, { damage })}
                      />
                    </div>
                  ))}
                </div>
              )}

              {cardLines.length > 0 && (
                <div className="border-t border-dtf-border pt-3 space-y-1">
                  {cardLines.map((l, k) => (
                    <div key={k} className="flex justify-between gap-3 text-sm text-dtf-text">
                      <span>{l.description}</span>
                      <span className="font-medium whitespace-nowrap">{money.format(l.amount)}</span>
                    </div>
                  ))}
                </div>
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

      {list.length > 0 && (
        <div className="rounded-xl border border-dtf-border bg-dtf-bg px-4 py-3">
          <div className="flex items-baseline justify-between">
            <span className="font-bold text-dtf-text">{cardsNeedingDetails ? 'Total so far' : 'Total'}</span>
            <span className="text-lg font-bold text-navy">{money.format(priced.total)}</span>
          </div>
          {cardsNeedingDetails > 0 && (
            <p className="text-xs text-dtf-sub mt-1">
              {cardsNeedingDetails} {cardsNeedingDetails === 1 ? 'card needs' : 'cards need'} details
            </p>
          )}
        </div>
      )}

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
