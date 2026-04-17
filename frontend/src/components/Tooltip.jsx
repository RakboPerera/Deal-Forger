import { useState, useRef, useEffect } from 'react';
import { HelpCircle } from 'lucide-react';

/**
 * Canonical definitions for finance terms used throughout the app.
 * Keys are matched case-insensitively and ignoring parenthesised suffixes,
 * so "WACC" and "WACC (%)" both hit the same entry.
 */
export const FINANCE_TERMS = {
  'dcf': {
    title: 'Discounted Cash Flow (DCF)',
    body: 'A valuation method that projects a company\'s future unlevered free cash flows and discounts them to present value using the WACC. The sum of discounted FCFs plus the terminal value equals the implied Enterprise Value.',
  },
  'wacc': {
    title: 'Weighted Average Cost of Capital (WACC)',
    body: 'The blended cost of funding for debt and equity — used as the discount rate in the DCF. Higher WACC → lower valuation. Typical range for mid-cap SaaS is 9–12%.',
  },
  'terminal growth rate': {
    title: 'Terminal Growth Rate',
    body: 'The perpetual growth rate assumed beyond the explicit forecast period. Usually pegged slightly above long-run GDP (2–3.5%). Higher terminal growth → higher terminal value → higher EV.',
  },
  'terminal value': {
    title: 'Terminal Value',
    body: 'The value of all cash flows beyond the explicit forecast, computed as FCF(n+1) / (WACC − terminal growth). Typically 50–85% of total DCF — sensitive to WACC/growth assumptions.',
  },
  'enterprise value': {
    title: 'Enterprise Value (EV)',
    body: 'Total value of the business to all capital providers (debt + equity). EV = Equity Value + Debt − Cash. The DCF output is an EV figure.',
  },
  'equity value': {
    title: 'Equity Value',
    body: 'Value attributable to shareholders. Equity Value = Enterprise Value + Cash − Debt.',
  },
  'ev/ebitda': {
    title: 'EV / EBITDA Multiple',
    body: 'Enterprise Value divided by EBITDA. A standard valuation multiple — analysts compare a target\'s EV/EBITDA to public peer set and recent M&A transactions.',
  },
  'ev/revenue': {
    title: 'EV / Revenue Multiple',
    body: 'Enterprise Value divided by Revenue. Used for pre-profitability or hyper-growth companies where EBITDA comparisons are less meaningful.',
  },
  'ebitda': {
    title: 'EBITDA',
    body: 'Earnings Before Interest, Taxes, Depreciation, and Amortization. A proxy for operating cash profitability, widely used to compare across capital structures and tax jurisdictions.',
  },
  'ebitda margin': {
    title: 'EBITDA Margin',
    body: 'EBITDA divided by Revenue, expressed as a percentage. A key indicator of operational efficiency. Software companies typically target 30–40%; mature industrials 15–25%.',
  },
  'irr': {
    title: 'Internal Rate of Return (IRR)',
    body: 'The annualized return on an investment, computed so that the net present value of all cash flows equals zero. PE target: 20–25% for buyouts, 15–20% for growth equity.',
  },
  'moic': {
    title: 'Multiple on Invested Capital (MOIC)',
    body: 'Exit value divided by entry cost. A MOIC of 2.0x means the deal doubled the money invested. Typically paired with IRR since MOIC is duration-blind.',
  },
  'fcf': {
    title: 'Free Cash Flow (FCF)',
    body: 'Cash from operations minus capex. Represents the cash available to pay debt, dividends, or reinvest. Formula used: EBIT × (1 − tax) + D&A − Capex − ΔWC.',
  },
  'control premium': {
    title: 'Control Premium',
    body: 'The premium over trading value that an acquirer pays for full control of a target. Typical range: 20–35% — applied on top of precedent transaction multiples.',
  },
  'football field': {
    title: 'Football Field Chart',
    body: 'A visualization showing valuation ranges from multiple methodologies (DCF, trading comps, precedent transactions) side-by-side, with a blended weighted value.',
  },
  'sensitivity': {
    title: 'Sensitivity Analysis',
    body: 'A grid showing how the Enterprise Value changes when two key assumptions (usually WACC and terminal growth) are flexed across a range.',
  },
  'blended valuation': {
    title: 'Blended Valuation',
    body: 'A weighted combination of DCF, Trading Comps, and Precedent Transactions valuations — typically 40/30/30. Smooths out method-specific noise.',
  },
  'football bar': {
    title: 'Football Field Bar',
    body: 'Shows the low / mid / high valuation range from a single method. The vertical tick marks the mid-point; shaded width shows the spread.',
  },
};

function lookupTerm(term) {
  if (!term) return null;
  const key = String(term).toLowerCase().replace(/\s*\(.+?\)\s*$/, '').trim();
  return FINANCE_TERMS[key] || null;
}

/**
 * Inline help icon + popover. Wrap a label with this to get a (?) tooltip.
 * Usage:
 *   <Tooltip term="WACC">WACC</Tooltip>
 * or with custom content:
 *   <Tooltip title="My title" body="My explanation">...</Tooltip>
 */
export default function Tooltip({ term, title, body, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const resolved = term ? lookupTerm(term) : { title, body };
  if (!resolved) return children;

  return (
    <span
      ref={ref}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4 }}
    >
      {children}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 14, height: 14, border: 'none', background: 'transparent',
          color: '#94a3b8', cursor: 'help', padding: 0,
        }}
        aria-label={`Help: ${resolved.title}`}
      >
        <HelpCircle size={12} />
      </button>
      {open && (
        <span
          role="tooltip"
          style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 6,
            zIndex: 1000, width: 280,
            background: '#1e293b', color: '#f8fafc',
            padding: '10px 12px', borderRadius: 8, fontSize: '0.76rem',
            lineHeight: 1.45, boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
            fontWeight: 400,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4, fontSize: '0.78rem' }}>{resolved.title}</div>
          <div>{resolved.body}</div>
        </span>
      )}
    </span>
  );
}
