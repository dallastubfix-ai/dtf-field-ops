import { priceJob, getFixtureTitles, validateFixture } from '../../lib/fixtures'

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export default function FixtureSummary({ cards }) {
  const priced = priceJob(cards)
  const titles = getFixtureTitles(cards)
  const cardsNeedingDetails = new Set(priced.problems.map(p => p.cardId)).size

  return (
    <div className="space-y-3">
      {cards.map((card, i) => {
        const lines = priced.lines.filter(l => l.cardId === card.id)
        const notes = validateFixture(card)
        return (
          <div key={card.id} className="fx-sum-card">
            <div className="fx-sum-title">{titles[i]}</div>
            {lines.map((l, k) => (
              <div key={k} className="fx-sum-line">
                <span>{l.description}</span>
                <span className="fx-sum-amount">{money.format(l.amount)}</span>
              </div>
            ))}
            {notes.length > 0 && (
              <ul className="fx-note space-y-0.5">
                {notes.map(n => <li key={n}>{n}</li>)}
              </ul>
            )}
          </div>
        )
      })}
      <div className="fx-sum-total">
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
    </div>
  )
}
