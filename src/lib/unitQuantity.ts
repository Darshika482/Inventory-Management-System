export function parseUnitSize(unit: string): number | null {
  const match = unit.trim().match(/^(\d+(?:\.\d+)?)/);
  if (!match) return null;

  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function calculateTotalQuantity(unit: string, count: number): number | null {
  const size = parseUnitSize(unit);
  if (size === null) return null;
  return size * count;
}

export function formatTotalQuantity(unit: string, count: number): string {
  const total = calculateTotalQuantity(unit, count);
  return total !== null ? total.toLocaleString() : count.toLocaleString();
}

export function formatStockHint(unit: string, count: number): string {
  if (parseUnitSize(unit) !== null) {
    return `${count.toLocaleString()} left`;
  }
  return `${count.toLocaleString()} ${unit} left`;
}

export function formatQuantityCalculation(unit: string, count: number): string | null {
  const size = parseUnitSize(unit);
  if (size === null) return null;

  const total = size * count;
  return `${size.toLocaleString()} × ${count.toLocaleString()} = ${total.toLocaleString()}`;
}
