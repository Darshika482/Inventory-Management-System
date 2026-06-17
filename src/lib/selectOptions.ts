import { Category, User } from '../types';
import { FLOOR_OPTIONS, getFloorShortLabel } from './floors';

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

export function categoryToSelectOption(category: Category): PremiumSelectOption {
  return {
    value: category.id,
    label: category.name,
    description: getFloorShortLabel(category.floor),
    hint: `${category.currentQuantity.toLocaleString()} ${category.unit} left`,
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
