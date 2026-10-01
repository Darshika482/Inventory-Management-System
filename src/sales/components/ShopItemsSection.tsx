import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  FolderPlus,
  Layers,
  Package,
  Pencil,
  Plus,
  ShieldAlert,
  Tag,
  X,
} from 'lucide-react';
import type { User } from '../../types';
import { AppModal } from '../../components/AppModal';
import { FormError, FormInput } from '../../components/FormInput';
import { describeDbError, type FriendlyError } from '../../lib/dbErrors';
import {
  fetchShopCategories,
  fetchShopItems,
  insertShopCategory,
  insertShopItem,
  saveCategoryOrder,
  updateShopCategory,
  updateShopItem,
} from '../db';
import { GST_RATES } from '../gst';
import { useT } from '../i18n';
import { newId, UNITS } from '../ids';
import { displayName, matchesSearch, secondaryName, unitLabel } from '../labels';
import { formatRupees, paiseToInput, parsePaise } from '../money';
import type { ShopCategory, ShopItem } from '../types';
import {
  ActionButton,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  PageShell,
  PickerField,
  SearchBox,
  Segmented,
  ToggleRow,
} from './ui';

interface ShopItemsSectionProps {
  currentUser: User;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const NO_CATEGORY = '__none__';

export function ShopItemsSection({ currentUser, showToast }: ShopItemsSectionProps) {
  const { t, language } = useT();
  const isOwner = currentUser.role === 'Admin';
  const [categories, setCategories] = useState<ShopCategory[]>([]);
  const [items, setItems] = useState<ShopItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<FriendlyError | null>(null);
  const [search, setSearch] = useState('');
  const [reordering, setReordering] = useState(false);
  const [editingItem, setEditingItem] = useState<ShopItem | 'new' | null>(null);
  const [editingCategory, setEditingCategory] = useState<ShopCategory | 'new' | null>(null);

  const load = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [categoryData, itemData] = await Promise.all([fetchShopCategories(), fetchShopItems()]);
      setCategories(categoryData);
      setItems(itemData);
    } catch (err) {
      setLoadError(describeDbError(err, 'Items could not be loaded'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const groups = useMemo(() => {
    const visible = items.filter((item) => matchesSearch(item, search));
    const known = new Set(categories.map((c) => c.id));
    const result = categories.map((category) => ({
      key: category.id,
      category,
      items: visible.filter((item) => item.categoryId === category.id),
    }));
    result.push({
      key: NO_CATEGORY,
      category: null as unknown as ShopCategory,
      items: visible.filter((item) => !item.categoryId || !known.has(item.categoryId)),
    });
    // While searching, hide groups with no match; otherwise show every category.
    return result.filter((group) => (search.trim() ? group.items.length > 0 : group.category || group.items.length > 0));
  }, [categories, items, search]);

  if (!isOwner) {
    return (
      <PageShell>
        <PageHeader title={t('itemsTitle')} icon={<Package className="h-5 w-5" />} />
        <EmptyState icon={<ShieldAlert className="h-10 w-10" />} title={t('ownerOnly')} />
      </PageShell>
    );
  }
  if (isLoading) return <LoadingState />;
  if (loadError) return <ErrorState error={loadError} onRetry={load} />;

  const moveCategory = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= categories.length) return;
    const next = categories.slice();
    [next[index], next[target]] = [next[target], next[index]];
    const renumbered = next.map((c, i) => ({ ...c, sortOrder: i }));
    setCategories(renumbered);
    try {
      await saveCategoryOrder(renumbered);
    } catch (err) {
      showToast(describeDbError(err, 'The new order could not be saved').message, 'error');
      void load();
    }
  };

  const handleItemSaved = (item: ShopItem, isNew: boolean) => {
    setItems((prev) =>
      (isNew ? [...prev, item] : prev.map((i) => (i.id === item.id ? item : i))).sort((a, b) =>
        a.name.localeCompare(b.name)
      )
    );
    setEditingItem(null);
    showToast(t('itemSaved', { name: item.name }), 'success');
  };

  const handleCategorySaved = (category: ShopCategory, isNew: boolean) => {
    setCategories((prev) => (isNew ? [...prev, category] : prev.map((c) => (c.id === category.id ? category : c))));
    setEditingCategory(null);
    showToast(t('categorySaved', { name: category.name }), 'success');
  };

  return (
    <PageShell>
      <PageHeader
        title={t('itemsTitle')}
        icon={<Package className="h-5 w-5" />}
        actions={
          <>
            <ActionButton
              tone="secondary"
              icon={<FolderPlus className="h-5 w-5" />}
              label={t('addCategory')}
              onClick={() => setEditingCategory('new')}
            />
            <ActionButton icon={<Plus className="h-5 w-5" />} label={t('addItem')} onClick={() => setEditingItem('new')} />
          </>
        }
      />

      <div className="flex flex-col @xl:flex-row gap-2">
        <div className="flex-1">
          <SearchBox value={search} onChange={setSearch} placeholder={t('searchItems')} />
        </div>
        {categories.length > 1 && (
          <ActionButton
            tone={reordering ? 'success' : 'secondary'}
            icon={reordering ? <Check className="h-5 w-5" /> : <ArrowUpDown className="h-5 w-5" />}
            label={reordering ? t('done') : t('reorderCategories')}
            onClick={() => {
              if (reordering) showToast(t('categoryOrderSaved'), 'success');
              setReordering((v) => !v);
              setSearch('');
            }}
          />
        )}
      </div>

      {items.length === 0 && categories.length === 0 ? (
        <EmptyState
          icon={<Package className="h-10 w-10" />}
          title={t('noItems')}
          hint={t('noItemsHint')}
          action={
            <ActionButton icon={<Plus className="h-5 w-5" />} label={t('addItem')} onClick={() => setEditingItem('new')} />
          }
        />
      ) : groups.length === 0 ? (
        <div className="p-8 text-center text-slate-500 text-base bg-white border border-slate-200 rounded-xl">
          {t('noMatch')}
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => {
            const category = group.key === NO_CATEGORY ? null : group.category;
            const index = category ? categories.findIndex((c) => c.id === category.id) : -1;
            return (
              <section key={group.key} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <header className="flex items-center gap-2 px-4 py-2 bg-slate-50 border-b border-slate-100 min-h-14">
                  <Layers className="h-5 w-5 text-amber-600 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-bold text-slate-900 truncate">
                      {category ? displayName(category, language) : t('noCategory')}
                      {category && !category.isActive && (
                        <span className="ml-2 align-middle px-2 py-0.5 text-xs font-bold rounded-full bg-slate-200 text-slate-600">
                          {t('hidden')}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {[category ? secondaryName(category, language) : '', t('itemsCount', { n: group.items.length })]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  {category && reordering && (
                    <>
                      <button
                        type="button"
                        onClick={() => moveCategory(index, -1)}
                        disabled={index === 0}
                        aria-label={t('moveUp')}
                        className="h-12 w-12 flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowUp className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveCategory(index, 1)}
                        disabled={index === categories.length - 1}
                        aria-label={t('moveDown')}
                        className="h-12 w-12 flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowDown className="h-5 w-5" />
                      </button>
                    </>
                  )}
                  {category && !reordering && (
                    <button
                      type="button"
                      onClick={() => setEditingCategory(category)}
                      className="min-h-12 flex items-center gap-1.5 px-3 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
                    >
                      <Pencil className="h-4 w-4" />
                      {t('edit')}
                    </button>
                  )}
                </header>

                {!reordering && (
                  <ul className="divide-y divide-slate-100">
                    {group.items.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => setEditingItem(item)}
                          className="w-full min-h-14 flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 cursor-pointer"
                        >
                          <div className="min-w-0 flex-1">
                            <p className={`text-base font-semibold truncate ${item.isActive ? 'text-slate-900' : 'text-slate-400'}`}>
                              {displayName(item, language)}
                              {!item.isActive && (
                                <span className="ml-2 align-middle px-2 py-0.5 text-xs font-bold rounded-full bg-slate-100 text-slate-500">
                                  {t('hidden')}
                                </span>
                              )}
                            </p>
                            <p className="text-sm text-slate-500 truncate">
                              {[secondaryName(item, language), unitLabel(t, item.unit), `GST ${item.gstRate}%`]
                                .filter(Boolean)
                                .join(' · ')}
                            </p>
                          </div>
                          <span className="shrink-0 text-lg font-bold text-slate-900 tabular-nums">
                            {formatRupees(item.saleRate)}
                          </span>
                          <Pencil className="h-4 w-4 text-slate-400 shrink-0" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      <ItemFormModal
        open={editingItem !== null}
        item={editingItem === 'new' ? null : editingItem}
        categories={categories}
        userId={currentUser.id}
        onClose={() => setEditingItem(null)}
        onSaved={handleItemSaved}
      />
      <CategoryFormModal
        open={editingCategory !== null}
        category={editingCategory === 'new' ? null : editingCategory}
        nextSortOrder={categories.length}
        onClose={() => setEditingCategory(null)}
        onSaved={handleCategorySaved}
      />
    </PageShell>
  );
}

// --- Item form ---

interface ItemFormModalProps {
  open: boolean;
  item: ShopItem | null;
  categories: ShopCategory[];
  userId: string;
  onClose: () => void;
  onSaved: (item: ShopItem, isNew: boolean) => void;
}

function ItemFormModal({ open, item, categories, userId, onClose, onSaved }: ItemFormModalProps) {
  const { t, language } = useT();
  const [name, setName] = useState('');
  const [nameHi, setNameHi] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [unit, setUnit] = useState('pcs');
  const [saleRate, setSaleRate] = useState('');
  const [purchaseRate, setPurchaseRate] = useState('');
  const [gstRate, setGstRate] = useState(0);
  const [hsn, setHsn] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [problem, setProblem] = useState<FriendlyError | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(item?.name ?? '');
    setNameHi(item?.nameHi ?? '');
    setCategoryId(item?.categoryId ?? '');
    setUnit(item?.unit ?? 'pcs');
    setSaleRate(item ? paiseToInput(item.saleRate) : '');
    setPurchaseRate(item ? paiseToInput(item.purchaseRate) : '');
    setGstRate(item?.gstRate ?? 0);
    setHsn(item?.hsn ?? '');
    setIsActive(item?.isActive ?? true);
    setProblem(null);
  }, [open, item]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (!name.trim()) return setProblem({ message: t('itemNameRequired'), detail: '' });
    const sale = parsePaise(saleRate || '0');
    const purchase = parsePaise(purchaseRate || '0');
    if (sale === null || sale < 0 || purchase === null || purchase < 0) {
      return setProblem({ message: t('rateInvalid'), detail: '' });
    }

    const saved: ShopItem = {
      id: item?.id ?? newId(),
      categoryId: categoryId || null,
      name: name.trim(),
      nameHi: nameHi.trim(),
      unit,
      saleRate: sale,
      purchaseRate: purchase,
      gstRate,
      hsn: hsn.trim(),
      isActive,
    };

    setIsSaving(true);
    try {
      if (item) await updateShopItem(saved, userId);
      else await insertShopItem(saved, userId);
      onSaved(saved, !item);
    } catch (err) {
      setProblem(describeDbError(err, t('itemSaveFailed')));
    } finally {
      setIsSaving(false);
    }
  };

  const unitOptions = [...UNITS, ...(UNITS.includes(unit as (typeof UNITS)[number]) ? [] : [unit])];

  return (
    <AppModal
      open={open}
      onClose={onClose}
      title={item ? t('editItem') : t('addItem')}
      icon={<Tag className="h-5 w-5" />}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormInput label={t('itemName')} value={name} onChange={(e) => setName(e.target.value)} autoFocus={!item} />
        <FormInput
          label={`${t('itemNameHi')} ${t('optional')}`}
          value={nameHi}
          onChange={(e) => setNameHi(e.target.value)}
          lang="hi"
        />
        <PickerField
          label={t('category')}
          title={t('chooseCategory')}
          icon={<Layers className="h-5 w-5" />}
          value={categoryId}
          placeholder={t('noCategory')}
          options={[
            { value: '', label: t('noCategory') },
            ...categories.map((c) => ({ value: c.id, label: displayName(c, language), description: secondaryName(c, language) })),
          ]}
          onChange={setCategoryId}
        />
        <Segmented<string>
          label={t('unit')}
          value={unit}
          columns={4}
          options={unitOptions.map((u) => ({ value: u, label: unitLabel(t, u) }))}
          onChange={setUnit}
        />
        <div className="grid grid-cols-2 gap-3">
          <FormInput
            label={t('saleRate')}
            inputMode="decimal"
            value={saleRate}
            onChange={(e) => setSaleRate(e.target.value)}
            placeholder="0"
            className="text-lg font-bold"
          />
          <FormInput
            label={t('purchaseRate')}
            inputMode="decimal"
            value={purchaseRate}
            onChange={(e) => setPurchaseRate(e.target.value)}
            placeholder="0"
          />
        </div>
        <p className="text-sm text-slate-500 -mt-2">{t('purchaseRateHint')}</p>
        <Segmented<number>
          label={t('gstRate')}
          value={gstRate}
          options={GST_RATES.map((r) => ({ value: r, label: `${r}%` }))}
          onChange={setGstRate}
        />
        <FormInput
          label={`${t('hsn')} ${t('optional')}`}
          inputMode="numeric"
          value={hsn}
          onChange={(e) => setHsn(e.target.value)}
        />
        <ToggleRow label={t('showInBills')} checked={isActive} onChange={setIsActive} />

        {problem && <FormError message={problem.message} detail={problem.detail} />}

        <div className="flex flex-col-reverse sm:flex-row gap-2.5 pt-2">
          <ActionButton tone="secondary" icon={<X className="h-5 w-5" />} label={t('cancel')} onClick={onClose} className="sm:flex-1" />
          <ActionButton
            type="submit"
            icon={<Check className="h-5 w-5" />}
            label={isSaving ? t('saving') : t('save')}
            busy={isSaving}
            className="sm:flex-1"
          />
        </div>
      </form>
    </AppModal>
  );
}

// --- Category form ---

interface CategoryFormModalProps {
  open: boolean;
  category: ShopCategory | null;
  nextSortOrder: number;
  onClose: () => void;
  onSaved: (category: ShopCategory, isNew: boolean) => void;
}

function CategoryFormModal({ open, category, nextSortOrder, onClose, onSaved }: CategoryFormModalProps) {
  const { t } = useT();
  const [name, setName] = useState('');
  const [nameHi, setNameHi] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [problem, setProblem] = useState<FriendlyError | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(category?.name ?? '');
    setNameHi(category?.nameHi ?? '');
    setIsActive(category?.isActive ?? true);
    setProblem(null);
  }, [open, category]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (!name.trim()) return setProblem({ message: t('categoryNameRequired'), detail: '' });

    const saved: ShopCategory = {
      id: category?.id ?? newId(),
      name: name.trim(),
      nameHi: nameHi.trim(),
      sortOrder: category?.sortOrder ?? nextSortOrder,
      isActive,
    };

    setIsSaving(true);
    try {
      if (category) await updateShopCategory(saved);
      else await insertShopCategory(saved);
      onSaved(saved, !category);
    } catch (err) {
      setProblem(describeDbError(err, t('itemSaveFailed')));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AppModal
      open={open}
      onClose={onClose}
      title={category ? t('editCategory') : t('addCategory')}
      icon={<Layers className="h-5 w-5" />}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormInput label={t('categoryName')} value={name} onChange={(e) => setName(e.target.value)} autoFocus={!category} />
        <FormInput
          label={`${t('categoryNameHi')} ${t('optional')}`}
          value={nameHi}
          onChange={(e) => setNameHi(e.target.value)}
          lang="hi"
        />
        <ToggleRow label={t('showCategory')} checked={isActive} onChange={setIsActive} />
        {problem && <FormError message={problem.message} detail={problem.detail} />}
        <div className="flex flex-col-reverse sm:flex-row gap-2.5 pt-2">
          <ActionButton tone="secondary" icon={<X className="h-5 w-5" />} label={t('cancel')} onClick={onClose} className="sm:flex-1" />
          <ActionButton
            type="submit"
            icon={<Check className="h-5 w-5" />}
            label={isSaving ? t('saving') : t('save')}
            busy={isSaving}
            className="sm:flex-1"
          />
        </div>
      </form>
    </AppModal>
  );
}
