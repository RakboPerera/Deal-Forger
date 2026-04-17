import { useMemo } from 'react';

const DEFAULT_COLORS = {
  DCF: '#2563eb',
  'Trading Comps': '#10b981',
  'Precedent Trans': '#f59e0b',
  Blended: '#7c3aed',
};

export default function FootballField({ data }) {
  if (!data || data.length === 0) {
    return (
      <div className="empty-state p-4">
        <p className="text-sm text-muted">No valuation data available to display.</p>
      </div>
    );
  }

  const { globalMin, globalMax } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    data.forEach(d => {
      if (d.low < min) min = d.low;
      if (d.high > max) max = d.high;
    });
    const padding = (max - min) * 0.08;
    return { globalMin: min - padding, globalMax: max + padding };
  }, [data]);

  const range = globalMax - globalMin;

  const toPercent = (val) => ((val - globalMin) / range) * 100;

  // Generate nice tick marks
  const ticks = useMemo(() => {
    const step = Math.pow(10, Math.floor(Math.log10(range)));
    const niceStep = range / step > 6 ? step * 2 : step;
    const start = Math.ceil(globalMin / niceStep) * niceStep;
    const arr = [];
    for (let v = start; v <= globalMax; v += niceStep) {
      arr.push(v);
    }
    return arr;
  }, [globalMin, globalMax, range]);

  return (
    <div style={{ width: '100%' }}>
      {/* Bars */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
        {data.map((d, i) => {
          const leftPct = toPercent(d.low);
          const widthPct = toPercent(d.high) - leftPct;
          const midPct = toPercent(d.mid);
          const barColor = d.color || DEFAULT_COLORS[d.name] || '#6c757d';
          const isBlended = d.name === 'Blended';

          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, height: 32 }}>
              {/* Label */}
              <div
                style={{
                  width: 130,
                  minWidth: 130,
                  textAlign: 'right',
                  fontSize: '0.8rem',
                  fontWeight: isBlended ? 700 : 500,
                  color: isBlended ? 'var(--text)' : 'var(--text-secondary)',
                  whiteSpace: 'nowrap',
                }}
              >
                {d.name}
              </div>

              {/* Bar track */}
              <div
                style={{
                  flex: 1,
                  position: 'relative',
                  height: isBlended ? 28 : 22,
                  background: '#f3f4f6',
                  borderRadius: 4,
                }}
              >
                {/* Range bar */}
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    background: barColor,
                    opacity: isBlended ? 0.3 : 0.2,
                    borderRadius: 4,
                    border: isBlended ? `2px solid ${barColor}` : 'none',
                  }}
                />
                {/* Inner bar (thinner) */}
                <div
                  style={{
                    position: 'absolute',
                    top: '25%',
                    bottom: '25%',
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    background: barColor,
                    borderRadius: 3,
                    opacity: 0.85,
                  }}
                />
                {/* Mid marker */}
                <div
                  style={{
                    position: 'absolute',
                    left: `${midPct}%`,
                    top: 0,
                    bottom: 0,
                    width: 2,
                    background: '#fff',
                    transform: 'translateX(-1px)',
                  }}
                />
                {/* Mid diamond */}
                <div
                  style={{
                    position: 'absolute',
                    left: `${midPct}%`,
                    top: '50%',
                    width: 10,
                    height: 10,
                    background: barColor,
                    border: '2px solid #fff',
                    borderRadius: 2,
                    transform: 'translate(-50%, -50%) rotate(45deg)',
                  }}
                />
                {/* Value labels */}
                <span
                  style={{
                    position: 'absolute',
                    left: `${leftPct}%`,
                    top: -16,
                    fontSize: '0.65rem',
                    color: 'var(--text-secondary)',
                    transform: 'translateX(-50%)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  ${d.low}M
                </span>
                <span
                  style={{
                    position: 'absolute',
                    left: `${leftPct + widthPct}%`,
                    top: -16,
                    fontSize: '0.65rem',
                    color: 'var(--text-secondary)',
                    transform: 'translateX(-50%)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  ${d.high}M
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* X-axis */}
      <div style={{ marginLeft: 142, position: 'relative', height: 24, borderTop: '1px solid var(--border)' }}>
        {ticks.map((tick, i) => (
          <span
            key={i}
            style={{
              position: 'absolute',
              left: `${toPercent(tick)}%`,
              top: 4,
              transform: 'translateX(-50%)',
              fontSize: '0.65rem',
              color: 'var(--text-secondary)',
              whiteSpace: 'nowrap',
            }}
          >
            ${tick}M
          </span>
        ))}
      </div>
    </div>
  );
}
