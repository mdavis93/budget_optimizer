import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { CHART_COLORS } from './chartTheme';

interface DebtAmortizationChartProps {
  data: Array<{ name: string; principal: number; interest: number; payment: number }>;
}

export default function DebtAmortizationChart({ data }: DebtAmortizationChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
        <XAxis
          dataKey="name"
          tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: 'var(--color-border)' }}
        />
        <YAxis
          tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => `$${value}`}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
          }}
          labelStyle={{ color: 'var(--color-text-primary)' }}
          formatter={(value: number, name: string) => [
            `$${value.toFixed(2)}`,
            name.charAt(0).toUpperCase() + name.slice(1),
          ]}
        />
        <Legend
          wrapperStyle={{ paddingTop: '10px' }}
          formatter={(value) => <span className="text-[var(--color-text-secondary)]">{value}</span>}
        />
        <Bar dataKey="principal" stackId="a" fill={CHART_COLORS.principal} name="Principal" radius={[0, 0, 0, 0]} />
        <Bar dataKey="interest" stackId="a" fill={CHART_COLORS.interest} name="Interest" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
