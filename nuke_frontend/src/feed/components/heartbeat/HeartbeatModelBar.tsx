import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
import { useState } from 'react';

interface ModelEntry {
  model: string;
  count: number;
  avg_price: number;
}

function formatPrice(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
}

// Grayscale palette — darker = more listings
function shade(index: number, total: number): string {
  const lightness = Math.round(20 + (index / Math.max(total - 1, 1)) * 55);
  return `hsl(0, 0%, ${lightness}%)`;
}

function TreemapCell(props: any) {
  const { x, y, width, height, model, count, avg_price, index, colors } = props;
  if (width < 2 || height < 2) return null;
  if (count == null) return null;

  const showLabel = width > 40 && height > 28;
  const showCount = width > 55 && height > 40;
  const fill = colors?.[index] ?? '#888';
  const textColor = index < 3 ? '#fff' : '#222';

  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} stroke="var(--bg)" strokeWidth={2} />
      {showLabel && (
        <text
          x={x + 4} y={y + 12}
          fill={textColor}
          style={{ fontFamily: 'Arial, sans-serif', fontSize: 9, fontWeight: 700, textTransform: 'uppercase' }}
        >
          {model}
        </text>
      )}
      {showCount && (
        <text
          x={x + 4} y={y + 24}
          fill={textColor}
          style={{ fontFamily: "'Courier New', monospace", fontSize: 8, opacity: 0.8 }}
        >
          {count.toLocaleString()} — {formatPrice(avg_price)}
        </text>
      )}
    </g>
  );
}

export function HeartbeatModelBar({ models, onModelClick }: {
  models: ModelEntry[];
  onModelClick?: (model: string) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  if (!models.length) return null;

  const colors = models.map((_, i) => shade(i, models.length));
  const data = models.map((m, i) => ({ ...m, name: m.model, size: m.count, colors, index: i }));

  return (
    <div style={{ width: '100%' }}>
      <div style={{
        fontFamily: 'Arial, sans-serif',
        fontSize: '8px',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.3px',
        color: 'var(--text-disabled)',
        marginBottom: '4px',
      }}>
        MODEL DISTRIBUTION ({models.length})
      </div>
      <div
        style={{ width: '100%', height: 160, cursor: onModelClick ? 'pointer' : 'default' }}
        onClick={(e) => {
          if (!onModelClick || !hovered) return;
          onModelClick(hovered);
        }}
      >
        <ResponsiveContainer width="100%" height={160}>
          <Treemap
            data={data}
            dataKey="size"
            stroke="var(--bg)"
            content={<TreemapCell colors={colors} />}
            isAnimationActive={false}
            onMouseEnter={(node: any) => setHovered(node?.model ?? null)}
            onMouseLeave={() => setHovered(null)}
          >
            <Tooltip
              content={({ payload }) => {
                const d = payload?.[0]?.payload;
                if (!d) return null;
                return (
                  <div style={{
                    fontFamily: 'Arial, sans-serif',
                    fontSize: 10,
                    padding: '4px 8px',
                    border: '1px solid var(--border)',
                    background: 'var(--surface)',
                    color: 'var(--text)',
                  }}>
                    <strong>{d.model}</strong> — {d.count.toLocaleString()} listings — {formatPrice(d.avg_price)} avg
                  </div>
                );
              }}
            />
          </Treemap>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
