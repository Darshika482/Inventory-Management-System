import { Category, Floor } from '../types';

export type GroupedCategory = {
  key: string;
  name: string;
  floor: Floor;
  variants: Category[];
};

export function getGroupKey(name: string, floor: Floor): string {
  return `${name.toLowerCase().trim()}|${floor}`;
}

export function groupCategoriesByNameAndFloor(categories: Category[]): GroupedCategory[] {
  const map = new Map<string, GroupedCategory>();

  for (const cat of categories) {
    const key = getGroupKey(cat.name, cat.floor);
    const existing = map.get(key);
    if (existing) {
      existing.variants.push(cat);
    } else {
      map.set(key, { key, name: cat.name, floor: cat.floor, variants: [cat] });
    }
  }

  for (const group of map.values()) {
    group.variants.sort((a, b) => a.unit.localeCompare(b.unit));
  }

  return Array.from(map.values());
}

export function sortGroupedCategories(
  groups: GroupedCategory[],
  sortField: 'name' | 'stock' | 'percentage',
  direction: 'asc' | 'desc'
): GroupedCategory[] {
  const multiplier = direction === 'asc' ? 1 : -1;

  return [...groups].sort((a, b) => {
    if (sortField === 'name') {
      return a.name.localeCompare(b.name) * multiplier;
    }
    if (sortField === 'stock') {
      const stockA = a.variants.reduce((sum, v) => sum + v.currentQuantity, 0);
      const stockB = b.variants.reduce((sum, v) => sum + v.currentQuantity, 0);
      return (stockA - stockB) * multiplier;
    }
    if (sortField === 'percentage') {
      const minPercent = (group: GroupedCategory) =>
        Math.min(
          ...group.variants.map((v) => (v.initialStock > 0 ? v.currentQuantity / v.initialStock : 1))
        );
      return (minPercent(a) - minPercent(b)) * multiplier;
    }
    return 0;
  });
}

export function getWorstVariant(group: GroupedCategory): Category {
  return group.variants.reduce((worst, variant) => {
    const worstRatio = worst.initialStock > 0 ? worst.currentQuantity / worst.initialStock : 1;
    const variantRatio = variant.initialStock > 0 ? variant.currentQuantity / variant.initialStock : 1;
    return variantRatio < worstRatio ? variant : worst;
  });
}
