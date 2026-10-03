import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CloudOff,
  Loader2,
  ReceiptText,
  RefreshCw,
  Upload,
  User as UserIcon,
  Users,
  XCircle,
} from 'lucide-react';
import type { User } from '../../types';
import { AppModal } from '../../components/AppModal';
import { DateRangePicker, type DateRangeValue } from '../../components/DateRangePicker';
import { describeDbError, type FriendlyError } from '../../lib/dbErrors';
import { fetchRecentSales, fetchSaleByClientId, fetchSales, fetchShopParties, fetchUserNames } from '../db';
import { loadWithCache } from '../cache';
import { formatBillDate, formatIstTime, istToday } from '../fy';
import { useT } from '../i18n';
import { unitLabel } from '../labels';
import { formatQty, formatRupees, mulDivRound, paiseToInput } from '../money';
import { listQueuedSales, onBillsSynced, syncOutbox } from '../outbox';
import type { ShopInvoice, ShopParty } from '../types';
import { ActionButton, ErrorState, InfoRow, LoadingState, PageHeader, PageShell, PickerField } from './ui';
import { OPEN_BILL_KEY } from './NewSaleSection';
import { ReceiptPreviewModal, printDetail, printMessageKey } from './PrintUi';
import { ShareBillButton } from './ShareBill';
import { printBill, receiptLinesFor } from '../print/printBill';
import { connectPrinter } from '../print/printer';
import { fetchShopSettings } from '../db';
import type { ShopSettings } from '../types';
import { Eye, MoreVertical, Printer } from 'lucide-react';

interface SalesListSectionProps {
  currentUser: User;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

type Preset = 'today' | 'yesterday' | 'last7Days' | 'thisMonth' | 'custom';

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function presetRange(preset: Exclude<Preset, 'custom'>): DateRangeValue {
  const today = istToday();
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday':
      return { from: shiftDays(today, -1), to: shiftDays(today, -1) };
    case 'last7Days':
      return { from: shiftDays(today, -6), to: today };
    case 'thisMonth':
      return { from: `${today.slice(0, 7)}-01`, to: today };
  }
}

const ALL_PARTIES = '';

/** Staff see only this many of the newest bills. */
const STAFF_BILL_LIMIT = 5;

export function SalesListSection({ currentUser, showToast }: SalesListSectionProps) {
  const isStaff = currentUser.role !== 'Admin';
  const { t } = useT();
  const [preset, setPreset] = useState<Preset>('today');
  const [range, setRange] = useState<DateRangeValue>(() => presetRange('today'));
  const [partyId, setPartyId] = useState(ALL_PARTIES);
  const [parties, setParties] = useState<ShopParty[]>([]);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [serverBills, setServerBills] = useState<ShopInvoice[]>([]);
  const [queuedBills, setQueuedBills] = useState<ShopInvoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<FriendlyError | null>(null);
  const [openClientId, setOpenClientId] = useState<string | null>(() => {
    try {
      const id = sessionStorage.getItem(OPEN_BILL_KEY);
      sessionStorage.removeItem(OPEN_BILL_KEY);
      return id;
    } catch {
      return null;
    }
  });
  const [isRetrying, setIsRetrying] = useState(false);
  const [settings, setSettings] = useState<ShopSettings | null>(null);

  const loadBills = async () => {
    setIsLoading(true);
    setLoadError(null);
    const queued = await listQueuedSales();
    setQueuedBills(queued);
    try {
      setServerBills(
        isStaff
          ? await fetchRecentSales(STAFF_BILL_LIMIT)
          : await fetchSales({ from: range.from, to: range.to, partyId: partyId || null })
      );
    } catch (err) {
      // Bills waiting on this phone can still be shown without the internet.
      if (queued.length === 0) setLoadError(describeDbError(err, 'Sale bills could not be loaded'));
      setServerBills([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadWithCache('settings', fetchShopSettings)
      .then((r) => setSettings(r.data))
      .catch(() => {});
    loadWithCache('parties', fetchShopParties)
      .then((r) => setParties(r.data))
      .catch(() => {});
    fetchUserNames()
      .then(setUserNames)
      .catch(() => {});
  }, []);

  useEffect(() => {
    void loadBills();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, partyId]);

  // A bill that finishes uploading moves from "waiting" to the server list.
  useEffect(() => onBillsSynced(() => void loadBills()), [range.from, range.to, partyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const bills = useMemo(() => {
    const onServer = new Set(serverBills.map((b) => b.clientId));
    const waiting = queuedBills.filter(
      (b) =>
        !onServer.has(b.clientId) &&
        (isStaff || (b.billDate >= range.from && b.billDate <= range.to && (!partyId || b.partyId === partyId)))
    );
    const all = [...waiting, ...serverBills];
    return isStaff ? all.slice(0, STAFF_BILL_LIMIT) : all;
  }, [serverBills, queuedBills, range, partyId, isStaff]);

  const activeBills = bills.filter((b) => b.status === 'active');
  const total = activeBills.reduce((sum, b) => sum + b.total, 0);
  const openBill = openClientId ? bills.find((b) => b.clientId === openClientId) ?? null : null;

  const choosePreset = (next: Preset) => {
    setPreset(next);
    if (next !== 'custom') setRange(presetRange(next));
  };

  const retryUploads = async () => {
    setIsRetrying(true);
    try {
      const done = await syncOutbox(true);
      if (done.length) showToast(t('billSaved', { number: done.map((d) => d.billNumber).join(', ') }), 'success');
      await loadBills();
    } finally {
      setIsRetrying(false);
    }
  };

  if (loadError) return <ErrorState error={loadError} onRetry={loadBills} />;

  const presets: { id: Preset; label: string }[] = [
    { id: 'today', label: t('today') },
    { id: 'yesterday', label: t('yesterday') },
    { id: 'last7Days', label: t('last7Days') },
    { id: 'thisMonth', label: t('thisMonth') },
    { id: 'custom', label: t('customDates') },
  ];

  return (
    <PageShell>
      <PageHeader
        title={t('salesTitle')}
        icon={<ReceiptText className="h-5 w-5" />}
        actions={
          <ActionButton tone="secondary" icon={<RefreshCw className="h-5 w-5" />} label={t('refresh')} onClick={loadBills} />
        }
      />

      {!isStaff && (
      <div className="space-y-2">
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => choosePreset(p.id)}
              className={`shrink-0 min-h-12 px-4 flex items-center gap-1.5 rounded-full border text-sm font-bold cursor-pointer whitespace-nowrap ${
                preset === p.id ? 'bg-[#0F172A] border-[#0F172A] text-white' : 'bg-white border-slate-200 text-slate-700'
              }`}
            >
              {p.id === 'custom' && <CalendarDays className="h-4 w-4" />}
              {p.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 @xl:grid-cols-2 gap-2">
          {preset === 'custom' && (
            <DateRangePicker value={range} onChange={(value) => setRange(value)} disableFuture />
          )}
          <PickerField
            label={t('customer')}
            title={t('chooseCustomer')}
            icon={<Users className="h-5 w-5" />}
            value={partyId}
            options={[
              { value: ALL_PARTIES, label: t('allCustomers') },
              ...parties.map((p) => ({ value: p.id, label: p.name, description: p.phone })),
            ]}
            onChange={setPartyId}
            searchable
          />
        </div>
      </div>
      )}

      <div className="flex items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3">
        <span className="text-base font-semibold text-slate-600">
          {isStaff ? (
            t('lastBills', { n: STAFF_BILL_LIMIT })
          ) : (
            <>
              {formatBillDate(range.from)}
              {range.to !== range.from && ` – ${formatBillDate(range.to)}`}
            </>
          )}
        </span>
        {/* Staff do not see the money total, only the owner does. */}
        {!isStaff && (
          <span className="text-lg font-extrabold text-slate-900 tabular-nums">
            {t('billsSummary', { n: activeBills.length, amount: formatRupees(total) })}
          </span>
        )}
      </div>

      {queuedBills.some((b) => b.syncState === 'failed') && (
        <ActionButton
          tone="danger"
          icon={<Upload className="h-5 w-5" />}
          label={t('retryUpload')}
          busy={isRetrying}
          onClick={retryUploads}
          className="w-full"
        />
      )}

      {isLoading ? (
        <LoadingState />
      ) : bills.length === 0 ? (
        <div className="p-8 text-center text-slate-500 text-base bg-white border border-slate-200 rounded-xl">
          {t('noBills')}
        </div>
      ) : (
        <ul className="space-y-2 @3xl:grid @3xl:grid-cols-2 @3xl:gap-3 @3xl:space-y-0">
          {bills.map((bill) => (
            <BillCard
              key={bill.clientId}
              bill={bill}
              settings={settings}
              phone={bill.partyId ? parties.find((p) => p.id === bill.partyId)?.phone : undefined}
              showToast={showToast}
              onOpen={() => setOpenClientId(bill.clientId)}
            />
          ))}
        </ul>
      )}

      <BillDetailModal
        bill={openBill}
        userNames={userNames}
        partyPhone={openBill?.partyId ? parties.find((p) => p.id === openBill.partyId)?.phone : undefined}
        showToast={showToast}
        onClose={() => setOpenClientId(null)}
      />
    </PageShell>
  );
}

// --- One bill in the list ---

type PayStatus = 'paid' | 'unpaid' | 'partial' | 'cancelled';

function payStatus(bill: ShopInvoice): PayStatus {
  if (bill.status === 'cancelled') return 'cancelled';
  if (bill.paidAmount >= bill.total) return 'paid';
  return bill.paidAmount > 0 ? 'partial' : 'unpaid';
}

const STATUS_STYLE: Record<PayStatus, string> = {
  paid: 'bg-emerald-100 text-emerald-700',
  unpaid: 'bg-red-100 text-red-700',
  partial: 'bg-amber-100 text-amber-800',
  cancelled: 'bg-slate-200 text-slate-600',
};

/** '2026-10-01' -> '01 Oct, 26' */
function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return iso;
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${String(d.getDate()).padStart(2, '0')} ${month}, ${String(d.getFullYear()).slice(-2)}`;
}

/** Bills in the list have no lines; load them before printing or sharing. */
async function withLines(bill: ShopInvoice): Promise<ShopInvoice> {
  if (bill.lines.length > 0) return bill;
  const full = await fetchSaleByClientId(bill.clientId);
  if (!full) throw new Error('This bill could not be found.');
  return full;
}

interface BillCardProps {
  bill: ShopInvoice;
  settings: ShopSettings | null;
  phone?: string;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onOpen: () => void;
}

function BillCard({ bill, settings, phone, showToast, onOpen }: BillCardProps) {
  const { t } = useT();
  const [printing, setPrinting] = useState(false);
  const status = payStatus(bill);
  const balance = bill.status === 'cancelled' ? 0 : Math.max(0, bill.total - bill.paidAmount);
  const seq = bill.billNumber ? bill.billNumber.split('/').pop() : null;

  const print = async () => {
    if (!settings) return;
    setPrinting(true);
    try {
      // Connect (or open the printer list) while the tap still counts, as the bill loads.
      const [full, ready] = await Promise.all([withLines(bill), connectPrinter()]);
      const result = ready.ok ? await printBill(full, settings) : ready;
      showToast(
        [t(printMessageKey(result)), printDetail(result)].filter(Boolean).join(' '),
        result.ok ? 'success' : 'error'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setPrinting(false);
    }
  };

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen();
          }
        }}
        className={`bg-white border rounded-xl pl-3.5 pr-1.5 pt-2.5 pb-1 cursor-pointer transition-colors hover:border-amber-300 shadow-xs ${
          bill.syncState === 'failed' ? 'border-red-300' : 'border-slate-200'
        }`}
      >
        <div className="flex items-start justify-between gap-2 pr-2">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-base font-semibold text-slate-900 truncate">{bill.partyName || t('cashSale')}</p>
            <span className={`shrink-0 px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wide ${STATUS_STYLE[status]}`}>
              {t(`status_${status}`)}
            </span>
          </div>
          <span className="shrink-0 text-xs text-slate-400 pt-0.5">
            {t('saleLabel')}
            {seq ? ` #${seq}` : ''}
          </span>
        </div>

        <div className="flex items-baseline justify-between gap-2 pr-2">
          <p
            className={`text-lg font-bold tabular-nums ${
              status === 'cancelled' ? 'line-through text-slate-400' : 'text-slate-900'
            }`}
          >
            {formatRupees(bill.total)}
          </p>
          <span className="shrink-0 text-xs text-slate-400">{shortDate(bill.billDate)}</span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className={`text-sm ${balance > 0 ? 'text-red-600 font-semibold' : 'text-slate-400'}`}>
              {t('balanceLabel', { amount: formatRupees(balance) })}
            </p>
            <SyncBadge bill={bill} />
          </div>
          {/* Clicks here (and inside the share sheet) must not open the bill. */}
          <div className="flex items-center shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={print}
              disabled={!settings || printing}
              aria-label={t('print')}
              title={t('print')}
              className="h-10 w-10 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 cursor-pointer disabled:opacity-40"
            >
              {printing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Printer className="h-5 w-5" />}
            </button>
            <ShareBillButton
              bill={bill}
              settings={settings}
              phone={phone}
              showToast={showToast}
              variant="icon"
              resolveBill={() => withLines(bill)}
            />
            <button
              type="button"
              onClick={onOpen}
              aria-label={t('openBill')}
              title={t('openBill')}
              className="h-10 w-10 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 cursor-pointer"
            >
              <MoreVertical className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

function SyncBadge({ bill }: { bill: ShopInvoice }) {
  const { t } = useT();
  if (bill.status === 'cancelled') {
    return (
      <span className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold rounded-full bg-slate-100 text-slate-600">
        <XCircle className="h-3.5 w-3.5" />
        {t('cancelled')}
      </span>
    );
  }
  if (bill.syncState === 'pending') {
    return (
      <span className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold rounded-full bg-amber-50 text-amber-800 border border-amber-200">
        <CloudOff className="h-3.5 w-3.5" />
        {t('waitingUpload')}
      </span>
    );
  }
  if (bill.syncState === 'failed') {
    return (
      <span className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold rounded-full bg-red-50 text-red-700 border border-red-200">
        <AlertTriangle className="h-3.5 w-3.5" />
        {t('uploadFailed')}
      </span>
    );
  }
  return null;
}

// --- Bill detail ---

interface BillDetailModalProps {
  bill: ShopInvoice | null;
  userNames: Record<string, string>;
  /** Customer phone for the WhatsApp message. */
  partyPhone?: string;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onClose: () => void;
}

function BillDetailModal({ bill, userNames, partyPhone, showToast, onClose }: BillDetailModalProps) {
  const { t } = useT();
  const [full, setFull] = useState<ShopInvoice | null>(null);
  const [problem, setProblem] = useState<FriendlyError | null>(null);
  const [settings, setSettings] = useState<ShopSettings | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printMessage, setPrintMessage] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    loadWithCache('settings', fetchShopSettings)
      .then((r) => setSettings(r.data))
      .catch(() => {});
  }, []);

  useEffect(() => setPrintMessage(null), [bill?.clientId]);

  const reprint = async () => {
    if (!full || !settings) return;
    setPreviewOpen(false);
    setPrinting(true);
    const result = await printBill(full, settings);
    setPrinting(false);
    setPrintMessage({ text: [t(printMessageKey(result)), printDetail(result)].filter(Boolean).join(' '), ok: result.ok });
  };

  useEffect(() => {
    setFull(null);
    setProblem(null);
    if (!bill) return;
    // Bills still on the phone already carry their lines.
    if (bill.syncState !== 'synced') {
      setFull(bill);
      return;
    }
    let cancelled = false;
    fetchSaleByClientId(bill.clientId)
      .then((result) => {
        if (cancelled) return;
        if (result) setFull(result);
        else setProblem({ message: t('billNotFound'), detail: '' });
      })
      .catch((err) => !cancelled && setProblem(describeDbError(err, t('billNotFound'))));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bill?.clientId, bill?.syncState]);

  return (
    <AppModal
      open={Boolean(bill)}
      onClose={onClose}
      title={bill?.billNumber ?? t('numberOnUpload')}
      description={bill ? `${formatBillDate(bill.billDate)} · ${formatIstTime(bill.createdAt)}` : undefined}
      icon={<ReceiptText className="h-5 w-5" />}
    >
      {problem ? (
        <p className="text-base text-red-700">{problem.message}</p>
      ) : !full ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-amber-600" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <ActionButton
              tone="success"
              icon={<Printer className="h-5 w-5" />}
              label={t('print')}
              busy={printing}
              disabled={!settings}
              onClick={reprint}
            />
            <ActionButton
              tone="secondary"
              icon={<Eye className="h-5 w-5" />}
              label={t('printPreview')}
              disabled={!settings}
              onClick={() => setPreviewOpen(true)}
            />
          </div>
          <ShareBillButton
            bill={full}
            settings={settings}
            phone={partyPhone}
            showToast={showToast}
            className="w-full"
          />
          {printMessage && (
            <p
              role="status"
              className={`rounded-xl px-3 py-2 text-sm font-semibold ${
                printMessage.ok ? 'bg-[#DCFCE7] text-[#166534]' : 'bg-red-50 text-red-700'
              }`}
            >
              {printMessage.text}
            </p>
          )}
          <BillDetailBody bill={full} userNames={userNames} />
        </div>
      )}
      {full && settings && (
        <ReceiptPreviewModal
          open={previewOpen}
          lines={receiptLinesFor(full, settings)}
          widthMm={settings.printerWidthMm}
          onClose={() => setPreviewOpen(false)}
          onPrint={reprint}
          busy={printing}
        />
      )}
    </AppModal>
  );
}

function BillDetailBody({ bill, userNames }: { bill: ShopInvoice; userNames: Record<string, string> }) {
  const { t } = useT();
  const udhaar = bill.total - bill.paidAmount;
  const taxOnTop = bill.isGst && !bill.ratesIncludeGst;

  // Rate-wise GST, split the same way the bill was worked out.
  const byRate = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number }>();
  for (const line of bill.lines) {
    if (line.taxAmount === 0 && line.gstRate === 0) continue;
    const entry = byRate.get(line.gstRate) ?? { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    entry.taxable += line.taxableAmount;
    if (bill.isInterstate) entry.igst += line.taxAmount;
    else {
      const sgst = Math.floor(line.taxAmount / 2);
      entry.sgst += sgst;
      entry.cgst += line.taxAmount - sgst;
    }
    byRate.set(line.gstRate, entry);
  }

  return (
    <div className="space-y-5" data-testid="bill-detail">
      {bill.syncState === 'failed' && bill.syncError && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-3.5 text-sm rounded-xl leading-relaxed">
          <p className="font-bold">{t('uploadFailed')}</p>
          <p>{bill.syncError}</p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Tile label={t('total')} value={formatRupees(bill.total)} />
        <Tile label={t('paid')} value={formatRupees(bill.paidAmount)} tone="emerald" />
        <Tile label={t('udhaar')} value={formatRupees(udhaar)} tone={udhaar > 0 ? 'red' : 'default'} />
      </div>

      <div className="space-y-2 text-sm">
        <InfoRow
          label={t('customer')}
          value={
            <span className="inline-flex items-center gap-1.5">
              <UserIcon className="h-4 w-4 text-slate-400" />
              {bill.partyName || t('cashSale')}
            </span>
          }
        />
        {bill.partyGstin && <InfoRow label={t('partyGstin')} value={bill.partyGstin} />}
        <InfoRow
          label={t('paymentType')}
          value={`${t(`pay_${bill.paymentMode}`)}${bill.paidMode ? ` (${t(`pay_${bill.paidMode}`)})` : ''}`}
        />
        <InfoRow label={t('gstBill')} value={bill.isGst ? (bill.isInterstate ? `${t('yes')} · IGST` : t('yes')) : t('no')} />
        {bill.createdBy && userNames[bill.createdBy] && <InfoRow label={t('madeBy')} value={userNames[bill.createdBy]} />}
      </div>

      <div>
        <p className="text-sm font-semibold text-slate-700 mb-2">{t('items')}</p>
        <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden" data-testid="bill-lines">
          {bill.lines.map((line, i) => (
            <li key={i} className="flex items-start justify-between gap-3 px-3 py-2.5 bg-white">
              <div className="min-w-0">
                <p className="text-base font-semibold text-slate-900">{line.itemName}</p>
                <p className="text-sm text-slate-500 tabular-nums">
                  {formatQty(line.qty)} {unitLabel(t, line.unit)} × {formatRupees(line.rate, true)}
                  {bill.isGst && ` · GST ${line.gstRate}%`}
                  {line.hsn && ` · ${t('hsnShort')} ${line.hsn}`}
                </p>
              </div>
              <span className="shrink-0 text-base font-bold text-slate-900 tabular-nums">
                {formatRupees(mulDivRound(line.qty, line.rate, 1000), true)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-1.5 text-base" data-testid="bill-totals">
        <Row label={t('itemsTotal')} value={formatRupees(bill.itemsTotal, true)} />
        {bill.discount > 0 && (
          <Row
            label={
              bill.discountPercent !== null
                ? `${t('discount')} (${paiseToInput(bill.discountPercent)}%)`
                : t('discount')
            }
            value={`− ${formatRupees(bill.discount, true)}`}
          />
        )}
        {bill.isGst && <Row label={t('taxableValue')} value={formatRupees(bill.subtotal, true)} muted={!taxOnTop} />}
        {bill.isGst &&
          (bill.isInterstate ? (
            <Row label={taxOnTop ? `+ ${t('igst')}` : t('igst')} value={formatRupees(bill.igst, true)} muted={!taxOnTop} />
          ) : (
            <>
              <Row label={taxOnTop ? `+ ${t('cgst')}` : t('cgst')} value={formatRupees(bill.cgst, true)} muted={!taxOnTop} />
              <Row label={taxOnTop ? `+ ${t('sgst')}` : t('sgst')} value={formatRupees(bill.sgst, true)} muted={!taxOnTop} />
            </>
          ))}
        {bill.roundOff !== 0 && (
          <Row
            label={t('roundOff')}
            value={`${bill.roundOff > 0 ? '+' : '−'} ${formatRupees(Math.abs(bill.roundOff), true)}`}
            muted
          />
        )}
        <div className="flex items-center justify-between pt-2 mt-1 border-t border-slate-200">
          <span className="text-lg font-bold text-slate-700">{t('total')}</span>
          <span className="text-3xl font-extrabold text-slate-900 tabular-nums">{formatRupees(bill.total)}</span>
        </div>
        {bill.isGst && bill.ratesIncludeGst && <p className="text-xs text-slate-500">{t('gstIncluded')}</p>}
      </div>

      {byRate.size > 0 && (
        <div>
          <p className="text-sm font-semibold text-slate-700 mb-2">{t('gstBreakup')}</p>
          <div className="border border-slate-200 rounded-xl overflow-hidden text-sm">
            <table className="w-full tabular-nums">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="text-left font-semibold px-3 py-2">GST</th>
                  <th className="text-right font-semibold px-3 py-2">{t('taxableValue')}</th>
                  {bill.isInterstate ? (
                    <th className="text-right font-semibold px-3 py-2">{t('igst')}</th>
                  ) : (
                    <>
                      <th className="text-right font-semibold px-3 py-2">{t('cgst')}</th>
                      <th className="text-right font-semibold px-3 py-2">{t('sgst')}</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {Array.from(byRate.entries())
                  .sort((a, b) => a[0] - b[0])
                  .map(([rate, e]) => (
                    <tr key={rate}>
                      <td className="px-3 py-2 font-semibold">{rate}%</td>
                      <td className="px-3 py-2 text-right">{formatRupees(e.taxable, true)}</td>
                      {bill.isInterstate ? (
                        <td className="px-3 py-2 text-right">{formatRupees(e.igst, true)}</td>
                      ) : (
                        <>
                          <td className="px-3 py-2 text-right">{formatRupees(e.cgst, true)}</td>
                          <td className="px-3 py-2 text-right">{formatRupees(e.sgst, true)}</td>
                        </>
                      )}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'emerald' | 'red' }) {
  const styles = {
    default: 'bg-slate-50 border-slate-200 text-slate-900',
    emerald: 'bg-[#DCFCE7] border-[#BBF7D0] text-[#166534]',
    red: 'bg-red-50 border-red-200 text-red-700',
  }[tone];
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${styles}`}>
      <p className="text-xs opacity-80">{label}</p>
      <p className="text-lg font-extrabold tabular-nums truncate">{value}</p>
    </div>
  );
}

function Row({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={muted ? 'text-slate-500 text-sm' : 'text-slate-700'}>{label}</span>
      <span className={`tabular-nums font-semibold ${muted ? 'text-slate-500 text-sm' : 'text-slate-900'}`}>{value}</span>
    </div>
  );
}
