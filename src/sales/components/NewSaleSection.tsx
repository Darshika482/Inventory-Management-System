import React, { useEffect, useMemo, useState } from 'react';
import {
  Banknote,
  CheckCircle2,
  Eraser,
  Eye,
  Plus,
  Printer,
  ReceiptText,
  Save,
  Search,
  ShoppingCart,
  Smartphone,
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
import { loadWithCache, readCache, shopListsCache, writeCache, type ShopLists } from '../cache';
import { loadLocalFirst } from '../../lib/localFirst';
import { computeBill, GST_RATES, type BillDiscount } from '../gst';
import { billLabel, fyFor, istToday } from '../fy';
import { useT } from '../i18n';
import { newId } from '../ids';
import { displayName, unitLabel } from '../labels';
import { formatQty, formatRupees, paiseToInput, parseMilli, parsePaise, type Paise } from '../money';
import { getDeviceSeries, queueSale, refreshCounter, syncOutbox } from '../outbox';
import type { PaidMode, PaymentMode, ShopCategory, ShopInvoice, ShopItem, ShopParty, ShopSettings } from '../types';
import { ItemPickerSheet, type PickerLine } from './ItemPickerSheet';
import { usePhoneKeyboardOpen } from '../keyboard';
import { NumberBox, NumberPad, NumberPadSpacer, PadSummary, PadWarning, type PadView } from './NumberPad';
import { ShareBillButton } from './ShareBill';
import { PrinterChip, QrSvg, ReceiptPreviewModal, connectAndPrint, openPrinterHelp, printDetail, printMessageKey } from './PrintUi';
import { upiLink } from '../print/receipt';
import { printBill, receiptLinesFor } from '../print/printBill';
import { warmUpPrinter, type PrintResult } from '../print/printer';
import { PartyFormModal } from './ShopPartiesSection';
import { ActionButton, ErrorState, LoadingState, PageHeader, PageShell, SearchBox } from './ui';

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
  /** Amount received now; empty means the full bill. */
  paidText: string;
  /** How it was received. */
  paidMode: PaidMode;
  /**
   * One GST rate for the whole bill on a GST bill, added on top of the
   * amounts. Null (or missing in older drafts): each item's own rate.
   */
  billGstRate?: number | null;
}

const EMPTY_DRAFT: Draft = {
  partyId: null,
  lines: [],
  discountMode: 'amount',
  discountText: '',
  paidText: '',
  paidMode: 'cash',
  billGstRate: null,
};

/** Rates offered for "GST on whole bill". */
const WHOLE_BILL_GST_RATES = GST_RATES.filter((rate) => rate > 0);

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

/**
 * Lines added from the saved item list follow the fresh one: a rate that was
 * not typed over by hand becomes the item's current rate, and GST, HSN, unit
 * and names follow the item too. Quantities are never touched.
 */
function refreshDraftLines(draft: Draft, items: ShopItem[]): Draft {
  const byId = new Map(items.map((item) => [item.id, item]));
  let changed = false;
  const lines = draft.lines.map((line) => {
    const item = byId.get(line.itemId);
    if (!item) return line;
    const rateUntouched = parsePaise(line.rateText) === line.savedRate;
    const next: DraftLine = {
      ...line,
      name: item.name,
      nameHi: item.nameHi,
      hsn: item.hsn,
      unit: item.unit,
      gstRate: item.gstRate,
      savedRate: item.saleRate,
      rateText: rateUntouched ? paiseToInput(item.saleRate) : line.rateText,
    };
    const same = (Object.keys(next) as (keyof DraftLine)[]).every((key) => next[key] === line[key]);
    if (same) return line;
    changed = true;
    return next;
  });
  return changed ? { ...draft, lines } : draft;
}

async function fetchShopLists(): Promise<ShopLists> {
  const [settings, items, categories, parties] = await Promise.all([
    fetchShopSettings(),
    fetchShopItems(),
    fetchShopCategories(),
    fetchShopParties(),
  ]);
  return { settings, items, categories, parties };
}

interface SavedBill {
  invoice: ShopInvoice;
  uploaded: boolean;
}

/** Which number the shop keypad is changing. */
type PadTarget = { kind: 'line'; key: string; field: 'qty' | 'rate' } | { kind: 'discount' } | { kind: 'received' };

export function NewSaleSection({ currentUser, onNavigate, showToast }: NewSaleSectionProps) {
  const { t, language } = useT();
  const isOwner = currentUser.role === 'Admin';

  // The lists saved on this phone show on the very first frame; the fresh
  // ones replace them a moment later (see load below).
  const [savedLists] = useState(() => shopListsCache.read() as ShopLists | null);
  const [settings, setSettings] = useState<ShopSettings | null>(savedLists?.settings ?? null);
  const [items, setItems] = useState<ShopItem[]>(savedLists?.items ?? []);
  const [categories, setCategories] = useState<ShopCategory[]>(savedLists?.categories ?? []);
  const [parties, setParties] = useState<ShopParty[]>(savedLists?.parties ?? []);
  const [saleCounts, setSaleCounts] = useState<Record<string, number>>(
    () => readCache<Record<string, number>>('sale_counts') ?? {}
  );
  const [isLoading, setIsLoading] = useState(!savedLists);
  const [loadError, setLoadError] = useState<FriendlyError | null>(null);

  const [draft, setDraft] = useState<Draft>(() => readCache<Draft>(DRAFT_KEY) ?? EMPTY_DRAFT);
  const [isGst, setIsGst] = useState(() => readLastIsGst(Boolean(savedLists?.settings.gstin ?? true)));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [partyPickerOpen, setPartyPickerOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [problem, setProblem] = useState<FriendlyError | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState<SavedBill | null>(null);
  const [printState, setPrintState] = useState<'idle' | 'printing' | PrintResult>('idle');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pad, setPad] = useState<PadTarget | null>(null);
  // The Save bar steps aside while a keyboard is up, so it never covers a box.
  const keyboardOpen = usePhoneKeyboardOpen();

  const load = async () => {
    // With no saved lists yet (first use on this phone), wait for them.
    if (!settings) setIsLoading(true);
    setLoadError(null);
    let firstShow = !settings;
    try {
      await loadLocalFirst(shopListsCache, fetchShopLists, (lists, fresh) => {
        setSettings(lists.settings);
        setItems(lists.items);
        if (fresh) setDraft((prev) => refreshDraftLines(prev, lists.items));
        setCategories(lists.categories);
        setParties(lists.parties);
        if (firstShow) {
          firstShow = false;
          setIsGst(readLastIsGst(Boolean(lists.settings.gstin)));
          setIsLoading(false);
        }
      });
    } catch (err) {
      setLoadError(describeDbError(err, 'The bill screen could not be loaded'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // Not needed to bill, so a failure here never blocks the screen.
    loadWithCache('sale_counts', fetchItemSaleCounts)
      .then((r) => setSaleCounts(r.data))
      .catch(() => {});
    // Start (or catch up) this phone's bill numbers while online.
    void refreshCounter('sale', fyFor(istToday()), getDeviceSeries());
    warmUpPrinter();
  }, []);

  // Keep the unsaved bill if the page is left by mistake.
  useEffect(() => {
    writeCache(DRAFT_KEY, draft);
  }, [draft]);

  const party = draft.partyId ? parties.find((p) => p.id === draft.partyId) ?? null : null;
  const isInterstate = Boolean(isGst && party && settings && party.stateCode !== settings.stateCode);
  // "GST on whole bill": one rate for every line, added on top of the amounts.
  const wholeBillGst = isGst ? (draft.billGstRate ?? null) : null;
  const ratesIncludeGst = wholeBillGst !== null ? false : (settings?.ratesIncludeGst ?? true);
  const lineGstRate = (line: DraftLine) => wholeBillGst ?? line.gstRate;

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
      gstRate: lineGstRate(line),
    })),
    isGst,
    isInterstate,
    ratesIncludeGst,
    discount,
  });

  // Received now: empty box = the whole bill. Whatever is not received is the balance.
  const received = draft.paidText.trim() === '' ? bill.total : parsePaise(draft.paidText);
  const receivedOk = received !== null && received >= 0 && received <= bill.total;
  const balance = receivedOk ? bill.total - (received as number) : 0;
  const paymentMode: PaymentMode =
    !receivedOk || received === bill.total ? draft.paidMode : received === 0 ? 'credit' : 'partial';
  // Each item's line, for editing quantity and rate inside the item picker.
  const pickerLines: Record<string, PickerLine> = {};
  parsedLines.forEach(({ line, qty, rate }, index) => {
    pickerLines[line.itemId] = {
      qtyText: line.qtyText,
      rateText: line.rateText,
      amount: bill.lines[index]?.gross ?? 0,
      qtyValid: qty !== null && qty > 0,
      rateValid: rate !== null && rate >= 0,
      rateChanged: rate !== null && rate !== line.savedRate,
    };
  });

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

  const lineForItem = (itemId: string) => draft.lines.find((l) => l.itemId === itemId);
  const removeItem = (itemId: string) =>
    setDraft((prev) => ({ ...prev, lines: prev.lines.filter((l) => l.itemId !== itemId) }));

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
    setPrintState('idle');
    setConfirmClear(false);
  };

  const discountTooBig = Boolean(
    discount && (discount.kind === 'amount' ? discount.amount > bill.itemsTotal : discount.basisPoints > 10_000)
  );

  const validate = (): string | null => {
    if (draft.lines.length === 0) return t('needLines');
    for (const { line, qty, rate } of parsedLines) {
      if (qty === null || qty <= 0) return t('qtyInvalid', { name: line.name });
      if (rate === null || rate < 0) return t('rateInvalidLine', { name: line.name });
    }
    if (discountTooBig) return t('discountInvalid');
    if (!receivedOk) return t('receivedInvalid');
    if (balance > 0 && !party) return t('needCustomerForCredit');
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
    const paidAmount = received as number;
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
      paymentMode,
      paidMode: paymentMode === 'partial' ? draft.paidMode : null,
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
    setPrintState('idle');
    let result: SavedBill;
    let printStarted = false;
    try {
      // 1. On this phone first, so the bill is never lost.
      const queued = await queueSale(invoice, (numbered) => toSaleRpcPayload(numbered, updateRateIds));
      // The phone gave it a number, so print now: the customer does not wait for the
      // upload, and Chrome only opens RawBT or the printer list soon after the tap.
      if (print && queued.billNumber) {
        printStarted = true;
        void doPrint(queued);
      }
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

    const number = billLabel(result.invoice.billNumber) ?? t('numberOnUpload');
    playSuccessChime();
    showToast(result.uploaded ? t('billSaved', { number }) : t('billSavedOffline', { number }), result.uploaded ? 'success' : 'info');
    setDraft(EMPTY_DRAFT);
    setSaved(result);
    // Printing comes after the bill is safely saved, and never undoes it.
    if (print && !printStarted) void doPrint(result.invoice);
  };

  const printNow = async (invoice: ShopInvoice): Promise<PrintResult> => {
    if (!settings) return { ok: false, reason: 'failed' };
    setPreviewOpen(false);
    setPrintState('printing');
    const result = await printBill(invoice, settings);
    setPrintState(result);
    return result;
  };

  const doPrint = async (invoice: ShopInvoice) => {
    const result = await printNow(invoice);
    // Not connected: the help sheet's button connects (it counts as a tap) and prints.
    if (!result.ok) openPrinterHelp({ result, retry: () => printNow(invoice) });
  };

  // Retry print: open the phone's printer list straight from the tap, then print.
  const retryPrint = (invoice: ShopInvoice) => {
    setPrintState('printing');
    void connectAndPrint(() => printNow(invoice)).then(setPrintState);
  };

  if (saved) {
    return (
      <PageShell>
        <PageHeader title={t('newSaleTitle')} icon={<ShoppingCart className="h-5 w-5" />} />
        <SavedPanel
          saved={saved}
          printState={printState}
          onPrint={() =>
            typeof printState === 'object' && !printState.ok ? retryPrint(saved.invoice) : void doPrint(saved.invoice)
          }
          onPreview={() => setPreviewOpen(true)}
          onNewBill={resetBill}
          shareSlot={
            <ShareBillButton
              bill={saved.invoice}
              settings={settings}
              phone={parties.find((p) => p.id === saved.invoice.partyId)?.phone}
              showToast={showToast}
              size="lg"
              className="w-full"
            />
          }
          onViewBill={() => {
            try {
              sessionStorage.setItem(OPEN_BILL_KEY, saved.invoice.clientId);
            } catch {
              // The list still opens, just without the bill on top.
            }
            onNavigate('shop-sales');
          }}
        />
        <ReceiptPreviewModal
          open={previewOpen}
          lines={receiptLinesFor(saved.invoice, settings)}
          widthMm={settings.printerWidthMm}
          onClose={() => setPreviewOpen(false)}
          onPrint={() => doPrint(saved.invoice)}
          busy={printState === 'printing'}
        />
      </PageShell>
    );
  }

  const showTaxOnTop = isGst && !ratesIncludeGst && bill.tax > 0;

  // The shop keypad shows what it is changing in big letters above its keys.
  const padLineIndex = pad?.kind === 'line' ? parsedLines.findIndex(({ line }) => line.key === pad.key) : -1;
  let padView: PadView | null = null;
  if (pad?.kind === 'line' && padLineIndex !== -1) {
    const { line, qty, rate } = parsedLines[padLineIndex];
    padView = {
      target: `line:${line.key}`,
      title: displayName({ name: line.name, nameHi: line.nameHi } as ShopItem, language),
      subtitle: isGst ? `GST ${lineGstRate(line)}%` : undefined,
      fields: [
        {
          id: 'qty',
          label: t('qty'),
          value: line.qtyText,
          decimals: 3,
          suffix: unitLabel(t, line.unit),
          required: true,
          invalid: qty === null || qty <= 0,
        },
        { id: 'rate', label: t('rate'), value: line.rateText, decimals: 2, prefix: '₹', required: true, invalid: rate === null || rate < 0 },
      ],
      activeId: pad.field,
      onActiveChange: (id) => setPad({ kind: 'line', key: line.key, field: id === 'rate' ? 'rate' : 'qty' }),
      onChange: (id, value) => updateLine(line.key, id === 'rate' ? { rateText: value } : { qtyText: value }),
      summary: (
        <PadSummary
          items={[
            { label: t('amount'), value: formatRupees(bill.lines[padLineIndex]?.gross ?? 0, true) },
            { label: t('total'), value: formatRupees(bill.total, true), tone: 'muted' },
          ]}
        />
      ),
    };
  } else if (pad?.kind === 'discount') {
    padView = {
      target: 'discount',
      title: `${t('itemsTotal')} ${formatRupees(bill.itemsTotal, true)}`,
      fields: [
        {
          id: 'discount',
          label: t('discount'),
          value: draft.discountText,
          decimals: 2,
          prefix: draft.discountMode === 'amount' ? '₹' : undefined,
          suffix: draft.discountMode === 'percent' ? '%' : undefined,
          placeholder: '0',
        },
      ],
      activeId: 'discount',
      onChange: (_id, value) => updateDraft({ discountText: value }),
      extra: (
        <div className="flex w-16 shrink-0 flex-col gap-1.5" role="radiogroup" aria-label={t('discount')}>
          {(['percent', 'amount'] as const).map((mode) => {
            const selected = draft.discountMode === mode;
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => updateDraft({ discountMode: mode })}
                className={`flex-1 rounded-xl border-2 text-lg font-bold cursor-pointer transition-colors ${
                  selected ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-500'
                }`}
              >
                {mode === 'percent' ? t('discountInPercent') : t('discountInRupees')}
              </button>
            );
          })}
        </div>
      ),
      summary: discountTooBig ? (
        <PadWarning message={t('discountInvalid')} />
      ) : (
        <PadSummary
          items={[
            { label: t('discount'), value: `− ${formatRupees(bill.discount, true)}`, tone: 'green' },
            { label: t('total'), value: formatRupees(bill.total, true) },
          ]}
        />
      ),
    };
  } else if (pad?.kind === 'received') {
    padView = {
      target: 'received',
      title: `${t('grandTotal')} ${formatRupees(bill.total, true)}`,
      fields: [
        {
          id: 'received',
          label: t('amountReceived'),
          value: draft.paidText,
          decimals: 2,
          prefix: '₹',
          placeholder: paiseToInput(bill.total),
          invalid: !receivedOk,
        },
      ],
      activeId: 'received',
      onChange: (_id, value) => updateDraft({ paidText: value }),
      summary: !receivedOk ? (
        <PadWarning message={t('receivedInvalid')} />
      ) : (
        <PadSummary
          items={[
            { label: t('receivedLabel'), value: formatRupees(received!, true), tone: 'green' },
            { label: t('balanceLeft'), value: formatRupees(balance, true), tone: balance > 0 ? 'red' : 'muted' },
          ]}
        />
      ),
    };
  }

  return (
    <PageShell fill>
      <PageHeader
        title={t('newSaleTitle')}
        icon={<ShoppingCart className="h-5 w-5" />}
        hideLanguage
        actions={
          <>
            <PrinterChip settings={settings} canEdit={isOwner} />
            {draft.lines.length > 0 && (
              <ActionButton
                tone="secondary"
                icon={<Eraser className="h-5 w-5" />}
                label={t('clearBill')}
                aria-label={t('clearBill')}
                title={t('clearBill')}
                onClick={() => setConfirmClear(true)}
                className="[&>span]:hidden @md:[&>span]:inline"
              />
            )}
          </>
        }
      />

      {/* Sideways tablets and wider: items on the left, payment and totals on the right. */}
      <div className="max-w-3xl space-y-3 @4xl:max-w-none @4xl:space-y-0 @4xl:grid @4xl:grid-cols-[minmax(0,1fr)_24rem] @4xl:gap-4 @4xl:items-start">
        <div className="space-y-3">
          {/* Customer (tap to change) and GST on/off, in one row */}
          <section className="flex items-stretch gap-2">
            <button
              type="button"
              onClick={() => setPartyPickerOpen(true)}
              className="min-w-0 flex-1 min-h-12 flex items-center gap-2.5 bg-white border border-slate-200 hover:border-amber-300 rounded-xl px-3 py-1.5 text-left cursor-pointer transition-colors"
            >
              <UserIcon className="h-5 w-5 shrink-0 text-slate-500" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-slate-900 truncate leading-tight">
                  {party ? party.name : t('cashSale')}
                </span>
                <span className="block text-xs text-slate-500 truncate">
                  {party
                    ? [party.phone, isInterstate ? t('otherStateNote') : ''].filter(Boolean).join(' · ') || t('customer')
                    : t('cashSaleHint')}
                </span>
              </span>
              <span className="shrink-0 flex items-center gap-1 text-xs font-bold text-amber-700">
                <Users className="h-4 w-4" />
                {t('change')}
              </span>
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={isGst}
              aria-label={t('gstBill')}
              onClick={() => setGst(!isGst)}
              className="shrink-0 min-h-12 flex items-center gap-2 bg-white border border-slate-200 hover:border-slate-300 rounded-xl px-3 cursor-pointer transition-colors"
            >
              <span className="text-sm font-bold text-slate-800">GST</span>
              <span className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${isGst ? 'bg-emerald-600' : 'bg-slate-300'}`}>
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    isGst ? 'translate-x-[22px]' : 'translate-x-0.5'
                  }`}
                />
              </span>
            </button>
          </section>

          {/* Lines: one tidy list */}
          <section className="space-y-2">
            {draft.lines.length === 0 ? (
              <div className="px-4 py-3 text-center text-sm text-slate-500 bg-white border border-dashed border-slate-300 rounded-xl">
                {t('noLinesYet')}
              </div>
            ) : (
              <ul className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
                {parsedLines.map(({ line, qty, rate }, index) => (
                  <SaleLineRow
                    key={line.key}
                    line={wholeBillGst !== null ? { ...line, gstRate: wholeBillGst } : line}
                    qtyValid={qty !== null && qty > 0}
                    rateValid={rate !== null && rate >= 0}
                    rateChanged={rate !== null && rate !== line.savedRate}
                    amount={bill.lines[index]?.gross ?? 0}
                    canUpdateRate={isOwner}
                    onChange={(patch) => updateLine(line.key, patch)}
                    onRemove={() => updateDraft({ lines: draft.lines.filter((l) => l.key !== line.key) })}
                    isGst={isGst}
                    padField={pad?.kind === 'line' && pad.key === line.key ? pad.field : null}
                    onOpenPad={(field) => setPad({ kind: 'line', key: line.key, field })}
                  />
                ))}
              </ul>
            )}
            <ActionButton
              tone="amber"
              icon={<Plus className="h-5 w-5" />}
              label={t('addItems')}
              onClick={() => setPickerOpen(true)}
              className="w-full"
            />
          </section>
        </div>

        <div className="space-y-3">
          {/* Discount, payment and totals in one card */}
          <section className="bg-white border border-slate-200 rounded-2xl p-4 space-y-4">
            <div className="grid grid-cols-1 @lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @4xl:grid-cols-1 gap-4">
              {/* Discount: the % or ₹ toggle sits inside the field */}
              <div className="space-y-2">
                <p className="text-sm font-bold text-slate-700">{t('discount')}</p>
                <div
                  className={`flex h-12 rounded-xl border overflow-hidden transition-colors ${
                    pad?.kind === 'discount' ? 'border-amber-500 bg-amber-50 ring-2 ring-amber-300' : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <span className="pl-3.5 flex items-center text-base font-semibold text-slate-400" aria-hidden="true">
                    {draft.discountMode === 'percent' ? '%' : '₹'}
                  </span>
                  <NumberBox
                    bare
                    value={draft.discountText}
                    placeholder="0"
                    label={t('discount')}
                    active={pad?.kind === 'discount'}
                    onOpen={() => setPad({ kind: 'discount' })}
                    className="h-full min-w-0 flex-1 rounded-none text-base"
                  />
                  <div className="flex border-l border-slate-200" role="radiogroup" aria-label={t('discount')}>
                    {(['percent', 'amount'] as const).map((mode) => {
                      const selected = draft.discountMode === mode;
                      return (
                        <button
                          key={mode}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => updateDraft({ discountMode: mode })}
                          className={`w-12 text-sm font-bold cursor-pointer transition-colors ${
                            selected
                              ? 'bg-white text-emerald-700 shadow-[inset_0_-2px_0_0_rgb(16,185,129)]'
                              : 'text-slate-500 hover:bg-slate-100'
                          }`}
                        >
                          {mode === 'percent' ? t('discountInPercent') : t('discountInRupees')}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* How the money came: cash or UPI. How much came is under the total. */}
              <div className="space-y-2">
                <p className="text-sm font-bold text-slate-700">{t('payment')}</p>
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('payment')}>
                  {(
                    [
                      { value: 'cash', icon: Banknote },
                      { value: 'upi', icon: Smartphone },
                    ] as const
                  ).map(({ value, icon: Icon }) => {
                    const selected = draft.paidMode === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => updateDraft({ paidMode: value })}
                        className={`min-h-12 px-2 flex items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold cursor-pointer transition-colors ${
                          selected
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-500'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                        }`}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {t(`pay_${value}`)}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* GST bill: one rate for the whole bill, added on top, or each item's own. */}
            {isGst && (
              <div className="space-y-2">
                <p className="text-sm font-bold text-slate-700">{t('gstWholeBill')}</p>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('gstWholeBill')}>
                  {[null, ...WHOLE_BILL_GST_RATES].map((rate) => {
                    const selected = wholeBillGst === rate;
                    return (
                      <button
                        key={rate ?? 'items'}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => updateDraft({ billGstRate: rate })}
                        className={`min-h-12 px-3.5 rounded-xl border text-sm font-semibold cursor-pointer transition-colors ${
                          selected
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-500'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                        }`}
                      >
                        {rate === null ? t('gstItemRates') : `${rate}%`}
                      </button>
                    );
                  })}
                </div>
                {wholeBillGst !== null && (
                  <p className="text-xs text-slate-500">{t('gstWholeBillHint', { rate: wholeBillGst })}</p>
                )}
              </div>
            )}

            <div className="border-t border-slate-200 pt-3 space-y-1.5">
              <TotalRow label={t('itemsTotal')} value={formatRupees(bill.itemsTotal, true)} small />
              {bill.discount > 0 && (
                <TotalRow
                  label={
                    discount?.kind === 'percent'
                      ? `${t('discount')} (${paiseToInput(discount.basisPoints)}%)`
                      : t('discount')
                  }
                  value={`− ${formatRupees(bill.discount, true)}`}
                  tone="emerald"
                  small
                />
              )}
              {showTaxOnTop && (
                <>
                  <TotalRow label={t('taxableValue')} value={formatRupees(bill.subtotal, true)} muted small />
                  {isInterstate ? (
                    <TotalRow label={`+ ${t('igst')}`} value={formatRupees(bill.igst, true)} small />
                  ) : (
                    <>
                      <TotalRow label={`+ ${t('cgst')}`} value={formatRupees(bill.cgst, true)} small />
                      <TotalRow label={`+ ${t('sgst')}`} value={formatRupees(bill.sgst, true)} small />
                    </>
                  )}
                </>
              )}
              {bill.roundOff !== 0 && (
                <TotalRow
                  label={t('roundOff')}
                  value={`${bill.roundOff > 0 ? '+' : '−'} ${formatRupees(Math.abs(bill.roundOff), true)}`}
                  muted
                  small
                />
              )}
            </div>

            <div className="border-t border-slate-200 pt-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-600">{t('grandTotal')}</p>
                {isGst && ratesIncludeGst && bill.tax > 0 && (
                  <p className="text-xs text-slate-400 mt-0.5">
                    {t('inclTax', {
                      taxes: isInterstate
                        ? `IGST ${formatRupees(bill.igst, true)}`
                        : `CGST ${formatRupees(bill.cgst, true)} + SGST ${formatRupees(bill.sgst, true)}`,
                    })}
                  </p>
                )}
              </div>
              <p className="shrink-0 text-3xl font-extrabold text-slate-900 tabular-nums tracking-tight">
                {formatRupees(bill.total, true)}
              </p>
            </div>

            {/* Received now and balance left: a balance makes this an udhaar bill. */}
            <div className="border-t border-slate-200 pt-3 space-y-2.5">
              <div className="space-y-1.5">
                <span className="block text-sm font-bold text-slate-700">{t('amountReceived')}</span>
                <div className="flex gap-2">
                  <div
                    className={`flex min-w-0 flex-1 h-12 rounded-xl border overflow-hidden transition-colors ${
                      pad?.kind === 'received' ? 'border-amber-500 bg-amber-50 ring-2 ring-amber-300' : 'border-slate-200 bg-slate-50'
                    }`}
                  >
                    <span className="pl-3.5 flex items-center text-base font-semibold text-slate-400" aria-hidden="true">
                      ₹
                    </span>
                    <NumberBox
                      bare
                      value={draft.paidText}
                      placeholder={paiseToInput(bill.total)}
                      label={t('amountReceived')}
                      active={pad?.kind === 'received'}
                      onOpen={() => setPad({ kind: 'received' })}
                      data-testid="amount-received"
                      className="h-full min-w-0 flex-1 rounded-none text-base"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => updateDraft({ paidText: '' })}
                    className={`shrink-0 min-h-12 px-3 rounded-xl border text-sm font-bold cursor-pointer ${
                      draft.paidText.trim() === '' ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-700'
                    }`}
                  >
                    {t('receivedFull')}
                  </button>
                  <button
                    type="button"
                    onClick={() => updateDraft({ paidText: '0' })}
                    className={`shrink-0 min-h-12 px-3 rounded-xl border text-sm font-bold cursor-pointer ${
                      received === 0 && bill.total > 0 ? 'border-red-400 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-700'
                    }`}
                  >
                    {t('receivedNone')}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-[#DCFCE7] px-3 py-2">
                  <p className="text-xs font-bold text-[#166534]">{t('receivedLabel')}</p>
                  <p className="text-lg font-extrabold text-[#166534] tabular-nums">{formatRupees(receivedOk ? received! : 0, true)}</p>
                </div>
                <div className={`rounded-xl px-3 py-2 ${balance > 0 ? 'bg-red-50' : 'bg-slate-50'}`} data-testid="balance-left">
                  <p className={`text-xs font-bold ${balance > 0 ? 'text-red-700' : 'text-slate-500'}`}>{t('balanceLeft')}</p>
                  <p className={`text-lg font-extrabold tabular-nums ${balance > 0 ? 'text-red-700' : 'text-slate-500'}`}>
                    {formatRupees(balance, true)}
                  </p>
                </div>
              </div>
              {!receivedOk && <p className="text-sm font-semibold text-red-700">{t('receivedInvalid')}</p>}
              {receivedOk && balance > 0 && !party && (
                <p className="text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  {t('needCustomerForCredit')}
                </p>
              )}

              {/* Customer scans this from the screen to pay by UPI. */}
              {draft.paidMode === 'upi' && receivedOk && received! > 0 && (
                settings.upiId ? (
                  <div className="flex items-center gap-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3" data-testid="upi-qr">
                    <div className="shrink-0 rounded-lg bg-white p-1.5 border border-slate-200">
                      <QrSvg data={upiLink(settings.upiId, settings.shopName, received)} className="h-36 w-36" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-600">{t('upiQrScan')}</p>
                      <p className="text-2xl font-extrabold text-slate-900 tabular-nums">{formatRupees(received!, true)}</p>
                      <p className="text-xs text-slate-500 break-all mt-1">{settings.upiId}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">{t('upiQrNoId')}</p>
                )
              )}
            </div>
          </section>

          {problem && <FormError message={problem.message} detail={problem.detail} />}
        </div>
      </div>

      {pad && <NumberPadSpacer />}

      {/* Always-visible total and save buttons */}
      {/* Phones: total on one line, buttons below. Wider screens: all in one row. */}
      <div className={`${keyboardOpen || pad ? 'hidden' : ''} sticky bottom-0 mt-auto shrink-0 -mx-3 sm:-mx-6 md:-mx-8 px-3 sm:px-6 md:px-8 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] bg-white/95 backdrop-blur border-t border-slate-200 shadow-[0_-8px_24px_-12px_rgba(15,23,42,0.25)]`}>
        <div className="max-w-3xl @4xl:max-w-none flex flex-col gap-1.5 @lg:flex-row @lg:items-center @lg:gap-3">
          <div className="flex items-baseline justify-between gap-3 @lg:mr-auto @lg:justify-start">
            <span className="text-base font-bold text-slate-600">{t('total')}</span>
            <span className="text-3xl leading-none font-extrabold text-slate-900 tabular-nums tracking-tight" data-testid="bill-total">
              {formatRupees(bill.total)}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 @lg:flex">
            <ActionButton
              tone="success"
              icon={<Printer className="h-5 w-5" />}
              label={t('saveAndPrint')}
              busy={isSaving}
              onClick={() => handleSave(true)}
              className="@lg:min-w-44"
            />
            <ActionButton
              tone="primary"
              icon={<Save className="h-5 w-5" />}
              label={t('saveOnly')}
              busy={isSaving}
              onClick={() => handleSave(false)}
              className="@lg:min-w-36"
            />
          </div>
        </div>
      </div>

      <NumberPad view={padView} onClose={() => setPad(null)} />

      <ItemPickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        items={items}
        categories={categories}
        saleCounts={saleCounts}
        lines={pickerLines}
        billTotal={bill.total}
        onPick={addItem}
        onChangeLine={(itemId, patch) => {
          const line = lineForItem(itemId);
          if (line) updateLine(line.key, patch);
        }}
        onRemove={removeItem}
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
  onRemove,
  isGst,
  padField,
  onOpenPad,
}: {
  line: DraftLine;
  qtyValid: boolean;
  rateValid: boolean;
  rateChanged: boolean;
  amount: Paise;
  canUpdateRate: boolean;
  onChange: (patch: Partial<DraftLine>) => void;
  onRemove: () => void;
  isGst: boolean;
  /** The keypad is open for this line's quantity or rate. */
  padField: 'qty' | 'rate' | null;
  onOpenPad: (field: 'qty' | 'rate') => void;
}) {
  const { t, language } = useT();
  const asItem = { name: line.name, nameHi: line.nameHi } as ShopItem;
  const subtitle = [unitLabel(t, line.unit), isGst ? `GST ${line.gstRate}%` : ''].filter(Boolean).join(' · ');
  return (
    <li className={`px-3 py-2 space-y-1 transition-colors ${padField ? 'bg-amber-50/70' : ''}`}>
      {/* Wide screens: one row. Phones: name on top, boxes below. */}
      <div className="flex flex-wrap @lg:flex-nowrap items-center gap-x-2 gap-y-1">
        <div className="min-w-0 flex-1 basis-full @lg:basis-auto">
          <p className="text-sm font-semibold text-slate-900 leading-tight truncate">{displayName(asItem, language)}</p>
          {subtitle && <p className="text-[11px] text-slate-500 truncate">{subtitle}</p>}
        </div>
        <NumberBox
          value={line.qtyText}
          label={t('qty')}
          active={padField === 'qty'}
          invalid={!qtyValid}
          center
          onOpen={() => onOpenPad('qty')}
          className="h-10 w-16 text-base"
        />
        <span className="text-xs text-slate-400" aria-hidden="true">
          ×
        </span>
        <NumberBox
          value={line.rateText}
          label={t('rate')}
          prefix="₹"
          active={padField === 'rate'}
          invalid={!rateValid}
          changed={rateChanged}
          onOpen={() => onOpenPad('rate')}
          className="h-10 w-28 text-base"
        />
        <p className="ml-auto @lg:ml-0 @lg:w-28 shrink-0 text-right text-sm font-bold text-slate-900 tabular-nums">
          {formatRupees(amount, true)}
        </p>
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('remove')}
          title={t('remove')}
          className="h-10 w-10 shrink-0 flex items-center justify-center rounded-lg text-red-600 hover:bg-red-50 cursor-pointer"
        >
          <Trash2 className="h-5 w-5" />
        </button>
      </div>

      {rateChanged && rateValid && canUpdateRate && (
        <label className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1 cursor-pointer">
          <input
            type="checkbox"
            checked={line.updateRate}
            onChange={(e) => onChange({ updateRate: e.target.checked })}
            className="h-4 w-4 accent-amber-600 shrink-0"
          />
          <span className="text-xs font-semibold text-amber-900">
            {t('updateSavedRate', { old: formatRupees(line.savedRate) })}
          </span>
        </label>
      )}
    </li>
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

function SavedPanel({
  saved,
  printState,
  onPrint,
  onPreview,
  onNewBill,
  onViewBill,
  shareSlot,
}: {
  saved: SavedBill;
  shareSlot: React.ReactNode;
  printState: 'idle' | 'printing' | PrintResult;
  onPrint: () => void;
  onPreview: () => void;
  onNewBill: () => void;
  onViewBill: () => void;
}) {
  const { t } = useT();
  const { invoice, uploaded } = saved;
  const printFailed = typeof printState === 'object' && !printState.ok;
  return (
    <div className="max-w-xl bg-white border border-emerald-200 rounded-2xl p-6 text-center space-y-4 shadow-sm">
      <CheckCircle2 className="h-14 w-14 text-emerald-600 mx-auto" />
      <div>
        <p className="text-xl font-bold text-slate-900">{t('savedTitle')}</p>
        <p className="text-2xl font-extrabold text-slate-900 mt-1 tabular-nums" data-testid="saved-bill-number">
          {billLabel(invoice.billNumber) ?? t('numberOnUpload')}
        </p>
        <p className="text-4xl font-extrabold text-emerald-700 mt-2 tabular-nums">{formatRupees(invoice.total)}</p>
        <p className="text-base text-slate-600 mt-1">
          {invoice.partyName || t('cashSale')} · {t(`pay_${invoice.paymentMode}`)}
        </p>
        {invoice.total > invoice.paidAmount && (
          <p className="mt-2 inline-block rounded-full bg-red-50 border border-red-200 px-3 py-1 text-sm font-bold text-red-700 tabular-nums">
            {t('receivedLabel')} {formatRupees(invoice.paidAmount)} · {t('balanceLeft')} {formatRupees(invoice.total - invoice.paidAmount)}
          </p>
        )}
        {!uploaded && (
          <p className="mt-3 inline-block px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-sm font-bold text-amber-800">
            {t('waitingUpload')}
          </p>
        )}
        {printState !== 'idle' && (
          <p
            role="status"
            data-testid="print-status"
            className={`mt-3 rounded-xl px-3 py-2 text-sm font-semibold ${
              printState === 'printing'
                ? 'bg-slate-100 text-slate-600'
                : printFailed
                  ? 'bg-red-50 text-red-700'
                  : 'bg-[#DCFCE7] text-[#166534]'
            }`}
          >
            {printState === 'printing'
              ? t('printing')
              : [t(printMessageKey(printState)), printDetail(printState)].filter(Boolean).join(' ')}
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <ActionButton
          size="lg"
          tone="success"
          icon={<Printer className="h-5 w-5" />}
          label={printFailed ? t('retryPrint') : printState === 'idle' ? t('print') : t('printAgain')}
          busy={printState === 'printing'}
          onClick={onPrint}
        />
        <ActionButton size="lg" tone="secondary" icon={<Eye className="h-5 w-5" />} label={t('printPreview')} onClick={onPreview} />
        <ActionButton size="lg" icon={<Plus className="h-6 w-6" />} label={t('newBill')} onClick={onNewBill} />
        <ActionButton size="lg" tone="secondary" icon={<ReceiptText className="h-5 w-5" />} label={t('viewBill')} onClick={onViewBill} />
      </div>
      {shareSlot}
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

