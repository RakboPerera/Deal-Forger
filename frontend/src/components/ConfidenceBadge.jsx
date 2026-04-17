const SIZE_STYLES = {
  sm: { fontSize: '0.7rem', padding: '2px 7px', fontWeight: 600 },
  md: { fontSize: '0.8rem', padding: '3px 10px', fontWeight: 600 },
  lg: { fontSize: '0.95rem', padding: '5px 14px', fontWeight: 700 },
};

function getColor(score) {
  if (score >= 0.75) return { bg: '#d1fae5', color: '#065f46', label: 'High confidence' };
  if (score >= 0.50) return { bg: '#fef3c7', color: '#92400e', label: 'Medium confidence' };
  return { bg: '#fee2e2', color: '#991b1b', label: 'Low confidence' };
}

export default function ConfidenceBadge({ score, size = 'sm' }) {
  if (score == null) return null;

  const numScore = typeof score === 'string' ? parseFloat(score) : score;
  if (isNaN(numScore)) return null;

  const { bg, color, label } = getColor(numScore);
  const sizeStyle = SIZE_STYLES[size] || SIZE_STYLES.sm;

  return (
    <span
      className="badge"
      title={`${label} (${(numScore * 100).toFixed(0)}%)`}
      style={{
        background: bg,
        color: color,
        borderRadius: '9999px',
        whiteSpace: 'nowrap',
        cursor: 'default',
        ...sizeStyle,
      }}
    >
      {(numScore * 100).toFixed(0)}%
    </span>
  );
}
