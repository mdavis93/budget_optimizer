import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { formatTooltipCurrencyPair } from './chartTheme';

interface BalanceProjectionChartProps {
  data: Array<{ date: string; balance: number }>;
  formatCurrency: (amount: number) => string;
}

export default function BalanceProjectionChart({ data, formatCurrency }: BalanceProjectionChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <XAxis
          dataKey="date"
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: 'var(--color-border)' }}
        />
        <YAxis
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => `$${value}`}
        />
        <Tooltip
          formatter={(value) => formatTooltipCurrencyPair(value, formatCurrency, 'Balance')}
          contentStyle={{
            backgroundColor: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
          }}
        />
        <ReferenceLine y={0} stroke="var(--color-border)" strokeDasharray="3 3" />
        <Line type="monotone" dataKey="balance" stroke="#3b82f6" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
