import { Category, User } from '../types';
import { FLOOR_OPTIONS, getFloorShortLabel } from './floors';
import { formatTotalQuantity, formatStockHint } from './unitQuantity';

export type PremiumSelectOption = {
  value: string;
  label: string;
  description?: string;
  hint?: string;
  icon?: 'item' | 'user' | 'floor';
};

export const FLOOR_SELECT_OPTIONS: PremiumSelectOption[] = FLOOR_OPTIONS.map((floor) => ({
  value: floor,
  label: getFloorShortLabel(floor),
  description: floor === 'First Floor' ? 'Items stored on the ground floor' : 'Items stored on the upper floor',
  icon: 'floor' as const,
}));

export function categoryToSelectOption(
  category: Category,
  allCategories?: Category[]
): PremiumSelectOption {
  const hasSameNameOnFloor = allCategories?.some(
    (c) =>
      c.id !== category.id &&
      c.name.toLowerCase() === category.name.toLowerCase() &&
      c.floor === category.floor
  );

  return {
    value: category.id,
    label: hasSameNameOnFloor ? `${category.name} · ${category.unit}` : category.name,
    description: hasSameNameOnFloor
      ? `${getFloorShortLabel(category.floor)} · ${category.unit}`
      : getFloorShortLabel(category.floor),
    hint: `${formatTotalQuantity(category.unit, category.currentQuantity)} · ${formatStockHint(category.unit, category.currentQuantity)}`,
    icon: 'item',
  };
}

export function staffToSelectOption(member: User): PremiumSelectOption {
  return {
    value: member.username,
    label: member.username,
    description: 'Staff member',
    icon: 'user',
  };
}
