import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, PackageSearch, Plus, Star, Trash2 } from 'lucide-react';
import { AppModal } from '../../components/AppModal';
import { useT } from '../i18n';
import { displayName, matchesSearch, secondaryName, unitLabel } from '../labels';
import { formatRupees, type Paise } from '../money';
import type { ShopCategory, ShopItem } from '../types';
import { ActionButton, SearchBox } from './ui';

/** What the picker needs to show and edit an item that is already on the bill. */
export interface PickerLine {
  qtyText: string;
  rateText: string;
  /** qty × rate for this line */
  amount: Paise;
  qtyValid: boolean;
  rateValid: boolean;
  /** Rate differs from the item's saved rate */
  rateChanged: boolean;
}

interface ItemPickerSheetProps {
  open: boolean;
  onClose: () => void;
  items: ShopItem[];
  categories: ShopCategory[];
  /** item id -> times sold recently */
  saleCounts: Record<string, number>;
  /** item id -> its line on the bill */
  lines: Record<string, PickerLine>;
  billTotal: Paise;
  onPick: (item: ShopItem) => void;
  onChangeLine: (itemId: string, patch: { qtyText?: string; rateText?: string }) => void;
  onRemove: (itemId: string) => void;
}

const ALL = '__all__';
const FREQUENT = '__frequent__';

/**
 * Bottom sheet for adding items to a bill: search, category chips, the usual
 * items first. Tapping an item adds it; once on the bill its quantity and rate
 * can be changed right here.
 */
export function ItemPickerSheet({
  open,
  onClose,
  items,
  categories,
  saleCounts,
  lines,
  billTotal,
  onPick,
  onChangeLine,
  onRemove,
}: ItemPickerSheetProps) {
  const { t, language } = useT();
  const [search, setSearch] = useState('');
  const [chip, setChip] = useState(ALL);
  const bodyRef = useRef<HTMLDivElement>(null);

  const activeCategories = categories.filter((c) => c.isActive);
  const hasFrequent = Object.keys(saleCounts).length > 0;
  const lineCount = Object.keys(lines).length;

  const shown = useMemo(() => {
    const hiddenCategoryIds = new Set(categories.filter((c) => !c.isActive).map((c) => c.id));
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
      (a, b) =>
        (saleCounts[b.id] ?? 0) - (saleCounts[a.id] ?? 0) ||
        displayName(a, language).localeCompare(displayName(b, language))
    );
  }, [items, categories, saleCounts, search, chip, language]);

  const chips = [
    { id: ALL, label: t('allItems') },
    ...(hasFrequent ? [{ id: FREQUENT, label: t('oftenSold') }] : []),
    ...activeCategories.map((c) => ({ id: c.id, label: displayName(c, language) })),
  ];

  // Each new search starts at the top, so the best match sits right under the search box.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [search, chip]);

  return (
    <AppModal
      open={open}
      onClose={onClose}
      title={t('addItems')}
      icon={<PackageSearch className="h-5 w-5" />}
      fullHeight
      bodyRef={bodyRef}
      pinned={
        <div className="space-y-3">
          <SearchBox value={search} onChange={setSearch} placeholder={t('searchItems')} />

          {!search.trim() && chips.length > 1 && (
            <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {chips.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setChip(c.id)}
                  className={`shrink-0 min-h-12 px-4 flex items-center gap-1.5 rounded-full text-sm font-semibold cursor-pointer whitespace-nowrap transition-colors ${
                    chip === c.id ? 'bg-[#0F172A] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {c.id === FREQUENT && <Star className="h-4 w-4" />}
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>
      }
    >
      <div className="space-y-3">
        {items.length === 0 ? (
          <p className="px-4 py-8 text-center text-base text-slate-500">{t('noItemsToPick')}</p>
        ) : shown.length === 0 ? (
          <p className="px-4 py-8 text-center text-base text-slate-500">{t('noMatch')}</p>
        ) : (
          <ul className="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
            {shown.map((item) => (
              <PickerRow
                key={item.id}
                item={item}
                line={lines[item.id]}
                onPick={() => onPick(item)}
                onChange={(patch) => onChangeLine(item.id, patch)}
                onRemove={() => onRemove(item.id)}
              />
            ))}
          </ul>
        )}

        <div className="sticky bottom-0 -mx-1 px-1 pt-2 bg-white">
          <ActionButton
            icon={<Check className="h-5 w-5" />}
            label={
              lineCount > 0
                ? `${t('pickerDone')} · ${lineCount === 1 ? t('oneItem') : t('itemsCount', { n: lineCount })} · ${formatRupees(billTotal)}`
                : t('pickerDone')
            }
            onClick={onClose}
            className="w-full"
          />
        </div>
      </div>
    </AppModal>
  );
}

interface PickerRowProps {
  item: ShopItem;
  line: PickerLine | undefined;
  onPick: () => void;
  onChange: (patch: { qtyText?: string; rateText?: string }) => void;
  onRemove: () => void;
}

function PickerRow({ item, line, onPick, onChange, onRemove }: PickerRowProps) {
  const { t, language } = useT();
  const subtitle = [secondaryName(item, language), unitLabel(t, item.unit)].filter(Boolean).join(' · ');

  // Not on the bill yet: the whole row is one big "add" button.
  if (!line) {
    return (
      <li>
        <button
          type="button"
          onClick={onPick}
          className="w-full min-h-14 flex items-center gap-3 px-3.5 py-2.5 text-left bg-white hover:bg-slate-50 cursor-pointer transition-colors"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold text-slate-900 truncate">{displayName(item, language)}</span>
            <span className="block text-sm text-slate-500 truncate">{subtitle}</span>
          </span>
          <span className="shrink-0 text-base font-semibold text-slate-700 tabular-nums">{formatRupees(item.saleRate)}</span>
          <span className="shrink-0 flex h-9 w-9 items-center justify-center rounded-full bg-amber-500 text-[#0F172A]">
            <Plus className="h-5 w-5" />
          </span>
        </button>
      </li>
    );
  }

  // On the bill: quantity and rate can be changed right here.
  return (
    <li className="bg-emerald-50/60 px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 truncate leading-tight">{displayName(item, language)}</p>
          <p className="text-xs text-slate-500 truncate">{subtitle}</p>
        </div>
        <p className="shrink-0 text-sm font-bold text-emerald-800 tabular-nums">{formatRupees(line.amount, true)}</p>
      </div>
      {/* qty  ×  ₹ rate, with delete at the right end */}
      <div className="flex items-center gap-1.5">
        <input
          inputMode="decimal"
          value={line.qtyText}
          onChange={(e) => onChange({ qtyText: e.target.value })}
          onFocus={(e) => e.target.select()}
          aria-label={t('qty')}
          className={`h-8 w-14 rounded-lg border bg-white text-center text-sm font-bold text-slate-900 focus:outline-none focus:border-amber-500 ${
            line.qtyValid ? 'border-slate-200' : 'border-red-300 bg-red-50'
          }`}
        />
        <span className="text-xs text-slate-400" aria-hidden="true">
          ×
        </span>
        <div
          className={`flex h-8 w-24 items-center rounded-lg border bg-white focus-within:border-amber-500 ${
            !line.rateValid ? 'border-red-300 bg-red-50' : line.rateChanged ? 'border-amber-400' : 'border-slate-200'
          }`}
        >
          <span className="pl-2 text-xs font-semibold text-slate-400" aria-hidden="true">
            ₹
          </span>
          <input
            inputMode="decimal"
            value={line.rateText}
            onChange={(e) => onChange({ rateText: e.target.value })}
            onFocus={(e) => e.target.select()}
            aria-label={t('rate')}
            className="h-full min-w-0 flex-1 bg-transparent px-1 text-sm font-bold text-slate-900 focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('remove')}
          title={t('remove')}
          className="ml-auto h-8 w-8 flex items-center justify-center rounded-lg text-red-600 hover:bg-red-50 cursor-pointer transition-colors"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}
