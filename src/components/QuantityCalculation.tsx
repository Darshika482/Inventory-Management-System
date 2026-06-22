import { formatTotalQuantity } from '../lib/unitQuantity';

type QuantityCalculationProps = {
  unit: string;
  count: number;
  className?: string;
};

export function QuantityCalculation({
  unit,
  count,
  className = 'font-extrabold text-sm tracking-tight tabular-nums',
}: QuantityCalculationProps) {
  return <span className={className}>{formatTotalQuantity(unit, count)}</span>;
}
