import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { CHART_COLORS, formatTooltipCurrencyPair, formatTooltipCurrencyValue } from './chartTheme';

interface IncomeExpensesChartProps {
  data: Array<{ month: string; income: number; expenses: number }>;
  formatCurrency: (amount: number) => string;
}

export function IncomeExpensesChart({ data, formatCurrency }: IncomeExpensesChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <XAxis
          dataKey="month"
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: 'var(--color-border)' }}
        />
        <YAxis
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => `$${value}`}
        />
        <Tooltip
          formatter={(value, name) =>
            formatTooltipCurrencyPair(
              value,
              formatCurrency,
              name === 'income' ? 'Income' : 'Expenses'
            )
          }
          contentStyle={{
            backgroundColor: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
          }}
        />
        <Legend />
        <Bar dataKey="income" name="Income" fill={CHART_COLORS.success} radius={[4, 4, 0, 0]} />
        <Bar dataKey="expenses" name="Expenses" fill={CHART_COLORS.danger} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

interface CategoryPieChartProps {
  data: Array<{ name: string; value: number; color: string }>;
  formatCurrency: (amount: number) => string;
}

export function CategoryPieChart({ data, formatCurrency }: CategoryPieChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={50}
          outerRadius={80}
          paddingAngle={2}
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value) => formatTooltipCurrencyValue(value, formatCurrency)}
          contentStyle={{
            backgroundColor: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
          }}
          labelStyle={{ color: 'var(--color-text-primary)' }}
          itemStyle={{ color: 'var(--color-text-primary)' }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

interface SavingsAreaChartProps {
  data: Array<{ month: string; total: number; principal: number; interest: number }>;
  formatCurrency: (amount: number) => string;
}

function SavingsTooltip({
  active,
  payload,
  label,
  formatCurrency,
}: {
  active?: boolean;
  payload?: Array<{ payload: { total: number; principal: number; interest: number } }>;
  label?: string;
  formatCurrency: (amount: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="bg-(--color-bg-secondary) border border-(--color-border) rounded-lg p-3 shadow-lg">
      <p className="text-sm font-medium mb-1">{label}</p>
      <p className="text-lg font-semibold">{formatCurrency(point.total)}</p>
      <hr className="my-2 border-(--color-border)" />
      <div className="text-xs text-(--color-text-muted) space-y-1">
        <p>Principal: {formatCurrency(point.principal)}</p>
        <p>Interest: {formatCurrency(point.interest)}</p>
      </div>
    </div>
  );
}

export function SavingsAreaChart({ data, formatCurrency }: SavingsAreaChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <XAxis
          dataKey="month"
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: 'var(--color-border)' }}
        />
        <YAxis
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => `$${value.toLocaleString()}`}
        />
        <Tooltip content={<SavingsTooltip formatCurrency={formatCurrency} />} />
        <Area
          type="monotone"
          dataKey="total"
          name="Total Savings"
          stroke={CHART_COLORS.primary}
          fill={CHART_COLORS.primary}
          fillOpacity={0.3}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
