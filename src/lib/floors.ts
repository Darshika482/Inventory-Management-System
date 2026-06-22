export type Floor = 'First Floor' | 'Second Floor';

export const FLOOR_OPTIONS: Floor[] = ['First Floor', 'Second Floor'];

function slugify(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

export function createCategoryId(name: string, floor: Floor, unit: string): string {
  const nameSlug = slugify(name);
  const floorSlug = floor === 'First Floor' ? 'first-floor' : 'second-floor';
  const unitSlug = slugify(unit || 'pieces');
  return `${nameSlug}-${floorSlug}-${unitSlug}`;
}

export function getFloorShortLabel(floor: Floor): string {
  return floor === 'First Floor' ? '1st floor' : '2nd floor';
}

export function getFloorBadgeClass(floor: Floor): string {
  return floor === 'First Floor'
    ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
    : 'bg-violet-50 text-violet-700 border-violet-200';
}
