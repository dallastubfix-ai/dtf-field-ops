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
  return <div className="ui-field-label mb-2">{children}</div>
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
          className="fx-chip"
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
      <span className="ui-field-label">{label}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={minusLabel}
          disabled={count <= min}
          onClick={onMinus}
          className="fx-step"
        >
          <Minus size={18} />
        </button>
        <span className="fx-count">{count}</span>
        <button
          type="button"
          aria-label={plusLabel}
          disabled={count >= max}
          onClick={onPlus}
          className="fx-step"
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
            <Card className="fx-card">
              <h3 className="fx-title">{titles[i]}</h3>

              <div>
                <FieldLabel>Name (optional)</FieldLabel>
                <div className="flex flex-wrap gap-2 mb-2">
                  {NAME_QUICK_PICKS.map(pick => (
                    <button
                      key={pick}
                      type="button"
                      aria-pressed={card.name === pick}
                      onClick={() => updateCard(i, { name: card.name === pick ? '' : pick })}
                      className="fx-chip"
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
                      <button
                        key={s}
                        type="button"
                        className="fx-option"
                        aria-pressed={card.service === s}
                        onClick={() => updateCard(i, { service: s })}
                      >
                        {SERVICE_LABELS[s]}
                      </button>
                    ))}
                  </div>
                  {SERVICE_HELP[card.service] && (
                    <p className="fx-help mt-2">{SERVICE_HELP[card.service]}</p>
                  )}
                </div>
              )}

              {canStrip(card) && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={card.strip}
                  onClick={() => updateCard(i, { strip: !card.strip })}
                  className="switch-row"
                >
                  <span className="switch-label">Strip</span>
                  <span className="switch-track">
                    <span className="switch-thumb" />
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
                    <div key={j} className="fx-repair">
                      <div className="fx-repair-title">Repair {j + 1}</div>
                      <div className="flex gap-2">
                        {Object.keys(REPAIR_SIZE_LABELS).map(size => (
                          <button
                            key={size}
                            type="button"
                            className="fx-option flex-1"
                            aria-pressed={r.size === size}
                            onClick={() => updateRepair(i, j, { size })}
                          >
                            {REPAIR_SIZE_LABELS[size]}
                          </button>
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
                <div className="fx-lines">
                  {cardLines.map((l, k) => (
                    <div key={k} className="fx-line">
                      <span className="fx-line-desc">{l.description}</span>
                      <span className="fx-line-amount">{money.format(l.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {notes.length > 0 && (
              <ul className="fx-note mt-1.5 px-1 space-y-0.5">
                {notes.map(n => <li key={n}>{n}</li>)}
              </ul>
            )}
          </div>
        )
      })}

      {list.length > 0 && (
        <div className="fx-total">
          <div className="flex items-baseline justify-between">
            <span className="fx-total-label">{cardsNeedingDetails ? 'Total so far' : 'Total'}</span>
            <span className="fx-total-amount">{money.format(priced.total)}</span>
          </div>
          {cardsNeedingDetails > 0 && (
            <p className="fx-note mt-1">
              {cardsNeedingDetails} {cardsNeedingDetails === 1 ? 'card needs' : 'cards need'} details
            </p>
          )}
        </div>
      )}

      {/* Portal keeps the Modal's un-typed close button outside the surrounding <form>. */}
      {createPortal(
        <Modal open={confirmRemove} onClose={() => setConfirmRemove(false)} title="Remove fixture?">
          <p className="fx-modal-text mb-4">
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
