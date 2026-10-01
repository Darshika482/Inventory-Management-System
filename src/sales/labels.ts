import { UNITS } from './ids';
import type { TranslationKey } from './i18n';
import type { ShopCategory, ShopItem } from './types';
import type { Language } from './types';

type T = (key: TranslationKey, vars?: Record<string, string | number>) => string;

/** "pcs" -> "Piece" / "पीस"; units typed by hand are shown as they are. */
export function unitLabel(t: T, unit: string): string {
  return (UNITS as readonly string[]).includes(unit) ? t(`unit_${unit}` as TranslationKey) : unit;
}

/** Item or category name in the chosen language, falling back to English. */
export function displayName(entry: ShopItem | ShopCategory, language: Language): string {
  return language === 'hi' && entry.nameHi.trim() ? entry.nameHi : entry.name;
}

/** The other-language name, shown small under the main one. */
export function secondaryName(entry: ShopItem | ShopCategory, language: Language): string {
  if (!entry.nameHi.trim()) return '';
  return language === 'hi' ? entry.name : entry.nameHi;
}

/** Matches typed text anywhere in the English or Hindi name. */
export function matchesSearch(entry: ShopItem | ShopCategory, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return entry.name.toLowerCase().includes(q) || entry.nameHi.toLowerCase().includes(q);
}
