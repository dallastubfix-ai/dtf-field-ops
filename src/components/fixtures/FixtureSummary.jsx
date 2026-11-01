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
          <div key={card.id} className="space-y-1">
            <div className="text-sm font-semibold text-[#1F2937]">{titles[i]}</div>
            {lines.map((l, k) => (
              <div key={k} className="flex justify-between gap-3 text-sm text-[#1F2937]">
                <span>{l.description}</span>
                <span className="font-medium whitespace-nowrap">{money.format(l.amount)}</span>
              </div>
            ))}
            {notes.length > 0 && (
              <ul className="space-y-0.5 text-xs text-[#6B7280]">
                {notes.map(n => <li key={n}>{n}</li>)}
              </ul>
            )}
          </div>
        )
      })}
      <div className="rounded-xl border border-[#E5E7EB] bg-[#F3F4F6] px-4 py-3">
        <div className="flex items-baseline justify-between">
          <span className="font-bold text-[#1F2937]">{cardsNeedingDetails ? 'Total so far' : 'Total'}</span>
          <span className="text-lg font-bold text-navy">{money.format(priced.total)}</span>
        </div>
        {cardsNeedingDetails > 0 && (
          <p className="text-xs text-[#6B7280] mt-1">
            {cardsNeedingDetails} {cardsNeedingDetails === 1 ? 'card needs' : 'cards need'} details
          </p>
        )}
      </div>
    </div>
  )
}
