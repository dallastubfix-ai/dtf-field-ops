import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Plus, Trash2 } from 'lucide-react'
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
// Collapse animation is 220ms; scrolls that follow a collapse wait for it, with this as a backstop.
const COLLAPSE_FALLBACK_MS = 300

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

function isTextEntry(el) {
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

// data-fx key of the group to scroll to after a tap, or null. `from` is what was just chosen.
function nextTargetKey(card, from, repairIndex) {
  const id = card.id
  const complete = validateFixture(card).length === 0
  switch (from) {
    case 'fixture':
      return getAllowedSurfaces(card.fixture).length ? `surface-${id}` : `service-${id}`
    case 'surface':
      return getAllowedWallsSurfaces(card.fixture).length ? `walls-${id}` : `service-${id}`
    case 'walls':
      return `service-${id}`
    case 'service':
      if (canStrip(card)) return `strip-${id}`
      if (needsSquareFeet(card)) return `sqft-${id}`
      if (card.service === 'repair') return `repair-${id}-0`
      return complete ? `done-${id}` : null
    case 'repairSize':
      return `damage-${id}-${repairIndex}`
    case 'damage':
      return complete ? `done-${id}` : null
    default:
      return null
  }
}

export default function FixtureCardsEditor({ cards, onChange }) {
  const [pendingRemoveId, setPendingRemoveId] = useState(null)
  // UI only, never saved with the fixtures: card id -> false (collapsed) or true (expanded by the user).
  // A card with no entry is open. Complete cards start collapsed.
  const [expanded, setExpanded] = useState(() => {
    const start = {}
    for (const c of Array.isArray(cards) ? cards : []) {
      if (validateFixture(c).length === 0) start[c.id] = false
    }
    return start
  })
  const rootRef = useRef(null)
  const intentRef = useRef(null)
  const cancelScrollRef = useRef(null)
  const list = Array.isArray(cards) ? cards : []
  const titles = getFixtureTitles(list)
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

  const removeRepair = (index, repairIndex) => {
    const repairs = list[index].repairs
    if (repairs.length > 1) updateCard(index, { repairs: repairs.filter((_, j) => j !== repairIndex) })
  }

  // A tap on a chip or option: remember what was chosen so the effect below can scroll to the next group.
  const choose = (index, patch, from) => {
    intentRef.current = { kind: 'next', id: list[index].id, from }
    updateCard(index, patch)
  }

  const chooseRepair = (index, repairIndex, patch, from) => {
    intentRef.current = { kind: 'next', id: list[index].id, from, repairIndex }
    updateRepair(index, repairIndex, patch)
  }

  const addCard = () => {
    if (list.length >= MAX_CARDS) return
    const fresh = sanitizeFixture(createEmptyFixture())
    // A complete, open card above the new one collapses first.
    const tail = list[list.length - 1]
    let collapsingId = null
    if (tail && validateFixture(tail).length === 0 && expanded[tail.id] !== false) {
      collapsingId = tail.id
      setExpanded(m => ({ ...m, [tail.id]: false }))
    }
    intentRef.current = { kind: 'card', id: fresh.id, collapsingId }
    onChange([...list, fresh])
  }

  const doneCard = (id) => {
    intentRef.current = { kind: 'add', id, collapsingId: id }
    setExpanded(m => ({ ...m, [id]: false }))
  }

  const expandCard = (id) => setExpanded(m => ({ ...m, [id]: true }))

  const removeCard = (id) => {
    onChange(list.filter(c => c.id !== id))
    setExpanded(m => {
      const next = { ...m }
      delete next[id]
      return next
    })
    setPendingRemoveId(null)
  }

  const requestRemove = (index) => {
    const card = list[index]
    if (hasContent(card)) setPendingRemoveId(card.id)
    else removeCard(card.id)
  }

  // Runs after every commit but only acts when a tap left an intent: moves focus (Add/Done) and scrolls.
  useEffect(() => {
    const intent = intentRef.current
    if (!intent) return
    intentRef.current = null
    cancelScrollRef.current?.()
    cancelScrollRef.current = null

    const find = key => rootRef.current?.querySelector(`[data-fx="${key}"]`) ?? null
    const reduced = prefersReducedMotion()
    const scrollToKey = (key) => {
      const el = key ? find(key) : null
      if (!el || isTextEntry(document.activeElement)) return
      el.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
    }

    if (intent.kind === 'next') {
      const card = list.find(c => c.id === intent.id)
      if (!card) return
      const key = nextTargetKey(card, intent.from, intent.repairIndex)
      const raf = requestAnimationFrame(() => scrollToKey(key))
      cancelScrollRef.current = () => cancelAnimationFrame(raf)
      return
    }

    // Add fixture / Done: move focus without scrolling or opening the keyboard, then scroll once the
    // collapse above has settled (the target moves while it animates).
    let scrollKey
    if (intent.kind === 'card') {
      scrollKey = `card-${intent.id}`
      find(scrollKey)?.focus({ preventScroll: true })
    } else {
      scrollKey = 'add'
      ;(find('add') ?? find(`card-${intent.id}`))?.focus({ preventScroll: true })
    }

    const collapsing = !reduced && intent.collapsingId ? find(`body-${intent.collapsingId}`) : null
    if (!collapsing) {
      const raf = requestAnimationFrame(() => scrollToKey(scrollKey))
      cancelScrollRef.current = () => cancelAnimationFrame(raf)
      return
    }

    let settled = false
    let timer = null
    const stop = () => {
      collapsing.removeEventListener('transitionend', onEnd)
      clearTimeout(timer)
    }
    const settle = () => {
      if (settled) return
      settled = true
      stop()
      scrollToKey(scrollKey)
    }
    function onEnd(e) {
      if (e.target === collapsing && e.propertyName === 'grid-template-rows') settle()
    }
    collapsing.addEventListener('transitionend', onEnd)
    timer = setTimeout(settle, COLLAPSE_FALLBACK_MS)
    cancelScrollRef.current = () => {
      settled = true
      stop()
    }
  })

  useEffect(() => () => cancelScrollRef.current?.(), [])

  const pendingIndex = list.findIndex(c => c.id === pendingRemoveId)

  return (
    <div ref={rootRef} className="space-y-3">
      <div className="ui-field-label">Fixtures</div>

      {list.map((card, i) => {
        const surfaces = getAllowedSurfaces(card.fixture)
        const wallsSurfaces = getAllowedWallsSurfaces(card.fixture)
        const services = getAllowedServices(card.fixture, card.surface)
        const notes = validateFixture(card)
        const cardLines = priced.lines.filter(l => l.cardId === card.id)
        const complete = notes.length === 0
        const collapsed = complete && expanded[card.id] === false
        const subtotal = cardLines.reduce((sum, l) => sum + Math.round(l.amount * 100), 0) / 100

        return (
          <section
            key={card.id}
            tabIndex={-1}
            aria-label={titles[i]}
            data-fx={`card-${card.id}`}
            className="fx-section fx-scroll-target"
          >
            {complete && (
              <div className="fx-collapse" data-open={collapsed}>
                <div className="fx-collapse-inner">
                  <button
                    type="button"
                    aria-expanded="false"
                    onClick={() => expandCard(card.id)}
                    className="fx-row"
                  >
                    <span className="fx-row-check"><Check size={18} strokeWidth={2.4} /></span>
                    <span className="fx-row-text">
                      <span className="fx-row-title">{titles[i]}</span>
                      <span className="fx-row-service">{SERVICE_LABELS[card.service]}</span>
                    </span>
                    <span className="fx-row-amount">{money.format(subtotal)}</span>
                    <ChevronDown size={20} className="fx-row-chevron" />
                  </button>
                </div>
              </div>
            )}

            <div className="fx-collapse" data-open={!collapsed} data-fx={`body-${card.id}`}>
              <div className="fx-collapse-inner">
                <Card className="fx-card">
                  <div className="fx-head">
                    <h3 className="fx-title">{titles[i]}</h3>
                    <button
                      type="button"
                      aria-label={`Remove ${titles[i]}`}
                      onClick={() => requestRemove(i)}
                      className="fx-trash"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>

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
                      onSelect={v => choose(i, { fixture: v }, 'fixture')}
                    />
                  </div>

                  {surfaces.length > 0 && (
                    <div data-fx={`surface-${card.id}`} className="fx-scroll-target">
                      <FieldLabel>Surface</FieldLabel>
                      <Chips
                        values={surfaces}
                        labels={SURFACE_LABELS}
                        selected={card.surface}
                        onSelect={v => choose(i, { surface: v }, 'surface')}
                      />
                    </div>
                  )}

                  {wallsSurfaces.length > 0 && (
                    <div data-fx={`walls-${card.id}`} className="fx-scroll-target">
                      <FieldLabel>Shower walls surface</FieldLabel>
                      <Chips
                        values={wallsSurfaces}
                        labels={SURFACE_LABELS}
                        selected={card.walls_surface}
                        onSelect={v => choose(i, { walls_surface: v }, 'walls')}
                      />
                    </div>
                  )}

                  {services.length > 0 && (
                    <div data-fx={`service-${card.id}`} className="fx-scroll-target">
                      <FieldLabel>Service</FieldLabel>
                      <div className="flex flex-wrap gap-2">
                        {services.map(s => (
                          <button
                            key={s}
                            type="button"
                            className="fx-option"
                            aria-pressed={card.service === s}
                            onClick={() => choose(i, { service: s }, 'service')}
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
                      data-fx={`strip-${card.id}`}
                      onClick={() => updateCard(i, { strip: !card.strip })}
                      className="switch-row fx-scroll-target"
                    >
                      <span className="switch-label">Strip</span>
                      <span className="switch-track">
                        <span className="switch-thumb" />
                      </span>
                    </button>
                  )}

                  {needsSquareFeet(card) && (
                    <div data-fx={`sqft-${card.id}`} className="fx-scroll-target">
                      <Input
                        label="Square feet"
                        id={`fixture-sqft-${card.id}`}
                        inputMode="decimal"
                        value={card.square_feet ?? ''}
                        onChange={e => updateCard(i, { square_feet: e.target.value })}
                        placeholder="e.g. 22"
                      />
                    </div>
                  )}

                  {card.service === 'repair' && (
                    <div className="space-y-3">
                      <div className="ui-field-label">Repairs</div>
                      {card.repairs.map((r, j) => (
                        <div key={j} className="fx-repair fx-scroll-target" data-fx={`repair-${card.id}-${j}`}>
                          <div className="fx-head">
                            <div className="fx-repair-title">Repair {j + 1}</div>
                            {card.repairs.length > 1 && (
                              <button
                                type="button"
                                aria-label={`Remove Repair ${j + 1}`}
                                onClick={() => removeRepair(i, j)}
                                className="fx-trash"
                              >
                                <Trash2 size={20} />
                              </button>
                            )}
                          </div>
                          <div className="flex gap-2">
                            {Object.keys(REPAIR_SIZE_LABELS).map(size => (
                              <button
                                key={size}
                                type="button"
                                className="fx-option flex-1"
                                aria-pressed={r.size === size}
                                onClick={() => chooseRepair(i, j, { size }, 'repairSize')}
                              >
                                {REPAIR_SIZE_LABELS[size]}
                              </button>
                            ))}
                          </div>
                          <div data-fx={`damage-${card.id}-${j}`} className="fx-scroll-target">
                            <Chips
                              values={Object.keys(DAMAGE_LABELS)}
                              labels={DAMAGE_LABELS}
                              selected={r.damage}
                              onSelect={damage => chooseRepair(i, j, { damage }, 'damage')}
                            />
                          </div>
                        </div>
                      ))}
                      {card.repairs.length < MAX_REPAIRS && (
                        <button type="button" onClick={() => addRepair(i)} className="fx-add-repair">
                          <Plus size={18} strokeWidth={2.4} />
                          Add repair
                        </button>
                      )}
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

                  {complete && (
                    <Button
                      type="button"
                      variant="primary"
                      className="fx-scroll-target w-full h-12"
                      data-fx={`done-${card.id}`}
                      onClick={() => doneCard(card.id)}
                    >
                      Done
                    </Button>
                  )}
                </Card>

                {notes.length > 0 && (
                  <ul className="fx-note mt-1.5 px-1 space-y-0.5">
                    {notes.map(n => <li key={n}>{n}</li>)}
                  </ul>
                )}
              </div>
            </div>
          </section>
        )
      })}

      {list.length < MAX_CARDS && (
        <button
          type="button"
          data-fx="add"
          onClick={addCard}
          className={`fx-add fx-scroll-target${list.length === 0 ? ' fx-add--empty' : ''}`}
        >
          <Plus size={20} strokeWidth={2.4} />
          Add fixture
        </button>
      )}

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
        <Modal open={pendingRemoveId !== null} onClose={() => setPendingRemoveId(null)} title="Remove fixture?">
          <p className="fx-modal-text mb-4">
            {pendingIndex >= 0 ? `"${titles[pendingIndex]}"` : 'This fixture'} has details filled in. Remove it?
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" className="flex-1 min-h-[44px]" onClick={() => setPendingRemoveId(null)}>
              Keep it
            </Button>
            <Button type="button" variant="destructive" className="flex-1 min-h-[44px]" onClick={() => removeCard(pendingRemoveId)}>
              Remove
            </Button>
          </div>
        </Modal>,
        document.body
      )}
    </div>
  )
}
