import React, { useMemo, useState } from 'react';
import { Check, PackageSearch, Star } from 'lucide-react';
import { AppModal } from '../../components/AppModal';
import { useT } from '../i18n';
import { displayName, matchesSearch, secondaryName, unitLabel } from '../labels';
import { formatQty, formatRupees, type Milli } from '../money';
import type { ShopCategory, ShopItem } from '../types';
import { ActionButton, SearchBox } from './ui';

interface ItemPickerSheetProps {
  open: boolean;
  onClose: () => void;
  items: ShopItem[];
  categories: ShopCategory[];
  /** item id -> times sold recently */
  saleCounts: Record<string, number>;
  /** item id -> quantity already on the bill */
  onBill: Record<string, Milli>;
  onPick: (item: ShopItem) => void;
}

const ALL = '__all__';
const FREQUENT = '__frequent__';

/**
 * Bottom sheet for adding items to a bill: search, category chips, the usual
 * items first. Tapping an item adds it; tapping again adds one more.
 */
export function ItemPickerSheet({ open, onClose, items, categories, saleCounts, onBill, onPick }: ItemPickerSheetProps) {
  const { t, language } = useT();
  const [search, setSearch] = useState('');
  const [chip, setChip] = useState(ALL);

  const activeCategories = categories.filter((c) => c.isActive);
  const hiddenCategoryIds = new Set(categories.filter((c) => !c.isActive).map((c) => c.id));
  const hasFrequent = Object.keys(saleCounts).length > 0;

  const shown = useMemo(() => {
    const sellable = items.filter((item) => item.isActive && !(item.categoryId && hiddenCategoryIds.has(item.categoryId)));
    const searching = search.trim().length > 0;
    const list = sellable.filter((item) => {
      if (searching) return matchesSearch(item, search);
      if (chip === FREQUENT) return (saleCounts[item.id] ?? 0) > 0;
      if (chip !== ALL) return item.categoryId === chip;
      return true;
    });
    // Usual items first, then A to Z.
    return list.sort(
      (a, b) => (saleCounts[b.id] ?? 0) - (saleCounts[a.id] ?? 0) || displayName(a, language).localeCompare(displayName(b, language))
    );
    // hiddenCategoryIds is derived from categories
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, categories, saleCounts, search, chip, language]);

  const chips = [
    { id: ALL, label: t('allItems') },
    ...(hasFrequent ? [{ id: FREQUENT, label: t('oftenSold') }] : []),
    ...activeCategories.map((c) => ({ id: c.id, label: displayName(c, language) })),
  ];

  return (
    <AppModal open={open} onClose={onClose} title={t('addItems')} description={t('pickerHint')} icon={<PackageSearch className="h-5 w-5" />}>
      <div className="space-y-3">
        <SearchBox value={search} onChange={setSearch} placeholder={t('searchItems')} />

        {!search.trim() && chips.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {chips.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setChip(c.id)}
                className={`shrink-0 min-h-12 px-4 flex items-center gap-1.5 rounded-full border text-sm font-bold cursor-pointer whitespace-nowrap transition-colors ${
                  chip === c.id ? 'bg-[#0F172A] border-[#0F172A] text-white' : 'bg-white border-slate-200 text-slate-700'
                }`}
              >
                {c.id === FREQUENT && <Star className="h-4 w-4" />}
                {c.label}
              </button>
            ))}
          </div>
        )}

        {items.length === 0 ? (
          <p className="px-4 py-8 text-center text-base text-slate-500">{t('noItemsToPick')}</p>
        ) : shown.length === 0 ? (
          <p className="px-4 py-8 text-center text-base text-slate-500">{t('noMatch')}</p>
        ) : (
          <ul className="space-y-2">
            {shown.map((item) => {
              const qty = onBill[item.id] ?? 0;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onPick(item)}
                    className={`w-full min-h-14 flex items-center gap-3 rounded-xl border px-4 py-2.5 text-left cursor-pointer transition-colors active:scale-[0.99] ${
                      qty > 0 ? 'bg-emerald-50 border-emerald-300' : 'bg-white border-slate-200 hover:border-amber-300'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-bold text-slate-900 truncate">{displayName(item, language)}</p>
                      <p className="text-sm text-slate-500 truncate">
                        {[secondaryName(item, language), unitLabel(t, item.unit)].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-base font-bold text-slate-900 tabular-nums">{formatRupees(item.saleRate)}</p>
                      {qty > 0 && (
                        <p className="text-sm font-bold text-emerald-700 flex items-center justify-end gap-1">
                          <Check className="h-4 w-4" />
                          {t('onBill', { n: formatQty(qty) })}
                        </p>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="sticky bottom-0 pt-2 bg-white">
          <ActionButton icon={<Check className="h-5 w-5" />} label={t('pickerDone')} onClick={onClose} size="lg" className="w-full" />
        </div>
      </div>
    </AppModal>
  );
}
