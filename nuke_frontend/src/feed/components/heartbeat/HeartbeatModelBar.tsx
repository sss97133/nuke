import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const PALETTE = ['var(--text)', '#666', '#888', '#aaa', '#ccc'];

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

export function HeartbeatModelBar({ models }: { models: ModelEntry[] }) {
  if (!models.length) return null;

  return (
    <div style={{ width: '100%', height: 140 }}>
      <div style={{
        fontFamily: 'Arial, sans-serif',
        fontSize: '8px',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.3px',
        color: 'var(--text-disabled)',
        marginBottom: '6px',
      }}>
        TOP MODELS
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <BarChart
          data={models}
          layout="vertical"
          margin={{ top: 0, right: 60, bottom: 0, left: 0 }}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="model"
            width={80}
            tick={{
              fontFamily: 'Arial, sans-serif',
              fontSize: 9,
              fontWeight: 700,
              fill: 'var(--text)',
            }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value: number, _name: string, item: any) => [
              `${value} listings — ${formatPrice(item.payload.avg_price)} avg`,
              '',
            ]}
            contentStyle={{
              fontFamily: 'Arial, sans-serif',
              fontSize: 10,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
            }}
          />
          <Bar dataKey="count" radius={0} barSize={14}>
            {models.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
