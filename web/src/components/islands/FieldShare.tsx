import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const COLORS = ['var(--cat-1)', 'var(--cat-2)', 'var(--cat-3)', 'var(--cat-4)', 'var(--cat-5)', 'var(--cat-6)', 'var(--cat-7)'];
const axis = { stroke: 'var(--text-muted)', fontSize: 12 };

/* Papers per year by area, as shares of the year's total (or raw counts). */
export default function FieldShare({ rows, areas }: { rows: Record<string, number>[]; areas: string[] }) {
  const [mode, setMode] = useState<'share' | 'papers'>('share');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const shown = areas.filter((a) => !hidden.has(a));
  const color = (a: string) => COLORS[areas.indexOf(a) % COLORS.length];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {areas.map((a) => (
          <button
            key={a}
            type="button"
            aria-pressed={!hidden.has(a)}
            onClick={() => setHidden((h) => { const n = new Set(h); n.has(a) ? n.delete(a) : n.add(a); return n; })}
            className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border border-border px-2.5 text-[0.78rem] font-semibold text-muted transition hover:border-border-strong aria-pressed:text-fg"
            title={hidden.has(a) ? `Show ${a}` : `Hide ${a}`}
          >
            <span className="size-2.5 rounded-sm" style={{ background: hidden.has(a) ? 'var(--border-strong)' : color(a) }} />
            {a}
          </button>
        ))}
        <div className="ml-auto inline-flex rounded-full border border-border p-0.5" role="group" aria-label="Show">
          {(['share', 'papers'] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m}
              className="h-6 cursor-pointer rounded-full px-2.5 text-[0.75rem] font-semibold text-muted aria-pressed:bg-surface-2 aria-pressed:text-fg">
              {m === 'share' ? 'Share' : 'Papers'}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={rows} stackOffset={mode === 'share' ? 'expand' : 'none'} margin={{ left: -8, right: 8, top: 8 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="year" tick={axis} stroke="var(--border)" minTickGap={20} />
          <YAxis
            tick={axis}
            stroke="var(--border)"
            tickFormatter={(v: number) => (mode === 'share' ? `${Math.round(v * 100)}%` : v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`)}
          />
          <Tooltip
            contentStyle={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-primary)' }}
            labelStyle={{ color: 'var(--text-secondary)', fontWeight: 600 }}
            formatter={(v, name, item) => {
              const row = (item?.payload || {}) as Record<string, number>;
              const n = Number(v);
              const total = shown.reduce((sum, a) => sum + (row[a] || 0), 0) || 1;
              return [`${n.toLocaleString()} papers (${Math.round((n / total) * 100)}%)`, String(name)];
            }}
          />
          {shown.map((a) => (
            <Area key={a} type="monotone" dataKey={a} stackId="1" stroke={color(a)} fill={color(a)} fillOpacity={0.75} isAnimationActive={false} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
