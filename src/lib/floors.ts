export type Floor = 'First Floor' | 'Second Floor';

export const FLOOR_OPTIONS: Floor[] = ['First Floor', 'Second Floor'];

export function createCategoryId(name: string, floor: Floor): string {
  const nameSlug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const floorSlug = floor === 'First Floor' ? 'first-floor' : 'second-floor';
  return `${nameSlug}-${floorSlug}`;
}

export function getFloorBadgeClass(floor: Floor): string {
  return floor === 'First Floor'
    ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
    : 'bg-violet-50 text-violet-700 border-violet-200';
}
