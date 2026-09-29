import React, { useEffect, useMemo, useState } from 'react';
import {
  Image as ImageIcon,
  Layers,
  Loader2,
  ReceiptText,
  Search,
  Truck,
  Wallet,
  X,
} from 'lucide-react';
import { BillPayment, PurchaseBill, TransportBill } from '../types';
import {
  fetchBillPayments,
  fetchPurchaseBills,
  fetchTransportBills,
  fetchTransportPayments,
} from '../lib/database';
import { describeDbError, FriendlyError } from '../lib/dbErrors';
import { DateRangePicker, DateRangeValue } from './DateRangePicker';
import { ImageViewer } from './ImageViewer';

interface PaymentsSectionProps {
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

type Kind = 'party' | 'transport';

interface PaidBill {
  billNo: string;
  billDate: string;
  billAmount: number;
  share: number;
}

/**
 * One real payment as it left the shop. A combined payment is stored as one
 * share per bill; here those shares are put back together so the ledger shows
 * the ₹42,000 that was actually sent, not three unrelated entries.
 */
interface PaymentRecord {
  key: string;
  kind: Kind;
  party: string;
  paidOn: string;
  total: number;
  method: BillPayment['method'];
  reference: string;
  bankName: string;
  photoUrl: string | null;
  bills: PaidBill[];
  combined: boolean;
  createdAt: string;
}

interface PhotoToView {
  url: string;
  title: string;
  subtitle: string;
  downloadName: string;
}

function toPaise(amount: number): number {
  return Math.round(amount * 100);
}

function formatMoney(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function formatDate(isoDate: string): string {
  if (!isoDate) return '—';
  const date = new Date(isoDate + 'T00:00:00');
  if (isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function monthLabel(isoDate: string): string {
  if (!isoDate) return 'No date';
  const date = new Date(isoDate.slice(0, 7) + '-01T00:00:00');
  if (isNaN(date.getTime())) return 'No date';
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function buildRecords(
  purchaseBills: PurchaseBill[],
  billPayments: BillPayment[],
  transportBills: TransportBill[],
  transportPayments: BillPayment[]
): PaymentRecord[] {
  const billById = new Map(purchaseBills.map((b) => [b.id, b]));
  const transportById = new Map(transportBills.map((b) => [b.id, b]));
  const records: PaymentRecord[] = [];
  const groups = new Map<string, PaymentRecord>();

  for (const payment of billPayments) {
    const bill = billById.get(payment.billId);
    const paidBill: PaidBill = {
      billNo: bill?.billNo || '—',
      billDate: bill?.billDate ?? '',
      billAmount: bill?.netAmount ?? 0,
      share: payment.amount,
    };

    const existing = payment.groupId ? groups.get(payment.groupId) : undefined;
    if (existing) {
      existing.total = (toPaise(existing.total) + toPaise(payment.amount)) / 100;
      existing.bills.push(paidBill);
      existing.combined = true;
      continue;
    }

    const record: PaymentRecord = {
      key: payment.groupId ?? payment.id,
      kind: 'party',
      party: bill?.firmName.trim() || 'Removed bill',
      paidOn: payment.paidOn,
      total: payment.amount,
      method: payment.method,
      reference: payment.reference,
      bankName: payment.bankName,
      photoUrl: payment.photoUrl,
      bills: [paidBill],
      combined: false,
      createdAt: payment.createdAt,
    };
    if (payment.groupId) groups.set(payment.groupId, record);
    records.push(record);
  }

  for (const payment of transportPayments) {
    const bill = transportById.get(payment.billId);
    records.push({
      key: payment.id,
      kind: 'transport',
      party: bill?.transportName.trim() || 'Removed bilty',
      paidOn: payment.paidOn,
      total: payment.amount,
      method: payment.method,
      reference: payment.reference,
      bankName: payment.bankName,
      photoUrl: payment.photoUrl,
      bills: [
        {
          billNo: bill?.biltyNo || '—',
          billDate: bill?.receivedDate ?? '',
          billAmount: bill?.amount ?? 0,
          share: payment.amount,
        },
      ],
      combined: false,
      createdAt: payment.createdAt,
    });
  }

  for (const record of records) {
    record.bills.sort((a, b) => a.billDate.localeCompare(b.billDate));
  }

  // Newest payment first; entries saved the same day keep the order they were made.
  return records.sort(
    (a, b) =>
      (b.paidOn || '').localeCompare(a.paidOn || '') || b.createdAt.localeCompare(a.createdAt)
  );
}

export function PaymentsSection({ showToast }: PaymentsSectionProps) {
  const [records, setRecords] = useState<PaymentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<FriendlyError | null>(null);

  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | Kind>('all');
  const [shapeFilter, setShapeFilter] = useState<'all' | 'combined' | 'single'>('all');
  const [range, setRange] = useState<DateRangeValue>({ from: '', to: '' });
  const [viewingPhoto, setViewingPhoto] = useState<PhotoToView | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [bills, payments] = await Promise.all([fetchPurchaseBills(), fetchBillPayments()]);
      // Transport payments are extra: if that table is missing or fails, the
      // party payments are still worth showing.
      const [transportBills, transportPayments] = await Promise.allSettled([
        fetchTransportBills(),
        fetchTransportPayments(),
      ]);
      const transportOk =
        transportBills.status === 'fulfilled' && transportPayments.status === 'fulfilled';
      if (!transportOk) {
        showToast('Transport payments could not be loaded, so only party payments are shown.', 'info');
      }
      setRecords(
        buildRecords(
          bills,
          payments,
          transportOk ? transportBills.value : [],
          transportOk ? transportPayments.value : []
        )
      );
    } catch (err) {
      console.error('Loading the payments failed:', err);
      setLoadError(describeDbError(err, 'The payments could not be loaded'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((r) => {
      if (kindFilter !== 'all' && r.kind !== kindFilter) return false;
      if (shapeFilter === 'combined' && !r.combined) return false;
      if (shapeFilter === 'single' && r.combined) return false;
      if (range.from && r.paidOn && r.paidOn < range.from) return false;
      if (range.to && r.paidOn && r.paidOn > range.to) return false;
      if (!q) return true;
      return (
        r.party.toLowerCase().includes(q) ||
        r.reference.toLowerCase().includes(q) ||
        r.bankName.toLowerCase().includes(q) ||
        r.bills.some((b) => b.billNo.toLowerCase().includes(q))
      );
    });
  }, [records, search, kindFilter, shapeFilter, range]);

  const totals = useMemo(() => {
    let all = 0;
    let party = 0;
    let transport = 0;
    for (const r of filtered) {
      const paise = toPaise(r.total);
      all += paise;
      if (r.kind === 'party') party += paise;
      else transport += paise;
    }
    return { all: all / 100, party: party / 100, transport: transport / 100 };
  }, [filtered]);

  const months = useMemo(() => {
    const list: { label: string; total: number; records: PaymentRecord[] }[] = [];
    for (const r of filtered) {
      const label = monthLabel(r.paidOn);
      let month = list[list.length - 1];
      if (!month || month.label !== label) {
        month = { label, total: 0, records: [] };
        list.push(month);
      }
      month.total = (toPaise(month.total) + toPaise(r.total)) / 100;
      month.records.push(r);
    }
    return list;
  }, [filtered]);

  const hasFilters =
    Boolean(search.trim()) ||
    kindFilter !== 'all' ||
    shapeFilter !== 'all' ||
    Boolean(range.from || range.to);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#F8FAFC] p-6">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          <p className="text-base font-medium">Loading payments...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#F8FAFC] p-6">
        <div className="max-w-md w-full bg-white border border-red-200 rounded-xl p-6 shadow-lg text-center space-y-4">
          <Wallet className="h-10 w-10 text-red-500 mx-auto" />
          <h2 className="text-xl font-bold text-slate-900">Could not load payments</h2>
          <p className="text-sm text-slate-600 leading-relaxed">{loadError.message}</p>
          {loadError.detail && (
            <p className="text-xs text-slate-400 leading-relaxed break-words">{loadError.detail}</p>
          )}
          <button
            type="button"
            onClick={loadData}
            className="px-5 py-3 bg-[#0F172A] text-white rounded-xl text-base font-semibold cursor-pointer"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="@container flex-1 overflow-y-auto bg-[#F8FAFC] p-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:p-6 md:p-8 space-y-4 sm:space-y-5 font-sans text-slate-900 selection:bg-emerald-500 selection:text-white">
      {/* Totals for whatever is filtered */}
      <div className="grid grid-cols-1 @xl:grid-cols-3 gap-2 @xl:gap-3">
        <TotalTile
          label={hasFilters ? 'Paid (filtered)' : 'Total paid'}
          value={formatMoney(totals.all)}
          hint={`${filtered.length} ${filtered.length === 1 ? 'payment' : 'payments'}`}
          tone="emerald"
        />
        <TotalTile label="To parties" value={formatMoney(totals.party)} icon={<ReceiptText className="h-4 w-4" />} />
        <TotalTile label="To transport" value={formatMoney(totals.transport)} icon={<Truck className="h-4 w-4" />} />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-col @2xl:flex-row @2xl:items-center gap-2">
          <div className="relative w-full @2xl:max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search party, bill no. or UTR..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500 w-full transition-all"
            />
          </div>
          <div className="w-full @2xl:w-72">
            <DateRangePicker value={range} onChange={setRange} disableFuture placeholder="All dates" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Segmented<'all' | Kind>
            value={kindFilter}
            onChange={setKindFilter}
            options={[
              { key: 'all', label: 'All' },
              { key: 'party', label: 'Party bills' },
              { key: 'transport', label: 'Transport' },
            ]}
          />
          <Segmented<'all' | 'combined' | 'single'>
            value={shapeFilter}
            onChange={setShapeFilter}
            options={[
              { key: 'all', label: 'Any' },
              { key: 'single', label: 'Single bill' },
              { key: 'combined', label: 'Combined' },
            ]}
          />
          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setKindFilter('all');
                setShapeFilter('all');
                setRange({ from: '', to: '' });
              }}
              className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Ledger, month by month */}
      {months.length === 0 ? (
        <div className="p-8 @xl:p-12 text-center bg-white border border-slate-200 rounded-xl">
          <Wallet className="h-10 w-10 mx-auto text-slate-300 mb-3" />
          <p className="text-base font-bold text-slate-700">
            {records.length === 0 ? 'No payments recorded yet' : 'No payments match'}
          </p>
          <p className="text-sm text-slate-500 mt-1 leading-relaxed">
            {records.length === 0
              ? 'Payments added on the Party bills and Transport bills pages show up here.'
              : 'Try a wider date range or clear the filters.'}
          </p>
        </div>
      ) : (
        months.map((month) => (
          <section key={month.label} className="space-y-2">
            <div className="flex items-baseline justify-between gap-3 px-1">
              <h3 className="text-sm font-bold text-slate-700">{month.label}</h3>
              <p className="text-sm font-bold text-slate-900 tabular-nums">{formatMoney(month.total)}</p>
            </div>
            <div className="space-y-2 @4xl:grid @4xl:grid-cols-2 @4xl:gap-3 @4xl:space-y-0">
              {month.records.map((record) => (
                <PaymentCard
                  key={record.key}
                  record={record}
                  onViewProof={() =>
                    setViewingPhoto({
                      url: record.photoUrl as string,
                      title: `${formatMoney(record.total)} · ${record.method}`,
                      subtitle: `${record.party} · ${
                        record.bills.length > 1 ? 'Bills' : record.kind === 'transport' ? 'Bilty' : 'Bill'
                      } ${record.bills.map((b) => b.billNo).join(', ')} · ${formatDate(record.paidOn)}`,
                      downloadName: `${record.party} payment ${formatDate(record.paidOn)}`,
                    })
                  }
                />
              ))}
            </div>
          </section>
        ))
      )}

      <ImageViewer
        open={Boolean(viewingPhoto)}
        src={viewingPhoto?.url ?? null}
        title={viewingPhoto?.title}
        subtitle={viewingPhoto?.subtitle}
        downloadName={viewingPhoto?.downloadName}
        onClose={() => setViewingPhoto(null)}
        onDownloadFailed={() =>
          showToast('Could not save the photo, so it was opened in a new tab instead.', 'info')
        }
      />
    </div>
  );
}

function PaymentCard({ record, onViewProof }: { record: PaymentRecord; onViewProof: () => void }) {
  const billWord = record.kind === 'transport' ? 'Bilty' : 'Bill';
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-xs p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-bold text-slate-900 truncate">{record.party}</p>
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full border ${
                record.kind === 'party'
                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                  : 'bg-sky-50 text-sky-800 border-sky-200'
              }`}
            >
              {record.kind === 'party' ? <ReceiptText className="h-3 w-3" /> : <Truck className="h-3 w-3" />}
              {record.kind === 'party' ? 'Party bill' : 'Transport'}
            </span>
            {record.combined && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full border bg-emerald-50 text-emerald-800 border-emerald-200">
                <Layers className="h-3 w-3" />
                Combined · {record.bills.length} bills
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-lg font-bold text-emerald-700 tabular-nums">{formatMoney(record.total)}</p>
          <p className="text-xs text-slate-500">{formatDate(record.paidOn)}</p>
        </div>
      </div>

      {/* Which bills this money went to */}
      <div className="mt-3 border border-slate-100 rounded-lg divide-y divide-slate-100 text-sm">
        {record.bills.map((bill, index) => (
          <div key={index} className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="min-w-0 text-slate-600 truncate">
              <span className="font-semibold text-slate-800">
                {billWord} {bill.billNo}
              </span>
              {bill.billDate && <span className="text-xs text-slate-500"> · {formatDate(bill.billDate)}</span>}
            </span>
            <span className="shrink-0 text-right tabular-nums">
              <span className="font-semibold text-slate-900">{formatMoney(bill.share)}</span>
              {bill.billAmount > 0 && toPaise(bill.share) !== toPaise(bill.billAmount) && (
                <span className="block text-xs text-slate-400">of {formatMoney(bill.billAmount)}</span>
              )}
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
        <p className="text-xs text-slate-500 min-w-0 break-words">
          <span className="font-semibold text-slate-700">{record.method}</span>
          {record.reference && ` · Ref: ${record.reference}`}
          {record.bankName && ` · ${record.bankName}`}
        </p>
        {record.photoUrl ? (
          <button
            type="button"
            onClick={onViewProof}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg cursor-pointer transition-colors"
          >
            <ImageIcon className="h-3.5 w-3.5" />
            View proof
          </button>
        ) : (
          <span className="text-xs text-slate-400">No proof photo</span>
        )}
      </div>
    </div>
  );
}

interface TotalTileProps {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
  tone?: 'default' | 'emerald';
}

function TotalTile({ label, value, hint, icon, tone = 'default' }: TotalTileProps) {
  const isEmerald = tone === 'emerald';
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 @xl:block ${
        isEmerald ? 'bg-emerald-600 border-emerald-700 text-white' : 'bg-white border-slate-200'
      }`}
    >
      <p className={`flex items-center gap-1.5 text-xs ${isEmerald ? 'text-emerald-100' : 'text-slate-500'}`}>
        {icon}
        {label}
      </p>
      <div className="text-right @xl:text-left @xl:mt-0.5">
        <p className={`text-lg font-bold tabular-nums ${isEmerald ? 'text-white' : 'text-slate-900'}`}>{value}</p>
        {hint && <p className={`text-xs ${isEmerald ? 'text-emerald-100' : 'text-slate-500'}`}>{hint}</p>}
      </div>
    </div>
  );
}

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { key: T; label: string }[];
}

function Segmented<T extends string>({ value, onChange, options }: SegmentedProps<T>) {
  return (
    <div className="flex rounded-lg bg-slate-50 p-0.5 border border-slate-200">
      {options.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`px-2.5 py-2 @xl:px-3 text-xs @xl:text-sm rounded-md font-semibold whitespace-nowrap cursor-pointer transition-colors ${
            value === key ? 'bg-[#0F172A] text-white font-bold shadow-xs' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
