"use client";

interface FreshnessBadgeProps {
  bootstrappedAt: string | null;
  onRefresh?: () => void;
}

export function FreshnessBadge({ bootstrappedAt, onRefresh }: FreshnessBadgeProps) {
  if (!bootstrappedAt) return null;
  const mins = Math.floor((Date.now() - new Date(bootstrappedAt).getTime()) / 60000);
  const label = mins < 2 ? 'Live' : mins < 60 ? `${mins}m ago` : `Stale — ${Math.floor(mins / 60)}h ago`;
  const color = mins < 2 ? '#10b981' : mins < 60 ? '#888' : '#f59e0b';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '10px', color }}>
      <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: color, display: 'inline-block' }} />
      {label}
      {onRefresh && mins >= 2 && (
        <button onClick={onRefresh} style={{ marginLeft: '4px', background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '10px', padding: '0 2px' }}>↻</button>
      )}
    </span>
  );
}
