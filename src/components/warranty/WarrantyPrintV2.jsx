// New warranty print (two-page certificate): used when the service date is on or after the
// switch date, or the warranty is 1 year. Same look as LegacyWarrantyPrint (its CSS is imported,
// one additive block follows). Content comes from buildWarrantyItems() in src/lib/warrantyItems.js.
//   Page 1: certificate (header, banner, customer info, item table, what is covered, claim, issued by)
//   Page 2: what is not covered, terms, care instructions, footer
// Plain ASCII file: special characters are JSX entities or built from character codes.
import { WARRANTY_PRINT_CSS } from './LegacyWarrantyPrint'
import { yearsText } from '../../lib/warranty'
import { GROUP_ORDER, MAX_WORK_LINES } from '../../lib/warrantyItems'

const NBSP = String.fromCharCode(160)
const EM_DASH = String.fromCharCode(8212)

// yyyy-mm-dd -> mm/dd/yyyy (same as the legacy print)
function fmtDate(s) {
  if (!s) return NBSP
  const parts = String(s).slice(0, 10).split('-')
  if (parts.length !== 3) return s
  const [y, m, d] = parts
  return `${m}/${d}/${y}`
}

// Additive CSS: loaded after WARRANTY_PRINT_CSS, so these rules win on equal specificity.
const V2_EXTRA_CSS = `
.warr-print ul,.warr-print ol{margin:0;padding:0} .warr-print p{margin:0} .warr-print hr{margin:0}
.warr-print .warranty-page{font-size:8.5pt}
.warr-print .pg{break-after:page;page-break-after:always} .warr-print .pg:last-child{break-after:auto;page-break-after:auto}
.warr-print .w-field label{font-size:6.5pt}
.warr-print .sec-label{font-size:7.5pt}
.warr-print .banner-title{font-size:12pt}
.warr-print .banner-sub{font-size:8.5pt;color:rgba(255,255,255,.9);margin-top:3px;max-width:480px;line-height:1.4}
.warr-print .g-banner{padding:10px 14px;margin-bottom:10px}
.warr-print .w-info-block{padding:9px 12px 10px;margin-bottom:10px}
.warr-print .w-info-top4{display:grid;grid-template-columns:1.3fr 2fr 1.1fr .9fr;gap:0 12px}
.warr-print .w-val{font-size:9pt}
.warr-print .wtable{width:100%;border-collapse:collapse;margin-top:4px}
.warr-print .wtable th{font-size:6.8pt;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#fff;background:var(--navy);text-align:left;padding:5px 8px}
.warr-print .wtable td{font-size:9pt;color:var(--black);padding:5px 8px;border-bottom:1px solid var(--gray-bd)}
.warr-print .wtable td.yr{font-weight:800;color:var(--navy);white-space:nowrap}
.warr-print .wtable td.ex{white-space:nowrap}
.warr-print .wtable tr:nth-child(even) td{background:#f9fafb}
.warr-print .wtable tr.more td{font-style:italic;color:var(--gray-txt)}
.warr-print .badge-upto{font-size:7.5pt;font-weight:800;color:var(--navy);text-transform:uppercase;letter-spacing:.1em;text-align:right}
.warr-print .p1row{display:grid;grid-template-columns:1.25fr 1fr;gap:10px;margin-bottom:10px}
.warr-print .cov-box{padding:9px 11px 10px}
.warr-print .cov-title{font-size:8.5pt}
.warr-print .cov-list li{font-size:8.3pt;line-height:1.45;padding:2px 0 2px 13px}
.warr-print .rebuild-in{margin-top:9px;border-top:1px solid #86efac;padding-top:7px}
.warr-print .rebuild-in p{font-size:8.3pt;line-height:1.45;color:#374151}
.warr-print .bottom-box{padding:9px 11px 10px}
.warr-print .claim-body{font-size:8.3pt;line-height:1.5}
.warr-print .claim-num{font-size:15pt;margin:6px 0 4px}
.warr-print .claim-note{font-size:7.8pt;margin-top:5px}
.warr-print .issued{font-size:8pt;color:var(--gray-txt);text-align:center;margin:4px 0 8px}
.warr-print .issued strong{color:var(--navy)}
.warr-print .p1note{font-size:8pt;color:var(--gray-txt);text-align:center;margin:8px 0 0}
.warr-print .p2head{display:flex;justify-content:space-between;align-items:baseline;padding-bottom:6px}
.warr-print .p2meta{font-size:8pt;color:var(--gray-txt)}
.warr-print .terms-list li{font-size:8.2pt;line-height:1.45;margin-bottom:4px}
.warr-print .t-num{font-size:8pt}
.warr-print .care-list li{font-size:8.2pt;line-height:1.45;margin-bottom:3px}
.warr-print .review{font-size:7.8pt;color:var(--gray-txt);text-align:center;margin-top:3px}
.warr-print .fcontact{font-size:7.5pt}
.warr-print .fthanks{font-size:9pt}
.warr-print .w-info-top4 .w-val{white-space:normal;overflow:visible}
`

const COVERED_FIRST = "Peeling, flaking, bubbling or lifting of any work listed above, during that item's warranty length"
const COVERED_REPAIR = 'A crack that comes back in an area we repaired'
const COVERED_BOTTOM_REFINISH = 'On a refinished floor, this includes where the new finish meets the original near the rolled edge'
const COVERED_LAST = 'Labor, materials and travel for every warranty visit'

const REBUILD_TEXT =
  "Your new fiberglass floor covers the tub or shower bottom up to just short of the rolled edge. If any part of that layer's edge lifts or pops loose during your warranty period, we fix it. A crack anywhere in the rebuilt floor is covered too."

const NOT_COVERED = [
  'New damage: chips, cracks, dents, cuts or burns from impacts, sharp objects or heat',
  'Damage from harsh or abrasive products: bleach, drain openers such as Drano, ammonia, scouring powder, abrasive pads or melamine (magic eraser) sponges',
  'Color changes or staining, including from hair dye, chemicals, rust, hard water or products left on the surface',
  'Rust that returns in or around an area we treated (we tell you before the work when this can happen)',
  'Damage from suction-cup or rubber-backed mats, adhesives, or items left sitting wet on the surface',
  'Using the surface before the 24-hour cure time',
  'Plumbing, caulking, leaks or water damage behind the fixture',
  'Conditions we pointed out to you before the work began',
]
const NOT_COVERED_REPAIR = 'The original surface outside the areas we repaired'

const CARE = [
  'Wait 24 hours before using the tub, shower, sink or countertop',
  'Wait 48 hours before using the Dallas Tub Fix aftercare cleaner',
  'Clean with gentle, non-abrasive products: our aftercare cleaner, or mild dish soap and warm water',
  "Don't use suction-cup or rubber-backed bath mats",
  "Don't leave bottles, cans, wet cloths or standing water sitting on the surface",
  'A quick wipe-down after use and a gentle weekly clean keep buildup away',
]

// Term 1 is always the same: each row of the page 1 table carries its own length.
function buildTermsV2(groups) {
  const terms = [
    'Each item in the table on page 1 is covered for the warranty length shown on its row, starting from the service date.',
    'This warranty stays with the home. If you sell during the warranty period, it passes to the new owner, who only needs the invoice number. It belongs to the owner who paid for the work; tenants are welcome to report a concern.',
  ]
  if (groups.includes('repair')) {
    terms.push('We match your color and blend each repair closely. Under bright or low-angle light, a repaired spot can still show a slight difference in texture or shine. That is normal for repair work and is not a warranty defect.')
  }
  if (groups.some(g => g === 'refinish' || g === 'bottom_refinish' || g === 'countertop')) {
    terms.push('Refinishing gives your surface a fresh, even finish. Deep marks, old repairs or texture in the original surface can still show through slightly. That is normal and is not a warranty defect.')
  }
  terms.push(
    'When a claim is covered, we repair the affected area. If the failure covers a large part of the surface, we redo the whole surface. Any refund is at our choice, up to the amount paid for that item.',
    "Looking at a concern is always free. If an issue isn't covered, such as rust returning in an area we treated, and you'd like us to touch up that same area, the return visit is $80. New damage is quoted at our standard prices. We always tell you the cost before any work.",
    'Dallas Tub Fix is not a licensed plumber or electrician and does not do plumbing or electrical work.',
    "We may remove drain covers or overflow plates to do the work and reinstall them as a courtesy. We aren't responsible for worn or corroded parts that break during removal.",
    'Photos: we may share photos of the repaired or refinished fixture. They never show people, addresses or personal items. Text us anytime to opt out.',
  )
  return terms
}

const SEAL = (
  <div className="seal"><svg viewBox="0 0 24 24"><path d="M15.5 2.1a6 6 0 0 0-7.4 7.4L2.1 15.5a2.1 2.1 0 0 0 3 3l6-5.9a6 6 0 0 0 7.4-7.4l-3.2 3.2-2.1-.7-.7-2.1 2.9-3.4z"/></svg></div>
)

const WORDMARK = (
  <div className="wordmark">
    <span className="wd wd-navy">Dallas</span>
    <span className="wd wd-gold">Tub</span>
    <span className="wd wd-navy">Fix</span>
  </div>
)

// w: the warranty fields. result: buildWarrantyItems(...) for this job.
export default function WarrantyPrintV2({ w, result }) {
  const items = Array.isArray(result.items) ? result.items : []
  const groups = GROUP_ORDER.filter(g => (result.contentGroups || []).includes(g))
  const expires = result.latestExpiry
  const terms = buildTermsV2(groups)
  const mixedLengths = items.some(item => item.years !== items[0].years)
  const shownItems = items.slice(0, MAX_WORK_LINES)
  const moreCount = result.moreCount || 0
  const workLines = result.workLines || []
  const moreText = workLines.length ? workLines[workLines.length - 1] : `+${moreCount} more items`
  const noCardsText = workLines.length ? workLines[0] : ''
  const inv = w.invoice_number || EM_DASH
  const svc = w.service_date ? fmtDate(w.service_date) : EM_DASH

  return (
    <div className="warr-print hidden print:block">
      <style>{WARRANTY_PRINT_CSS + V2_EXTRA_CSS}</style>
      <div className="warranty-page">

        {/* ===== PAGE 1: CERTIFICATE ===== */}
        <div className="pg">

          {/* HEADER */}
          <div className="w-header">
            <div className="w-logo-block">
              {WORDMARK}
              <div className="hd-sub">Bathtub &amp; Surface Specialists &middot; DFW Area</div>
              <div className="hd-sub" style={{ marginTop: '1px' }}>(469) 592-0018 &middot; dallastubfix.com &middot; Lavon, TX</div>
            </div>
            <div className="w-badge">
              {mixedLengths && <div className="badge-upto">Up to</div>}
              <div className="badge-num">{result.longest}</div>
              <div className="badge-year">Year Warranty</div>
              <div className="badge-sub">Workmanship &amp; Materials</div>
            </div>
          </div>

          <div className="rule-double"></div>
          <div className="rule-thin"></div>

          {/* BANNER */}
          <div className="g-banner">
            <div>
              <div className="banner-title">{result.title}</div>
              <div className="banner-sub">If our work peels, flakes, bubbles or lifts during your warranty period, we fix it at no cost to you: travel, labor and materials included. 100% covered, never prorated.</div>
            </div>
            <div className="banner-pill">100% Covered &middot; Labor &middot; Materials &middot; Travel</div>
          </div>

          {/* CUSTOMER INFO + WORK COVERED TABLE */}
          <div className="w-info-block">
            <div className="w-info-top4">
              <div className="w-field">
                <label>Customer Name</label>
                <span className="w-val">{w.customer_name || NBSP}</span>
              </div>
              <div className="w-field">
                <label>Service Address</label>
                <span className="w-val">{w.service_address || NBSP}</span>
              </div>
              <div className="w-field">
                <label>Invoice / Job #</label>
                <span className="w-val">{w.invoice_number || NBSP}</span>
              </div>
              <div className="w-field">
                <label>Service Date</label>
                <span className="w-val">{w.service_date ? fmtDate(w.service_date) : NBSP}</span>
              </div>
            </div>
            <div className="w-field" style={{ marginTop: '9px' }}>
              <label>Work Covered</label>
              <table className="wtable">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Service</th>
                    <th>Warranty</th>
                    <th>Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={2}>{noCardsText}</td>
                      <td className="yr">{yearsText(result.longest)}</td>
                      <td className="ex">{expires ? fmtDate(expires) : EM_DASH}</td>
                    </tr>
                  ) : (
                    shownItems.map((item, i) => (
                      <tr key={i}>
                        <td>{item.subject}</td>
                        <td>{item.serviceLabel}</td>
                        <td className="yr">{yearsText(item.years)}</td>
                        <td className="ex">{item.expiry ? fmtDate(item.expiry) : EM_DASH}</td>
                      </tr>
                    ))
                  )}
                  {moreCount > 0 && (
                    <tr className="more">
                      <td colSpan={4}>{moreText}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* WHAT IS COVERED + HOW TO MAKE A CLAIM */}
          <div className="p1row">
            <div className="cov-box green">
              <div className="cov-title g"><div className="cov-icon g">&#10003;</div>What Is Covered</div>
              <ul className="cov-list">
                <li>{COVERED_FIRST}</li>
                {groups.includes('repair') && <li>{COVERED_REPAIR}</li>}
                {groups.includes('bottom_refinish') && <li>{COVERED_BOTTOM_REFINISH}</li>}
                <li>{COVERED_LAST}</li>
              </ul>
              {result.hasRebuild && (
                <div className="rebuild-in">
                  <div className="cov-title g">Bottom Rebuild Coverage</div>
                  <p>{REBUILD_TEXT}</p>
                </div>
              )}
            </div>
            <div className="bottom-box">
              <div className="sec-label" style={{ marginBottom: '5px' }}>How to Make a Claim</div>
              <div className="claim-body">
                Call or text with your invoice number, one close-up photo and one wide photo.
                <span className="claim-num">(469) 592-0018</span>
                We reply within one business day (Monday&ndash;Saturday). If a visit is needed, we schedule it at no cost.
              </div>
              <div className="claim-note">
                Invoice # <strong style={{ color: 'var(--navy)' }}>{inv}</strong>
                {' '}&middot;{' '}Keep this warranty with your invoice.
              </div>
            </div>
          </div>

          {/* ISSUED BY (no signature lines) */}
          <hr className="rule-light" />
          <div className="issued">
            Issued by Dallas Tub Fix &middot; Technician <strong>{w.technician || EM_DASH}</strong> &middot; Invoice # <strong>{inv}</strong> &middot; Service date <strong>{svc}</strong>
          </div>
          <div className="p1note">Page 1 of 2 &middot; What isn't covered, warranty terms and care instructions are on page 2.</div>
        </div>

        {/* ===== PAGE 2: TERMS AND CARE ===== */}
        <div className="pg">

          <div className="p2head">
            {WORDMARK}
            <div className="p2meta">Warranty terms &amp; care &middot; Invoice # {inv} &middot; Page 2 of 2</div>
          </div>
          <div className="rule-double"></div>
          <div className="rule-thin"></div>

          {/* WHAT IS NOT COVERED */}
          <div className="cov-box red" style={{ marginBottom: '10px' }}>
            <div className="cov-title r"><div className="cov-icon r">&#10005;</div>What Is Not Covered</div>
            <ul className="cov-list">
              {NOT_COVERED.map((t, i) => <li key={i}>{t}</li>)}
              {groups.includes('repair') && <li>{NOT_COVERED_REPAIR}</li>}
            </ul>
          </div>

          {/* TERMS */}
          <div className="terms-sec">
            <div className="sec-label">Warranty Terms &amp; Conditions</div>
            <ol className="terms-list">
              {terms.map((t, i) => (
                <li key={i}><span className="t-num">{i + 1}.</span><span>{t}</span></li>
              ))}
            </ol>
          </div>

          {/* CARE */}
          <div className="bottom-box" style={{ marginBottom: '10px' }}>
            <div className="sec-label" style={{ marginBottom: '5px' }}>Caring for Your Surface</div>
            <ul className="care-list">
              {CARE.map((t, i) => (
                <li key={i}><span className="care-chk">&#10003;</span><span>{t}</span></li>
              ))}
            </ul>
            <div className="claim-note">Following these steps keeps your warranty in force. Damage caused by not following them isn't covered.</div>
          </div>

          {/* FOOTER */}
          <div className="w-footer">
            <div className="footer-main">
              {SEAL}
              <span className="fthanks">Dallas Tub Fix &middot; Thank You For Your Business</span>
              {SEAL}
            </div>
            <div className="review">Happy with your results? A Google review helps a small, local business more than you know.</div>
            <div className="fcontact">(469) 592-0018 &middot; dallastubfix.com &middot; Serving the Greater DFW Area</div>
          </div>
        </div>

      </div>
    </div>
  )
}
