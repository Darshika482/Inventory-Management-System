import React, { useEffect, useMemo, useState } from 'react';
import {
  Banknote,
  CheckCircle2,
  Eraser,
  Eye,
  FilePlus2,
  NotebookPen,
  Plus,
  Printer,
  ReceiptText,
  Save,
  Search,
  ShoppingCart,
  Smartphone,
  SplitSquareHorizontal,
  Trash2,
  User as UserIcon,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type { User } from '../../types';
import { AppModal } from '../../components/AppModal';
import { FormError } from '../../components/FormInput';
import { describeDbError, type FriendlyError } from '../../lib/dbErrors';
import { playSuccessChime, unlockSound } from '../../lib/sounds';
import {
  fetchItemSaleCounts,
  fetchShopCategories,
  fetchShopItems,
  fetchShopParties,
  fetchShopSettings,
  saveSaleRpc,
  toSaleRpcPayload,
} from '../db';
import { loadWithCache, readCache, writeCache } from '../cache';
import { computeBill, type BillDiscount } from '../gst';
import { fyFor, istToday } from '../fy';
import { useT } from '../i18n';
import { newId } from '../ids';
import { displayName, secondaryName, unitLabel } from '../labels';
import { formatQty, formatRupees, paiseToInput, parseMilli, parsePaise, type Paise } from '../money';
import { getDeviceSeries, queueSale, refreshCounter, syncOutbox } from '../outbox';
import type { PaidMode, PaymentMode, ShopCategory, ShopInvoice, ShopItem, ShopParty, ShopSettings } from '../types';
import { ItemPickerSheet } from './ItemPickerSheet';
import { PartyFormModal } from './ShopPartiesSection';
import { ActionButton, ErrorState, LoadingState, PageHeader, PageShell, SearchBox, Segmented } from './ui';

interface NewSaleSectionProps {
  currentUser: User;
  onNavigate: (section: string) => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

/** One line while the bill is being made. Typed values stay as text until saved. */
interface DraftLine {
  key: string;
  itemId: string;
  name: string;
  nameHi: string;
  hsn: string;
  unit: string;
  gstRate: number;
  savedRate: Paise;
  qtyText: string;
  rateText: string;
  updateRate: boolean;
}

interface Draft {
  partyId: string | null;
  lines: DraftLine[];
  discountMode: 'amount' | 'percent';
  discountText: string;
  paymentMode: PaymentMode;
  paidText: string;
  paidMode: PaidMode;
}

const EMPTY_DRAFT: Draft = {
  partyId: null,
  lines: [],
  discountMode: 'amount',
  discountText: '',
  paymentMode: 'cash',
  paidText: '',
  paidMode: 'cash',
};

const DRAFT_KEY = 'sale_draft';
const LAST_GST_KEY = 'shop_last_is_gst';
/** Lets the Sale bills page open the bill that was just saved. */
export const OPEN_BILL_KEY = 'shop_open_bill';

function readLastIsGst(fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(LAST_GST_KEY);
    return stored === null ? fallback : stored === '1';
  } catch {
    return fallback;
  }
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

interface SavedBill {
  invoice: ShopInvoice;
  uploaded: boolean;
}

export function NewSaleSection({ currentUser, onNavigate, showToast }: NewSaleSectionProps) {
  const { t, language } = useT();
  const isOwner = currentUser.role === 'Admin';

  const [settings, setSettings] = useState<ShopSettings | null>(null);
  const [items, setItems] = useState<ShopItem[]>([]);
  const [categories, setCategories] = useState<ShopCategory[]>([]);
  const [parties, setParties] = useState<ShopParty[]>([]);
  const [saleCounts, setSaleCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<FriendlyError | null>(null);

  const [draft, setDraft] = useState<Draft>(() => readCache<Draft>(DRAFT_KEY) ?? EMPTY_DRAFT);
  const [isGst, setIsGst] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [partyPickerOpen, setPartyPickerOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [problem, setProblem] = useState<FriendlyError | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState<SavedBill | null>(null);

  const load = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [s, i, c, p] = await Promise.all([
        loadWithCache('settings', fetchShopSettings),
        loadWithCache('items', fetchShopItems),
        loadWithCache('categories', fetchShopCategories),
        loadWithCache('parties', fetchShopParties),
      ]);
      setSettings(s.data);
      setItems(i.data);
      setCategories(c.data);
      setParties(p.data);
      setIsGst(readLastIsGst(Boolean(s.data.gstin)));
      // Not needed to bill, so a failure here never blocks the screen.
      loadWithCache('sale_counts', fetchItemSaleCounts)
        .then((r) => setSaleCounts(r.data))
        .catch(() => {});
      // Start (or catch up) this phone's bill numbers while online.
      void refreshCounter('sale', fyFor(istToday()), getDeviceSeries());
    } catch (err) {
      setLoadError(describeDbError(err, 'The bill screen could not be loaded'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // Keep the unsaved bill if the page is left by mistake.
  useEffect(() => {
    writeCache(DRAFT_KEY, draft);
  }, [draft]);

  const party = draft.partyId ? parties.find((p) => p.id === draft.partyId) ?? null : null;
  const isInterstate = Boolean(isGst && party && settings && party.stateCode !== settings.stateCode);
  const ratesIncludeGst = settings?.ratesIncludeGst ?? true;

  const parsedLines = draft.lines.map((line) => ({
    line,
    qty: parseMilli(line.qtyText),
    rate: parsePaise(line.rateText),
  }));

  const discount: BillDiscount | null = useMemo(() => {
    const value = parsePaise(draft.discountText || '0');
    if (value === null || value <= 0) return null;
    return draft.discountMode === 'amount' ? { kind: 'amount', amount: value } : { kind: 'percent', basisPoints: value };
  }, [draft.discountMode, draft.discountText]);

  const bill = computeBill({
    lines: parsedLines.map(({ line, qty, rate }) => ({
      qty: qty !== null && qty > 0 ? qty : 0,
      rate: rate !== null && rate >= 0 ? rate : 0,
      gstRate: line.gstRate,
    })),
    isGst,
    isInterstate,
    ratesIncludeGst,
    discount,
  });

  const paidPartial = parsePaise(draft.paidText || '');
  const onBill = useMemo(() => {
    const map: Record<string, number> = {};
    for (const { line, qty } of parsedLines) map[line.itemId] = (map[line.itemId] ?? 0) + (qty ?? 0);
    return map;
    // parsedLines is rebuilt from draft.lines
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.lines]);

  if (isLoading) return <LoadingState />;
  if (loadError || !settings) {
    return <ErrorState error={loadError ?? { message: t('loadFailed'), detail: '' }} onRetry={load} />;
  }

  const updateDraft = (patch: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...patch }));
  const updateLine = (key: string, patch: Partial<DraftLine>) =>
    setDraft((prev) => ({ ...prev, lines: prev.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));

  const addItem = (item: ShopItem) => {
    setProblem(null);
    setDraft((prev) => {
      const existing = prev.lines.find((l) => l.itemId === item.id);
      if (existing) {
        const qty = parseMilli(existing.qtyText) ?? 0;
        return {
          ...prev,
          lines: prev.lines.map((l) => (l.key === existing.key ? { ...l, qtyText: formatQty(Math.max(qty, 0) + 1000) } : l)),
        };
      }
      const line: DraftLine = {
        key: newId(),
        itemId: item.id,
        name: item.name,
        nameHi: item.nameHi,
        hsn: item.hsn,
        unit: item.unit,
        gstRate: item.gstRate,
        savedRate: item.saleRate,
        qtyText: '1',
        rateText: paiseToInput(item.saleRate),
        updateRate: false,
      };
      return { ...prev, lines: [...prev.lines, line] };
    });
  };

  const stepQty = (line: DraftLine, direction: 1 | -1) => {
    const qty = parseMilli(line.qtyText) ?? 0;
    const next = direction === 1 ? Math.max(qty, 0) + 1000 : qty - 1000;
    if (next <= 0) return;
    updateLine(line.key, { qtyText: formatQty(next) });
  };

  const setGst = (value: boolean) => {
    setIsGst(value);
    try {
      localStorage.setItem(LAST_GST_KEY, value ? '1' : '0');
    } catch {
      // Not remembered on this phone; nothing else is affected.
    }
  };

  const resetBill = () => {
    setDraft(EMPTY_DRAFT);
    setProblem(null);
    setSaved(null);
    setConfirmClear(false);
  };

  const validate = (): string | null => {
    if (draft.lines.length === 0) return t('needLines');
    for (const { line, qty, rate } of parsedLines) {
      if (qty === null || qty <= 0) return t('qtyInvalid', { name: line.name });
      if (rate === null || rate < 0) return t('rateInvalidLine', { name: line.name });
    }
    if (discount && discount.kind === 'amount' && discount.amount > bill.itemsTotal) return t('discountInvalid');
    if (discount && discount.kind === 'percent' && discount.basisPoints > 10_000) return t('discountInvalid');
    if (draft.paymentMode === 'credit' || draft.paymentMode === 'partial') {
      if (!party) return t('needCustomerForCredit');
    }
    if (draft.paymentMode === 'partial' && (paidPartial === null || paidPartial <= 0 || paidPartial >= bill.total)) {
      return t('paidInvalid');
    }
    return null;
  };

  const handleSave = async (print: boolean) => {
    unlockSound();
    setProblem(null);
    const error = validate();
    if (error) {
      setProblem({ message: error, detail: '' });
      return;
    }

    const billDate = istToday();
    const paidAmount =
      draft.paymentMode === 'cash' || draft.paymentMode === 'upi'
        ? bill.total
        : draft.paymentMode === 'credit'
          ? 0
          : (paidPartial as number);
    const updateRateIds = new Set(
      isOwner
        ? parsedLines.filter(({ line, rate }) => line.updateRate && rate !== line.savedRate).map(({ line }) => line.itemId)
        : []
    );

    const invoice: ShopInvoice = {
      id: null,
      clientId: newId(),
      billType: 'sale',
      series: getDeviceSeries(),
      billNumber: null,
      fy: fyFor(billDate),
      billDate,
      partyId: party?.id ?? null,
      partyName: party?.name ?? '',
      partyGstin: party?.gstin ?? '',
      isGst,
      isInterstate,
      ratesIncludeGst,
      paymentMode: draft.paymentMode,
      paidMode: draft.paymentMode === 'partial' ? draft.paidMode : null,
      itemsTotal: bill.itemsTotal,
      subtotal: bill.subtotal,
      discount: bill.discount,
      discountPercent: discount?.kind === 'percent' ? discount.basisPoints : null,
      cgst: bill.cgst,
      sgst: bill.sgst,
      igst: bill.igst,
      roundOff: bill.roundOff,
      total: bill.total,
      paidAmount,
      status: 'active',
      notes: '',
      createdBy: currentUser.id,
      createdAt: new Date().toISOString(),
      lines: parsedLines.map(({ line, qty, rate }, i) => ({
        itemId: line.itemId,
        itemName: line.name,
        hsn: line.hsn,
        unit: line.unit,
        qty: qty as number,
        rate: rate as number,
        gstRate: bill.lines[i].gstRate,
        discountAmount: bill.lines[i].discount,
        taxableAmount: bill.lines[i].taxable,
        taxAmount: bill.lines[i].tax,
        lineTotal: bill.lines[i].lineTotal,
      })),
      syncState: 'pending',
    };

    setIsSaving(true);
    let result: SavedBill;
    try {
      // 1. On this phone first, so the bill is never lost.
      const queued = await queueSale(invoice, (numbered) => toSaleRpcPayload(numbered, updateRateIds));
      // 2. Upload now if the internet allows, without keeping the customer waiting.
      const upload = syncOutbox().then(async (done) =>
        done.some((d) => d.clientId === invoice.clientId) ? done : syncOutbox()
      );
      const done = await Promise.race([upload, wait(4000).then(() => [])]);
      const hit = done.find((d) => d.clientId === invoice.clientId);
      result = hit
        ? { invoice: { ...queued, billNumber: hit.billNumber, syncState: 'synced' }, uploaded: true }
        : { invoice: queued, uploaded: false };
    } catch {
      // Phone storage is not available (e.g. private browsing): send straight to the server.
      try {
        const response = await saveSaleRpc(toSaleRpcPayload(invoice, updateRateIds));
        result = {
          invoice: { ...invoice, id: response.id, billNumber: response.bill_number, syncState: 'synced' },
          uploaded: true,
        };
      } catch (err) {
        setProblem(describeDbError(err, t('billSaveFailed')));
        setIsSaving(false);
        return;
      }
    }
    setIsSaving(false);

    // The ticked rates are now the item's saved rate (the server does the same on upload).
    if (updateRateIds.size > 0) {
      const newRates = new Map(parsedLines.map(({ line, rate }) => [line.itemId, rate as number]));
      setItems((prev) => {
        const next = prev.map((item) => (updateRateIds.has(item.id) ? { ...item, saleRate: newRates.get(item.id)! } : item));
        writeCache('items', next);
        return next;
      });
    }

    const number = result.invoice.billNumber ?? t('numberOnUpload');
    playSuccessChime();
    showToast(result.uploaded ? t('billSaved', { number }) : t('billSavedOffline', { number }), result.uploaded ? 'success' : 'info');
    if (print) showToast(t('printingLater'), 'info');
    setDraft(EMPTY_DRAFT);
    setSaved(result);
  };

  if (saved) {
    return (
      <PageShell>
        <PageHeader title={t('newSaleTitle')} icon={<ShoppingCart className="h-5 w-5" />} />
        <SavedPanel
          saved={saved}
          onNewBill={resetBill}
          onViewBill={() => {
            try {
              sessionStorage.setItem(OPEN_BILL_KEY, saved.invoice.clientId);
            } catch {
              // The list still opens, just without the bill on top.
            }
            onNavigate('shop-sales');
          }}
        />
      </PageShell>
    );
  }

  const showTaxOnTop = isGst && !ratesIncludeGst && bill.tax > 0;

  return (
    <PageShell>
      <PageHeader
        title={t('newSaleTitle')}
        icon={<ShoppingCart className="h-5 w-5" />}
        actions={
          draft.lines.length > 0 ? (
            <ActionButton
              tone="secondary"
              icon={<Eraser className="h-5 w-5" />}
              label={t('clearBill')}
              onClick={() => setConfirmClear(true)}
            />
          ) : undefined
        }
      />

      <div className="max-w-3xl space-y-4">
        {/* Customer */}
        <section className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4 flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
            <UserIcon className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-slate-500">{t('customer')}</p>
            <p className="text-lg font-bold text-slate-900 truncate">{party ? party.name : t('cashSale')}</p>
            <p className="text-sm text-slate-500 truncate">
              {party ? [party.phone, isInterstate ? t('otherStateNote') : ''].filter(Boolean).join(' · ') : t('cashSaleHint')}
            </p>
          </div>
          <ActionButton
            tone="secondary"
            icon={<Users className="h-5 w-5" />}
            label={t('change')}
            onClick={() => setPartyPickerOpen(true)}
          />
        </section>

        {/* GST or not */}
        <Segmented<'gst' | 'plain'>
          value={isGst ? 'gst' : 'plain'}
          options={[
            { value: 'gst', label: t('gstBill'), icon: <ReceiptText className="h-4 w-4" /> },
            { value: 'plain', label: t('nonGstBill'), icon: <FilePlus2 className="h-4 w-4" /> },
          ]}
          onChange={(v) => setGst(v === 'gst')}
        />

        {/* Lines */}
        <section className="space-y-2">
          {draft.lines.length === 0 ? (
            <div className="p-6 text-center text-base text-slate-500 bg-white border border-dashed border-slate-300 rounded-xl">
              {t('noLinesYet')}
            </div>
          ) : (
            parsedLines.map(({ line, qty, rate }, index) => (
              <SaleLineRow
                key={line.key}
                line={line}
                qtyValid={qty !== null && qty > 0}
                rateValid={rate !== null && rate >= 0}
                rateChanged={rate !== null && rate !== line.savedRate}
                amount={bill.lines[index]?.gross ?? 0}
                canUpdateRate={isOwner}
                onChange={(patch) => updateLine(line.key, patch)}
                onStep={(direction) => stepQty(line, direction)}
                onRemove={() => updateDraft({ lines: draft.lines.filter((l) => l.key !== line.key) })}
                isGst={isGst}
              />
            ))
          )}
          <ActionButton
            tone="amber"
            size="lg"
            icon={<Plus className="h-6 w-6" />}
            label={t('addItems')}
            onClick={() => setPickerOpen(true)}
            className="w-full"
          />
        </section>

        {/* Discount */}
        <section className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4 space-y-2">
          <p className="text-sm font-semibold text-slate-700">{t('discount')}</p>
          <div className="flex gap-2">
            <div className="w-36 shrink-0">
              <Segmented<'amount' | 'percent'>
                value={draft.discountMode}
                options={[
                  { value: 'amount', label: t('discountInRupees') },
                  { value: 'percent', label: t('discountInPercent') },
                ]}
                onChange={(mode) => updateDraft({ discountMode: mode })}
              />
            </div>
            <input
              inputMode="decimal"
              value={draft.discountText}
              onChange={(e) => updateDraft({ discountText: e.target.value })}
              placeholder="0"
              aria-label={t('discount')}
              className="min-w-0 flex-1 min-h-12 bg-slate-50 border border-slate-200 rounded-xl px-4 text-lg font-bold text-slate-900 focus:outline-none focus:bg-white focus:border-amber-500"
            />
          </div>
        </section>

        {/* Payment */}
        <section className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4 space-y-3">
          <Segmented<PaymentMode>
            label={t('payment')}
            value={draft.paymentMode}
            columns={2}
            options={[
              { value: 'cash', label: t('pay_cash'), icon: <Banknote className="h-4 w-4" /> },
              { value: 'upi', label: t('pay_upi'), icon: <Smartphone className="h-4 w-4" /> },
              { value: 'credit', label: t('pay_credit'), icon: <NotebookPen className="h-4 w-4" /> },
              { value: 'partial', label: t('pay_partial'), icon: <SplitSquareHorizontal className="h-4 w-4" /> },
            ]}
            onChange={(mode) => updateDraft({ paymentMode: mode })}
          />
          {draft.paymentMode === 'partial' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-slate-700">{t('paidNow')}</p>
                <input
                  inputMode="decimal"
                  value={draft.paidText}
                  onChange={(e) => updateDraft({ paidText: e.target.value })}
                  placeholder="0"
                  className="w-full min-h-12 bg-slate-50 border border-slate-200 rounded-xl px-4 text-lg font-bold text-slate-900 focus:outline-none focus:bg-white focus:border-amber-500"
                />
              </div>
              <Segmented<PaidMode>
                label={t('paidBy')}
                value={draft.paidMode}
                options={[
                  { value: 'cash', label: t('pay_cash') },
                  { value: 'upi', label: t('pay_upi') },
                ]}
                onChange={(mode) => updateDraft({ paidMode: mode })}
              />
            </div>
          )}
          {(draft.paymentMode === 'credit' || draft.paymentMode === 'partial') && (
            <p className="text-base font-bold text-red-700">
              {t('udhaarLeft', {
                amount: formatRupees(
                  draft.paymentMode === 'credit' ? bill.total : Math.max(0, bill.total - (paidPartial ?? 0)),
                  true
                ),
              })}
            </p>
          )}
        </section>

        {/* Totals */}
        <section className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4 space-y-1.5 text-base">
          <TotalRow label={t('itemsTotal')} value={formatRupees(bill.itemsTotal, true)} />
          {bill.discount > 0 && (
            <TotalRow
              label={
                discount?.kind === 'percent'
                  ? `${t('discount')} (${paiseToInput(discount.basisPoints)}%)`
                  : t('discount')
              }
              value={`− ${formatRupees(bill.discount, true)}`}
              tone="emerald"
            />
          )}
          {showTaxOnTop && (
            <>
              <TotalRow label={t('taxableValue')} value={formatRupees(bill.subtotal, true)} muted />
              {isInterstate ? (
                <TotalRow label={`+ ${t('igst')}`} value={formatRupees(bill.igst, true)} />
              ) : (
                <>
                  <TotalRow label={`+ ${t('cgst')}`} value={formatRupees(bill.cgst, true)} />
                  <TotalRow label={`+ ${t('sgst')}`} value={formatRupees(bill.sgst, true)} />
                </>
              )}
            </>
          )}
          {bill.roundOff !== 0 && (
            <TotalRow
              label={t('roundOff')}
              value={`${bill.roundOff > 0 ? '+' : '−'} ${formatRupees(Math.abs(bill.roundOff), true)}`}
              muted
            />
          )}
          {isGst && ratesIncludeGst && bill.tax > 0 && (
            <div className="mt-2 pt-2 border-t border-slate-100 text-sm text-slate-500 space-y-1">
              <TotalRow label={t('taxableValue')} value={formatRupees(bill.subtotal, true)} muted small />
              <TotalRow
                label={t('gstIncluded')}
                value={
                  isInterstate
                    ? `${t('igst')} ${formatRupees(bill.igst, true)}`
                    : `${t('cgst')} ${formatRupees(bill.cgst, true)} + ${t('sgst')} ${formatRupees(bill.sgst, true)}`
                }
                muted
                small
              />
            </div>
          )}
        </section>

        {problem && <FormError message={problem.message} detail={problem.detail} />}
      </div>

      {/* Always-visible total and save buttons */}
      <div className="sticky bottom-0 -mx-3 sm:-mx-6 md:-mx-8 px-3 sm:px-6 md:px-8 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-white/95 backdrop-blur border-t border-slate-200 shadow-[0_-8px_24px_-12px_rgba(15,23,42,0.25)]">
        <div className="max-w-3xl space-y-2.5">
          <div className="flex items-end justify-between gap-3">
            <span className="text-lg font-bold text-slate-600">{t('total')}</span>
            <span className="text-4xl font-extrabold text-slate-900 tabular-nums tracking-tight" data-testid="bill-total">
              {formatRupees(bill.total)}
            </span>
          </div>
          <div className="grid grid-cols-5 gap-2">
            <ActionButton
              tone="success"
              size="lg"
              icon={<Printer className="h-6 w-6" />}
              label={t('saveAndPrint')}
              busy={isSaving}
              onClick={() => handleSave(true)}
              className="col-span-3"
            />
            <ActionButton
              tone="primary"
              size="lg"
              icon={<Save className="h-5 w-5" />}
              label={t('saveOnly')}
              busy={isSaving}
              onClick={() => handleSave(false)}
              className="col-span-2"
            />
          </div>
        </div>
      </div>

      <ItemPickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        items={items}
        categories={categories}
        saleCounts={saleCounts}
        onBill={onBill}
        onPick={addItem}
      />

      <PartyPickerSheet
        open={partyPickerOpen}
        parties={parties}
        selectedId={draft.partyId}
        shopStateCode={settings.stateCode}
        canEditBalance={isOwner}
        onClose={() => setPartyPickerOpen(false)}
        onSelect={(partyId) => {
          updateDraft({ partyId });
          setPartyPickerOpen(false);
          setProblem(null);
        }}
        onAdded={(added) => {
          setParties((prev) => {
            const next = [...prev, added].sort((a, b) => a.name.localeCompare(b.name));
            writeCache('parties', next);
            return next;
          });
          updateDraft({ partyId: added.id });
          setPartyPickerOpen(false);
          setProblem(null);
          showToast(t('partySaved', { name: added.name }), 'success');
        }}
      />

      <AppModal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title={t('clearBill')}
        description={t('clearBillConfirm')}
        icon={<Eraser className="h-5 w-5" />}
        accent="red"
      >
        <div className="flex flex-col-reverse sm:flex-row gap-2.5">
          <ActionButton tone="secondary" icon={<X className="h-5 w-5" />} label={t('cancel')} onClick={() => setConfirmClear(false)} className="sm:flex-1" />
          <ActionButton tone="danger" icon={<Trash2 className="h-5 w-5" />} label={t('clearBillYes')} onClick={resetBill} className="sm:flex-1" />
        </div>
      </AppModal>
    </PageShell>
  );
}

// --- One line on the bill ---

function SaleLineRow({
  line,
  qtyValid,
  rateValid,
  rateChanged,
  amount,
  canUpdateRate,
  onChange,
  onStep,
  onRemove,
  isGst,
}: {
  line: DraftLine;
  qtyValid: boolean;
  rateValid: boolean;
  rateChanged: boolean;
  amount: Paise;
  canUpdateRate: boolean;
  onChange: (patch: Partial<DraftLine>) => void;
  onStep: (direction: 1 | -1) => void;
  onRemove: () => void;
  isGst: boolean;
}) {
  const { t, language } = useT();
  const asItem = { name: line.name, nameHi: line.nameHi } as ShopItem;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold text-slate-900 leading-snug">{displayName(asItem, language)}</p>
          <p className="text-sm text-slate-500 truncate">
            {[secondaryName(asItem, language), unitLabel(t, line.unit), isGst ? `GST ${line.gstRate}%` : '']
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="min-h-12 shrink-0 flex items-center gap-1.5 px-3 rounded-xl text-sm font-bold text-red-600 hover:bg-red-50 cursor-pointer"
        >
          <Trash2 className="h-5 w-5" />
          {t('remove')}
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <p className="text-xs font-semibold text-slate-500">{t('qty')}</p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onStep(-1)}
              aria-label={t('decrease')}
              className="h-12 w-12 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 text-2xl font-bold text-slate-800 cursor-pointer"
            >
              −
            </button>
            <input
              inputMode="decimal"
              value={line.qtyText}
              onChange={(e) => onChange({ qtyText: e.target.value })}
              aria-label={t('qty')}
              className={`h-12 w-16 text-center rounded-xl border text-lg font-bold text-slate-900 focus:outline-none focus:border-amber-500 ${
                qtyValid ? 'border-slate-200 bg-slate-50' : 'border-red-400 bg-red-50'
              }`}
            />
            <button
              type="button"
              onClick={() => onStep(1)}
              aria-label={t('increase')}
              className="h-12 w-12 flex items-center justify-center rounded-xl bg-[#0F172A] hover:bg-slate-800 text-2xl font-bold text-white cursor-pointer"
            >
              +
            </button>
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-semibold text-slate-500">{t('rate')} (₹)</p>
          <input
            inputMode="decimal"
            value={line.rateText}
            onChange={(e) => onChange({ rateText: e.target.value })}
            aria-label={t('rate')}
            className={`h-12 w-24 px-3 rounded-xl border text-lg font-bold text-slate-900 focus:outline-none focus:border-amber-500 ${
              rateValid ? (rateChanged ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-slate-50') : 'border-red-400 bg-red-50'
            }`}
          />
        </div>
        <div className="ml-auto text-right">
          <p className="text-xs font-semibold text-slate-500">{t('amount')}</p>
          <p className="h-12 flex items-center justify-end text-xl font-extrabold text-slate-900 tabular-nums">
            {formatRupees(amount, true)}
          </p>
        </div>
      </div>

      {rateChanged && rateValid && canUpdateRate && (
        <label className="min-h-12 flex items-center gap-3 rounded-xl bg-amber-50 border border-amber-200 px-3 cursor-pointer">
          <input
            type="checkbox"
            checked={line.updateRate}
            onChange={(e) => onChange({ updateRate: e.target.checked })}
            className="h-6 w-6 accent-amber-600 shrink-0"
          />
          <span className="text-sm font-semibold text-amber-900">
            {t('updateSavedRate', { old: formatRupees(line.savedRate) })}
          </span>
        </label>
      )}
    </div>
  );
}

function TotalRow({
  label,
  value,
  muted = false,
  small = false,
  tone,
}: {
  label: string;
  value: string;
  muted?: boolean;
  small?: boolean;
  tone?: 'emerald';
}) {
  return (
    <div className={`flex items-center justify-between gap-3 ${small ? 'text-sm' : 'text-base'}`}>
      <span className={muted ? 'text-slate-500' : 'text-slate-700'}>{label}</span>
      <span
        className={`tabular-nums font-semibold ${
          tone === 'emerald' ? 'text-emerald-700' : muted ? 'text-slate-500' : 'text-slate-900'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

// --- After saving ---

function SavedPanel({ saved, onNewBill, onViewBill }: { saved: SavedBill; onNewBill: () => void; onViewBill: () => void }) {
  const { t } = useT();
  const { invoice, uploaded } = saved;
  return (
    <div className="max-w-xl bg-white border border-emerald-200 rounded-2xl p-6 text-center space-y-4 shadow-sm">
      <CheckCircle2 className="h-14 w-14 text-emerald-600 mx-auto" />
      <div>
        <p className="text-xl font-bold text-slate-900">{t('savedTitle')}</p>
        <p className="text-2xl font-extrabold text-slate-900 mt-1 tabular-nums" data-testid="saved-bill-number">
          {invoice.billNumber ?? t('numberOnUpload')}
        </p>
        <p className="text-4xl font-extrabold text-emerald-700 mt-2 tabular-nums">{formatRupees(invoice.total)}</p>
        <p className="text-base text-slate-600 mt-1">
          {invoice.partyName || t('cashSale')} · {t(`pay_${invoice.paymentMode}`)}
        </p>
        {!uploaded && (
          <p className="mt-3 inline-block px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-sm font-bold text-amber-800">
            {t('waitingUpload')}
          </p>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <ActionButton size="lg" icon={<Plus className="h-6 w-6" />} label={t('newBill')} onClick={onNewBill} />
        <ActionButton size="lg" tone="secondary" icon={<Eye className="h-5 w-5" />} label={t('viewBill')} onClick={onViewBill} />
      </div>
    </div>
  );
}

// --- Choosing the customer ---

interface PartyPickerSheetProps {
  open: boolean;
  parties: ShopParty[];
  selectedId: string | null;
  shopStateCode: string;
  canEditBalance: boolean;
  onClose: () => void;
  onSelect: (partyId: string | null) => void;
  onAdded: (party: ShopParty) => void;
}

function PartyPickerSheet({
  open,
  parties,
  selectedId,
  shopStateCode,
  canEditBalance,
  onClose,
  onSelect,
  onAdded,
}: PartyPickerSheetProps) {
  const { t } = useT();
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (open) setSearch('');
  }, [open]);

  const q = search.trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  const shown = parties.filter(
    (p) => p.isActive && (!q || p.name.toLowerCase().includes(q) || (digits && p.phone.includes(digits)))
  );

  const row = (key: string, title: string, subtitle: string, selected: boolean, onClick: () => void) => (
    <li key={key}>
      <button
        type="button"
        onClick={onClick}
        className={`w-full min-h-14 flex items-center gap-3 rounded-xl border px-4 py-2.5 text-left cursor-pointer ${
          selected ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200 hover:border-slate-300'
        }`}
      >
        <UserIcon className="h-5 w-5 text-slate-400 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-base font-bold text-slate-900 truncate">{title}</span>
          {subtitle && <span className="block text-sm text-slate-500 truncate">{subtitle}</span>}
        </span>
        {selected && <CheckCircle2 className="h-5 w-5 text-amber-600 shrink-0" />}
      </button>
    </li>
  );

  return (
    <>
      <AppModal open={open && !adding} onClose={onClose} title={t('chooseCustomer')} icon={<Users className="h-5 w-5" />}>
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="flex-1 min-w-0">
              <SearchBox value={search} onChange={setSearch} placeholder={t('searchParties')} />
            </div>
          </div>
          <ActionButton
            tone="amber"
            icon={<UserPlus className="h-5 w-5" />}
            label={t('newCustomer')}
            onClick={() => setAdding(true)}
            className="w-full"
          />
          <ul className="space-y-2">
            {!q && row('cash', t('cashSale'), t('cashSaleHint'), selectedId === null, () => onSelect(null))}
            {shown.map((p) =>
              row(
                p.id,
                p.name,
                [p.phone, p.stateCode !== shopStateCode ? t('otherStateNote') : ''].filter(Boolean).join(' · '),
                p.id === selectedId,
                () => onSelect(p.id)
              )
            )}
            {q && shown.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-slate-500 flex items-center justify-center gap-2">
                <Search className="h-4 w-4" />
                {t('noMatch')}
              </li>
            )}
          </ul>
        </div>
      </AppModal>

      <PartyFormModal
        open={open && adding}
        party={null}
        quick
        initialName={/\d/.test(search) ? '' : search.trim()}
        defaultStateCode={shopStateCode}
        canEditBalance={canEditBalance}
        onClose={() => setAdding(false)}
        onSaved={(party) => {
          setAdding(false);
          onAdded(party);
        }}
      />
    </>
  );
}

