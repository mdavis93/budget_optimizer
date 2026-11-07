import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Cell,
  ReferenceLine,
} from 'recharts';
import { AVOIDED_BAR_OPACITY } from '../debts/accelerationChart';
import { CHART_COLORS, formatTooltipDollarPair } from './chartTheme';

export interface DebtAmortizationChartDatum {
  name: string;
  principal: number;
  interest: number;
  payment: number;
  avoided?: boolean;
}

interface DebtAmortizationChartProps {
  data: DebtAmortizationChartDatum[];
}

export default function DebtAmortizationChart({ data }: DebtAmortizationChartProps) {
  const cutoffName = [...data].reverse().find((row) => !row.avoided)?.name;
  const hasAvoided = data.some((row) => row.avoided);

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
          formatter={(value, name, item) => {
            const [formatted, label] = formatTooltipDollarPair(value, String(name));
            const avoided = Boolean(
              (item?.payload as DebtAmortizationChartDatum | undefined)?.avoided
            );
            return [formatted, avoided ? `${label} (Avoided by acceleration)` : label];
          }}
        />
        <Legend
          wrapperStyle={{ paddingTop: '10px' }}
          formatter={(value) => <span className="text-(--color-text-secondary)">{value}</span>}
        />
        {hasAvoided && cutoffName != null && (
          <ReferenceLine
            x={cutoffName}
            stroke="var(--color-text-muted)"
            strokeDasharray="4 4"
            strokeOpacity={0.7}
          />
        )}
        <Bar
          dataKey="principal"
          stackId="a"
          fill={CHART_COLORS.principal}
          name="Principal"
          radius={[0, 0, 0, 0]}
        >
          {data.map((entry, index) => (
            <Cell
              key={`principal-${entry.name}-${index}`}
              fill={CHART_COLORS.principal}
              fillOpacity={entry.avoided ? AVOIDED_BAR_OPACITY : 1}
            />
          ))}
        </Bar>
        <Bar
          dataKey="interest"
          stackId="a"
          fill={CHART_COLORS.interest}
          name="Interest"
          radius={[4, 4, 0, 0]}
        >
          {data.map((entry, index) => (
            <Cell
              key={`interest-${entry.name}-${index}`}
              fill={CHART_COLORS.interest}
              fillOpacity={entry.avoided ? AVOIDED_BAR_OPACITY : 1}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
