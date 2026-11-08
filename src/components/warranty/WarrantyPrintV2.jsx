// New warranty print: used when the service date is on or after the switch date, or the
// warranty is 1 year. Same look as LegacyWarrantyPrint (its CSS is imported, one additive
// block follows). Content comes from buildWarrantyItems() in src/lib/warrantyItems.js.
// Plain ASCII file: special characters are JSX entities or built from character codes.
import { WARRANTY_PRINT_CSS } from './LegacyWarrantyPrint'
import { YEARS_WORD } from '../../lib/warranty'
import { GROUP_ORDER } from '../../lib/warrantyItems'

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
.warr-print ul, .warr-print ol { margin:0; padding:0; }
.warr-print .w-field label { font-size:6.5pt; }
.warr-print .sec-label { font-size:7pt; }
.warr-print .banner-sub { font-size:7.5pt; color:rgba(255,255,255,0.88); margin-top:2px; max-width:470px; line-height:1.35; }
.warr-print .w-info-work { margin-top:6px; }
.warr-print .w-info-work .w-val { white-space:normal; font-size:7.5pt; line-height:1.35; min-height:0; }
.warr-print .cov-sub { font-size:6.5pt; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; color:var(--green); margin:4px 0 1px; }
.warr-print .rebuild-in { margin-top:8px; border-top:1px solid #86efac; padding-top:6px; }
.warr-print .rebuild-in p { font-size:7pt; line-height:1.45; color:#374151; margin:0; }
.warr-print .claim-note { font-size:7pt; }
.warr-print .fcontact { font-size:6.5pt; }
.warr-print .issued { font-size:7pt; color:var(--gray-txt); text-align:center; margin:2px 0 6px; }
.warr-print .issued strong { color:var(--navy); }
.warr-print .review { font-size:6.5pt; color:var(--gray-txt); text-align:center; margin-top:2px; }
/* One-page fit: slightly smaller list text and tighter spacing than the legacy print. */
.warr-print .cov-list li { font-size:6.5pt; line-height:1.35; padding:1px 0 1px 12px; }
.warr-print .terms-list li { font-size:6.4pt; line-height:1.3; margin-bottom:2px; }
.warr-print .care-list li { font-size:6.4pt; line-height:1.3; }
.warr-print .claim-body { font-size:6.6pt; }
`

const COVERED = {
  repair: [
    'Peeling, flaking, bubbling or lifting of any area we repaired',
    'A crack that comes back in an area we repaired',
  ],
  bottom_refinish: [
    'Peeling, flaking, bubbling or lifting of the refinished floor, including where the new finish meets the original near the rolled edge',
  ],
  refinish: [
    'Peeling, flaking, bubbling or lifting of the refinished tub, shower walls or sink',
  ],
  countertop: [
    'Peeling, flaking, bubbling or lifting of the refinished countertop',
  ],
}

const COVERED_ALL = 'Labor, materials and travel for every warranty visit'

const SUB_LABELS = {
  repair: 'Repairs',
  bottom_refinish: 'Bottom refinish',
  refinish: 'Refinishing',
  countertop: 'Countertop refinishing',
}

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

// Term 1 depends on whether every item has the same length.
function lengthTerm(items, longest) {
  const same = items.every(item => item.years === items[0].years)
  if (!same) {
    return 'Each item listed under Work Covered is covered for the length shown next to it, from the service date shown above.'
  }
  const word = YEARS_WORD[longest] ?? longest
  return `Valid for ${word} (${longest}) ${longest === 1 ? 'year' : 'years'} from the service date shown above, for the work listed under Work Covered.`
}

function buildTermsV2(items, longest, groups) {
  const terms = [
    lengthTerm(items, longest),
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

// w: the warranty fields. result: buildWarrantyItems(...) for this job.
export default function WarrantyPrintV2({ w, result }) {
  const items = Array.isArray(result.items) ? result.items : []
  const groups = GROUP_ORDER.filter(g => (result.contentGroups || []).includes(g))
  const multi = groups.length > 1
  const expires = result.latestExpiry
  const terms = buildTermsV2(items, result.longest, groups)

  return (
    <div className="warr-print hidden print:block">
      <style>{WARRANTY_PRINT_CSS + V2_EXTRA_CSS}</style>
      <div className="warranty-page">

        {/* HEADER */}
        <div className="w-header">
          <div className="w-logo-block">
            <div className="wordmark">
              <span className="wd wd-navy">Dallas</span>
              <span className="wd wd-gold">Tub</span>
              <span className="wd wd-navy">Fix</span>
            </div>
            <div className="hd-sub">Bathtub &amp; Surface Specialists &middot; DFW Area</div>
            <div className="hd-sub" style={{ marginTop: '1px' }}>(469) 592-0018 &middot; dallastubfix.com &middot; Lavon, TX</div>
          </div>
          <div className="w-badge">
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

        {/* CUSTOMER INFO + WORK COVERED */}
        <div className="w-info-block">
          <div className="w-info-top">
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
          </div>
          <div className="w-info-bottom">
            <div className="w-field">
              <label>Service Date</label>
              <span className="w-val">{w.service_date ? fmtDate(w.service_date) : NBSP}</span>
            </div>
            <div className="w-field">
              <label>Warranty Expires</label>
              <span className="w-val">{expires ? fmtDate(expires) : NBSP}</span>
            </div>
            <div className="w-field">
              <label>Technician</label>
              <span className="w-val">{w.technician || NBSP}</span>
            </div>
          </div>
          <div className="w-field w-info-work">
            <label>Work Covered</label>
            <div className="w-val">
              {(result.workLines || []).map((line, i) => <div key={i}>{line}</div>)}
            </div>
          </div>
        </div>

        {/* COVERED / NOT COVERED */}
        <div className="cov-row">
          <div className="cov-box green">
            <div className="cov-title g"><div className="cov-icon g">&#10003;</div>What Is Covered</div>
            {groups.map(g => (
              <div key={g}>
                {multi && <div className="cov-sub">{SUB_LABELS[g]}</div>}
                <ul className="cov-list">
                  {COVERED[g].map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              </div>
            ))}
            <ul className="cov-list">
              <li>{COVERED_ALL}</li>
            </ul>
            {result.hasRebuild && (
              <div className="rebuild-in">
                <div className="cov-title g">Bottom Rebuild Coverage</div>
                <p>{REBUILD_TEXT}</p>
              </div>
            )}
          </div>
          <div className="cov-box red">
            <div className="cov-title r"><div className="cov-icon r">&#10005;</div>What Is Not Covered</div>
            <ul className="cov-list">
              {NOT_COVERED.map((t, i) => <li key={i}>{t}</li>)}
              {groups.includes('repair') && <li>{NOT_COVERED_REPAIR}</li>}
            </ul>
          </div>
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

        {/* CARE + CLAIM */}
        <div className="bottom-row">
          <div className="bottom-box">
            <div className="sec-label" style={{ marginBottom: '5px' }}>Caring for Your Surface</div>
            <ul className="care-list">
              {CARE.map((t, i) => (
                <li key={i}><span className="care-chk">&#10003;</span><span>{t}</span></li>
              ))}
            </ul>
            <div className="claim-note">Following these steps keeps your warranty in force. Damage caused by not following them isn't covered.</div>
          </div>
          <div className="bottom-box">
            <div className="sec-label" style={{ marginBottom: '5px' }}>How to Make a Claim</div>
            <div className="claim-body">
              Call or text with your invoice number, one close-up photo and one wide photo.
              <span className="claim-num">(469) 592-0018</span>
              We reply within one business day (Monday&ndash;Saturday). If a visit is needed, we schedule it at no cost.
            </div>
            <div className="claim-note">
              Invoice # <strong style={{ color: 'var(--navy)' }}>{w.invoice_number || EM_DASH}</strong>
              {' '}&middot;{' '}Expires: <strong style={{ color: 'var(--navy)' }}>{expires ? fmtDate(expires) : EM_DASH}</strong>
            </div>
          </div>
        </div>

        {/* ISSUED BY (no signature lines) */}
        <hr className="rule-light" />
        <div className="issued">
          Issued by Dallas Tub Fix &middot; Invoice # <strong>{w.invoice_number || EM_DASH}</strong> &middot; Service date <strong>{w.service_date ? fmtDate(w.service_date) : EM_DASH}</strong>
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
  )
}
