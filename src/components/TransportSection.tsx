import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Banknote,
  Building2,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Package,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Truck,
  Wallet,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { BillPayment, PaymentMethod, TransportBill } from '../types';
import {
  deleteTransportBillFromDb,
  deleteTransportPaymentFromDb,
  fetchTransportBills,
  fetchTransportPayments,
  insertTransportBill,
  insertTransportPayment,
  updateTransportBillInDb,
  uploadBillPhoto,
} from '../lib/database';
import {
  extractPaymentFromImage,
  extractTransportBillFromImage,
  isPhotoFillAvailable,
  PhotoReadError,
} from '../lib/extractBill';
import { describeDbError, FriendlyError } from '../lib/dbErrors';
import { playSuccessChime, unlockSound } from '../lib/sounds';
import { AppModal } from './AppModal';
import { FormError, FormInput, ModalActions } from './FormInput';
import { DateField } from './DateField';
import { ImageViewer } from './ImageViewer';
import { PhotoPicker } from './PhotoPicker';

interface TransportSectionProps {
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

interface PhotoToView {
  url: string;
  title: string;
  subtitle: string;
  downloadName: string;
}

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'Cash', label: 'Cash' },
  { value: 'Cheque', label: 'Cheque' },
  { value: 'Bank transfer', label: 'Bank (NEFT/RTGS)' },
  { value: 'UPI', label: 'UPI (GPay/PhonePe)' },
];

function parseNum(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
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

function todayISO(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${mm}-${dd}`;
}

/**
 * Where the message belongs. A validation message points at a field near the
 * top of the form; a failed save belongs beside the button that was pressed.
 */
type FormProblem = FriendlyError & { near: 'fields' | 'save' };

function fieldProblem(message: string): FormProblem {
  return { message, detail: '', near: 'fields' };
}

function saveProblem(err: unknown, sentenceStart: string): FormProblem {
  return { ...describeDbError(err, sentenceStart), near: 'save' };
}

/** Carries the message to the person rather than expecting them to go find it. */
function useProblemScroll(problem: FormProblem | null) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (problem) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [problem]);

  return ref;
}

function referenceLabel(method: PaymentMethod): string {
  if (method === 'Cheque') return 'Cheque number';
  if (method === 'Bank transfer') return 'UTR / reference number';
  if (method === 'UPI') return 'Transaction ID (UTR)';
  return 'Note (optional)';
}

export function TransportSection({ showToast }: TransportSectionProps) {
  const [bills, setBills] = useState<TransportBill[]>([]);
  const [payments, setPayments] = useState<BillPayment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<FriendlyError | null>(null);

  // List controls
  const [view, setView] = useState<'bills' | 'transports'>('bills');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'due' | 'paid'>('all');
  const [transportFilter, setTransportFilter] = useState<string | null>(null);

  // Modals
  const [isAddBillOpen, setIsAddBillOpen] = useState(false);
  const [editingBillId, setEditingBillId] = useState<string | null>(null);
  const [detailBillId, setDetailBillId] = useState<string | null>(null);
  const [paymentBillId, setPaymentBillId] = useState<string | null>(null);
  const [deletingBillId, setDeletingBillId] = useState<string | null>(null);
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);
  const [viewingPhoto, setViewingPhoto] = useState<PhotoToView | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [billsData, paymentsData] = await Promise.all([
        fetchTransportBills(),
        fetchTransportPayments(),
      ]);
      setBills(billsData);
      setPayments(paymentsData);
    } catch (err) {
      console.error('Loading the transport bills failed:', err);
      setLoadError(describeDbError(err, 'Your transport bills could not be loaded'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const paidByBill = useMemo(() => {
    const map = new Map<string, number>();
    for (const payment of payments) {
      map.set(payment.billId, (map.get(payment.billId) ?? 0) + payment.amount);
    }
    return map;
  }, [payments]);

  const getPaid = (billId: string) => paidByBill.get(billId) ?? 0;
  const getBalance = (bill: TransportBill) => Math.max(0, bill.amount - getPaid(bill.id));

  const transportNames = useMemo(
    () => Array.from(new Set(bills.map((b) => b.transportName.trim()))).sort(),
    [bills]
  );

  const partyNames = useMemo(
    () =>
      Array.from(new Set(bills.map((b) => b.partyName.trim()).filter(Boolean))).sort(),
    [bills]
  );

  const transportSummaries = useMemo(() => {
    const map = new Map<
      string,
      { name: string; billCount: number; total: number; paid: number }
    >();
    for (const bill of bills) {
      const key = bill.transportName.trim();
      const entry = map.get(key) ?? { name: key, billCount: 0, total: 0, paid: 0 };
      entry.billCount += 1;
      entry.total += bill.amount;
      entry.paid += Math.min(getPaid(bill.id), bill.amount);
      map.set(key, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.total - b.paid - (a.total - a.paid));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bills, paidByBill]);

  const filteredBills = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bills.filter((bill) => {
      if (transportFilter && bill.transportName.trim() !== transportFilter) return false;
      const balance = getBalance(bill);
      if (statusFilter === 'due' && balance <= 0) return false;
      if (statusFilter === 'paid' && balance > 0) return false;
      if (!q) return true;
      return (
        bill.transportName.toLowerCase().includes(q) ||
        bill.biltyNo.toLowerCase().includes(q) ||
        bill.partyName.toLowerCase().includes(q) ||
        bill.item.toLowerCase().includes(q)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bills, search, statusFilter, transportFilter, paidByBill]);

  const detailBill = detailBillId ? bills.find((b) => b.id === detailBillId) ?? null : null;
  const paymentBill = paymentBillId ? bills.find((b) => b.id === paymentBillId) ?? null : null;
  const deletingBill = deletingBillId ? bills.find((b) => b.id === deletingBillId) ?? null : null;
  const editingBill = editingBillId ? bills.find((b) => b.id === editingBillId) ?? null : null;

  const handleBillSaved = (bill: TransportBill, wasEdited: boolean) => {
    if (wasEdited) {
      setBills((prev) => prev.map((b) => (b.id === bill.id ? bill : b)));
      setEditingBillId(null);
      // Back to the detail view so the corrected bill can be checked right away.
      setDetailBillId(bill.id);
      showToast(`Transport bill from "${bill.transportName}" updated.`, 'success');
      return;
    }
    setBills((prev) => [bill, ...prev]);
    setIsAddBillOpen(false);
    showToast(
      `Transport bill from "${bill.transportName}" saved — ${formatMoney(bill.amount)} to pay.`,
      'success'
    );
  };

  const handlePaymentSaved = (payment: BillPayment, transportName: string) => {
    setPayments((prev) => [payment, ...prev]);
    setPaymentBillId(null);
    showToast(`Payment of ${formatMoney(payment.amount)} to "${transportName}" saved.`, 'success');
  };

  const handleDeleteBill = async () => {
    if (!deletingBill) return;
    try {
      await deleteTransportBillFromDb(deletingBill.id);
      setBills((prev) => prev.filter((b) => b.id !== deletingBill.id));
      setPayments((prev) => prev.filter((p) => p.billId !== deletingBill.id));
      setDeletingBillId(null);
      setDetailBillId(null);
      showToast(`Transport bill from "${deletingBill.transportName}" removed.`, 'info');
    } catch {
      showToast('Could not remove this bill. Please try again.', 'error');
    }
  };

  const handleDeletePayment = async () => {
    if (!deletingPaymentId) return;
    try {
      await deleteTransportPaymentFromDb(deletingPaymentId);
      setPayments((prev) => prev.filter((p) => p.id !== deletingPaymentId));
      setDeletingPaymentId(null);
      showToast('Payment entry removed. The amount is added back to the balance.', 'info');
    } catch {
      showToast('Could not remove this payment. Please try again.', 'error');
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#F8FAFC] p-6">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="h-8 w-8 animate-spin text-amber-600" />
          <p className="text-base font-medium">Loading transport bills...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#F8FAFC] p-6">
        <div className="max-w-md w-full bg-white border border-red-200 rounded-xl p-6 shadow-lg text-center space-y-4">
          <Truck className="h-10 w-10 text-red-500 mx-auto" />
          <h2 className="text-xl font-bold text-slate-900">Could not load transport bills</h2>
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
    <div className="flex-1 overflow-y-auto bg-[#F8FAFC] p-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:p-6 md:p-8 space-y-4 sm:space-y-5 font-sans text-slate-900 selection:bg-amber-500 selection:text-white">
      {/* View tabs + filters */}
      <div className="flex flex-col gap-2 sm:gap-3">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex rounded-lg bg-slate-100 p-0.5">
            {(
              [
                { key: 'bills' as const, label: 'Bills', shortLabel: 'Bills' },
                { key: 'transports' as const, label: 'Transport-wise total', shortLabel: 'By transport' },
              ]
            ).map(({ key, label, shortLabel }) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                className={`px-3 py-2 sm:px-4 text-sm rounded-md font-semibold cursor-pointer transition-colors whitespace-nowrap ${
                  view === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <span className="sm:hidden">{shortLabel}</span>
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setIsAddBillOpen(true)}
            className="ml-auto shrink-0 flex items-center gap-1.5 px-3 py-2 sm:px-4 sm:py-2.5 bg-[#0F172A] hover:bg-slate-800 text-white rounded-lg text-sm font-bold whitespace-nowrap shadow-xs cursor-pointer transition-all"
          >
            <Plus className="h-4 w-4" />
            Add bill
          </button>
        </div>

        {view === 'bills' && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search transport, bilty or party..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-white border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 w-full transition-all"
              />
            </div>
            <div className="flex rounded-lg bg-slate-50 p-0.5 border border-slate-200 w-full sm:w-auto">
              {(
                [
                  { key: 'all' as const, label: 'All' },
                  { key: 'due' as const, label: 'Payment left' },
                  { key: 'paid' as const, label: 'Fully paid' },
                ]
              ).map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStatusFilter(key)}
                  className={`flex-1 sm:flex-none px-2 py-2 sm:px-3 text-xs sm:text-sm rounded-md font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                    statusFilter === key
                      ? 'bg-[#0F172A] text-white font-bold shadow-xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {view === 'bills' && transportFilter && (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 bg-amber-50 text-amber-800 border border-amber-200 rounded-full text-xs font-semibold max-w-full">
              <Truck className="h-3 w-3 shrink-0" />
              <span className="truncate">{transportFilter}</span>
              <button
                type="button"
                onClick={() => setTransportFilter(null)}
                className="p-1 hover:bg-amber-100 rounded-full cursor-pointer shrink-0"
                aria-label="Show all transports"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          </div>
        )}
      </div>

      {/* Transport-wise view */}
      {view === 'transports' && (
        <div className="space-y-3">
          {transportSummaries.length === 0 ? (
            <EmptyState onAdd={() => setIsAddBillOpen(true)} />
          ) : (
            transportSummaries.map((transport) => {
              const due = Math.max(0, transport.total - transport.paid);
              return (
                <button
                  key={transport.name}
                  type="button"
                  onClick={() => {
                    setTransportFilter(transport.name);
                    setView('bills');
                  }}
                  className="w-full text-left bg-white border border-slate-200 rounded-xl p-4 shadow-xs hover:border-amber-300 transition-colors cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-base font-bold text-slate-900 truncate">{transport.name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {transport.billCount} {transport.billCount === 1 ? 'bill' : 'bills'}
                      </p>
                    </div>
                    {due > 0 ? (
                      <span className="shrink-0 px-2.5 py-1 text-xs font-bold rounded-full bg-red-50 text-red-700 border border-red-200">
                        Left: {formatMoney(due)}
                      </span>
                    ) : (
                      <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-full bg-[#DCFCE7] text-[#166534] border border-[#BBF7D0]">
                        <CheckCircle2 className="h-3 w-3" />
                        Fully paid
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 mt-3 pt-3 border-t border-slate-100 text-sm">
                    <div>
                      <p className="text-xs text-slate-500">Total freight</p>
                      <p className="font-bold text-slate-900 tabular-nums">{formatMoney(transport.total)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Paid</p>
                      <p className="font-bold text-emerald-700 tabular-nums">{formatMoney(transport.paid)}</p>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}

      {/* Bills view */}
      {view === 'bills' && (
        <div className="space-y-3 md:grid md:grid-cols-2 xl:grid-cols-3 md:gap-4 md:space-y-0">
          {filteredBills.length === 0 ? (
            <div className="md:col-span-2 xl:col-span-3">
              {bills.length === 0 ? (
                <EmptyState onAdd={() => setIsAddBillOpen(true)} />
              ) : (
                <div className="p-8 text-center text-slate-400 text-sm bg-white border border-slate-200 rounded-xl">
                  No bills match your search or filter.
                </div>
              )}
            </div>
          ) : (
            filteredBills.map((bill) => {
              const paid = getPaid(bill.id);
              const balance = getBalance(bill);
              return (
                <motion.div
                  key={bill.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden flex flex-col"
                >
                  <button
                    type="button"
                    onClick={() => setDetailBillId(bill.id)}
                    className="text-left p-4 flex-1 cursor-pointer hover:bg-slate-50/60 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-base font-bold text-slate-900 truncate">{bill.transportName}</p>
                        <p className="text-sm text-slate-500 mt-0.5 truncate">
                          Bilty {bill.biltyNo || '—'} · {formatDate(bill.receivedDate)}
                        </p>
                      </div>
                      {balance > 0 ? (
                        <span className="shrink-0 px-2.5 py-1 text-xs font-bold rounded-full bg-red-50 text-red-700 border border-red-200">
                          Left: {formatMoney(balance)}
                        </span>
                      ) : (
                        <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-full bg-[#DCFCE7] text-[#166534] border border-[#BBF7D0]">
                          <CheckCircle2 className="h-3 w-3" />
                          Fully paid
                        </span>
                      )}
                    </div>
                    <div className="mt-3 pt-3 border-t border-slate-100 text-sm">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="min-w-0">
                          <p className="text-xs text-slate-500">Bill amount</p>
                          <p className="font-bold text-slate-900 tabular-nums truncate">
                            {formatMoney(bill.amount)}
                          </p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs text-slate-500">Paid</p>
                          <p className="font-bold text-emerald-700 tabular-nums truncate">
                            {formatMoney(paid)}
                          </p>
                        </div>
                      </div>
                      {bill.partyName && (
                        <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500 min-w-0">
                          <Building2 className="h-3.5 w-3.5 shrink-0" />
                          <span className="font-semibold text-slate-700 truncate">{bill.partyName}</span>
                        </p>
                      )}
                      {(bill.item || bill.weight) && (
                        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500 min-w-0">
                          <Package className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">
                            {bill.item || '—'}
                            {bill.weight && ` · ${bill.weight}`}
                          </span>
                        </p>
                      )}
                    </div>
                  </button>
                  {balance > 0 && (
                    <div className="px-4 pb-4">
                      <button
                        type="button"
                        onClick={() => setPaymentBillId(bill.id)}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold cursor-pointer transition-colors"
                      >
                        <Wallet className="h-4 w-4" />
                        Add payment
                      </button>
                    </div>
                  )}
                </motion.div>
              );
            })
          )}
        </div>
      )}

      {/* Add / edit bill modal */}
      <TransportBillFormModal
        open={isAddBillOpen || Boolean(editingBill)}
        bill={editingBill}
        onClose={() => {
          setIsAddBillOpen(false);
          setEditingBillId(null);
        }}
        transportNames={transportNames}
        partyNames={partyNames}
        onSaved={handleBillSaved}
        showToast={showToast}
      />

      {/* Bill detail modal */}
      <AppModal
        open={Boolean(detailBill)}
        onClose={() => setDetailBillId(null)}
        title={detailBill?.transportName ?? ''}
        description={
          detailBill
            ? `Bilty ${detailBill.biltyNo || '—'} · Received ${formatDate(detailBill.receivedDate)}`
            : undefined
        }
        icon={<Truck className="h-5 w-5" />}
        accent="amber"
      >
        {detailBill && (
          <div className="space-y-5">
            {/* Amount summary — one row per amount on phones so nothing is cut off */}
            <div className="space-y-2 sm:space-y-0 sm:grid sm:grid-cols-3 sm:gap-2">
              <AmountTile label="Bill amount" value={formatMoney(detailBill.amount)} />
              <AmountTile
                label="Paid"
                value={formatMoney(getPaid(detailBill.id))}
                tone="emerald"
              />
              <AmountTile
                label="Left to pay"
                value={formatMoney(getBalance(detailBill))}
                tone={getBalance(detailBill) > 0 ? 'red' : 'default'}
              />
            </div>

            {/* Bill info */}
            <div className="space-y-2 text-sm">
              <InfoRow label="Parcel received on" value={formatDate(detailBill.receivedDate)} />
              <InfoRow label="Transport" value={detailBill.transportName || '—'} />
              <InfoRow label="Bilty number" value={detailBill.biltyNo || '—'} />
              <InfoRow label="Party (sender)" value={detailBill.partyName || '—'} />
              <InfoRow label="Item" value={detailBill.item || '—'} />
              <InfoRow label="Weight" value={detailBill.weight || '—'} />
            </div>

            {detailBill.photoUrl && (
              <PhotoThumbButton
                url={detailBill.photoUrl}
                label="Bilty photo"
                hint="Tap to zoom, rotate or save"
                onOpen={() =>
                  setViewingPhoto({
                    url: detailBill.photoUrl as string,
                    title: detailBill.transportName,
                    subtitle: `Bilty ${detailBill.biltyNo || '—'} · ${formatDate(detailBill.receivedDate)}`,
                    downloadName: `${detailBill.transportName} bilty ${detailBill.biltyNo || ''}`,
                  })
                }
              />
            )}

            {/* Payments */}
            <div>
              <h4 className="text-sm font-bold text-slate-800 mb-2">Payments made</h4>
              {payments.filter((p) => p.billId === detailBill.id).length === 0 ? (
                <p className="text-sm text-slate-500 bg-slate-50 border border-slate-100 rounded-xl p-3">
                  Nothing paid yet against this bill.
                </p>
              ) : (
                <div className="space-y-2">
                  {payments
                    .filter((p) => p.billId === detailBill.id)
                    .map((payment) => (
                      <div
                        key={payment.id}
                        className="flex items-start justify-between gap-3 bg-slate-50 border border-slate-100 rounded-xl p-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900 tabular-nums">
                            {formatMoney(payment.amount)}
                            <span className="ml-2 text-xs font-semibold text-slate-500">
                              {payment.method}
                            </span>
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5 break-words">
                            {formatDate(payment.paidOn)}
                            {payment.reference && ` · Ref: ${payment.reference}`}
                            {payment.bankName && ` · ${payment.bankName}`}
                          </p>
                          {payment.photoUrl && (
                            <button
                              type="button"
                              onClick={() =>
                                setViewingPhoto({
                                  url: payment.photoUrl as string,
                                  title: `${formatMoney(payment.amount)} · ${payment.method}`,
                                  subtitle: `${detailBill.transportName} · ${formatDate(payment.paidOn)}`,
                                  downloadName: `${detailBill.transportName} payment ${formatDate(payment.paidOn)}`,
                                })
                              }
                              className="inline-flex items-center gap-1.5 mt-2 px-3 py-2 text-xs font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg cursor-pointer transition-colors"
                            >
                              <ImageIcon className="h-3.5 w-3.5" />
                              View proof
                            </button>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setDeletingPaymentId(payment.id)}
                          title="Remove this payment entry"
                          aria-label="Remove this payment entry"
                          className="flex h-10 w-10 shrink-0 items-center justify-center text-slate-400 hover:text-red-600 bg-white border border-slate-200 rounded-lg cursor-pointer transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2.5 pt-3 border-t border-slate-100">
              {getBalance(detailBill) > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setPaymentBillId(detailBill.id);
                  }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold cursor-pointer transition-colors"
                >
                  <Wallet className="h-4 w-4" />
                  Add payment
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setDetailBillId(null);
                  setEditingBillId(detailBill.id);
                }}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl text-sm font-bold cursor-pointer transition-colors"
              >
                <Pencil className="h-4 w-4" />
                Edit this bill
              </button>
              <button
                type="button"
                onClick={() => setDeletingBillId(detailBill.id)}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl text-sm font-semibold cursor-pointer transition-colors"
              >
                <Trash2 className="h-4 w-4" />
                Remove this bill
              </button>
            </div>
          </div>
        )}
      </AppModal>

      {/* Add payment modal */}
      {paymentBill && (
        <AddTransportPaymentModal
          bill={paymentBill}
          balance={getBalance(paymentBill)}
          onClose={() => setPaymentBillId(null)}
          onSaved={handlePaymentSaved}
          showToast={showToast}
        />
      )}

      {/* Delete bill confirmation */}
      <AppModal
        open={Boolean(deletingBill)}
        onClose={() => setDeletingBillId(null)}
        title="Remove this bill?"
        description={
          deletingBill
            ? `The transport bill from "${deletingBill.transportName}" and all its payment entries will be removed. This cannot be undone.`
            : undefined
        }
        icon={<Trash2 className="h-5 w-5" />}
        accent="red"
      >
        <ModalActions
          onCancel={() => setDeletingBillId(null)}
          submitLabel="Remove bill"
          cancelLabel="Keep bill"
          submitType="button"
          onSubmit={handleDeleteBill}
          submitAccent="red"
        />
      </AppModal>

      {/* Delete payment confirmation */}
      <AppModal
        open={Boolean(deletingPaymentId)}
        onClose={() => setDeletingPaymentId(null)}
        title="Remove this payment entry?"
        description="The amount will be added back to the bill's balance."
        icon={<Trash2 className="h-5 w-5" />}
        accent="red"
      >
        <ModalActions
          onCancel={() => setDeletingPaymentId(null)}
          submitLabel="Remove payment"
          cancelLabel="Keep it"
          submitType="button"
          onSubmit={handleDeletePayment}
          submitAccent="red"
        />
      </AppModal>

      {/* Full-screen photo viewer */}
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

interface AmountTileProps {
  label: string;
  value: string;
  tone?: 'default' | 'emerald' | 'red';
}

const amountTones: Record<NonNullable<AmountTileProps['tone']>, { box: string; label: string; value: string }> = {
  default: {
    box: 'bg-slate-50 border-slate-100',
    label: 'text-slate-500',
    value: 'text-slate-900',
  },
  emerald: {
    box: 'bg-emerald-50 border-emerald-100',
    label: 'text-emerald-700',
    value: 'text-emerald-800',
  },
  red: {
    box: 'bg-red-50 border-red-100',
    label: 'text-red-700',
    value: 'text-red-700',
  },
};

function AmountTile({ label, value, tone = 'default' }: AmountTileProps) {
  const styles = amountTones[tone];
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 sm:block sm:px-3 sm:py-3 ${styles.box}`}
    >
      <p className={`text-xs ${styles.label}`}>{label}</p>
      <p className={`text-sm font-bold tabular-nums sm:mt-0.5 ${styles.value}`}>{value}</p>
    </div>
  );
}

interface PhotoThumbButtonProps {
  url: string;
  label: string;
  hint: string;
  onOpen: () => void;
}

function PhotoThumbButton({ url, label, hint, onOpen }: PhotoThumbButtonProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full flex items-center gap-3 p-2.5 bg-white border border-slate-200 hover:border-amber-300 rounded-xl text-left cursor-pointer transition-colors"
    >
      <img
        src={url}
        alt=""
        loading="lazy"
        className="h-14 w-14 shrink-0 rounded-lg object-cover bg-slate-100 border border-slate-200"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-slate-900">{label}</span>
        <span className="block text-xs text-slate-500 mt-0.5">{hint}</span>
      </span>
      <span className="shrink-0 flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-700 border border-amber-200">
        <Maximize2 className="h-4 w-4" />
      </span>
    </button>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="p-8 sm:p-12 text-center bg-white border border-slate-200 rounded-xl">
      <Truck className="h-10 w-10 mx-auto text-slate-300 mb-3" />
      <p className="text-base font-bold text-slate-700">No transport bills saved yet</p>
      <p className="text-sm text-slate-500 mt-1 leading-relaxed">
        When a parcel arrives by transport, save the bilty here. You can then record every payment
        and always know how much freight is left to pay.
      </p>
      <button
        type="button"
        onClick={onAdd}
        className="mt-4 inline-flex items-center gap-2 px-5 py-3 bg-[#0F172A] hover:bg-slate-800 text-white rounded-xl text-sm font-bold cursor-pointer transition-colors"
      >
        <Plus className="h-4 w-4" />
        Add your first bill
      </button>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className="font-semibold text-slate-900 text-right break-words min-w-0">{value}</span>
    </div>
  );
}

// --- Add / edit bill modal ---

interface TransportBillFormModalProps {
  open: boolean;
  /** The saved bill being corrected, or null when adding a new one. */
  bill: TransportBill | null;
  onClose: () => void;
  transportNames: string[];
  partyNames: string[];
  onSaved: (bill: TransportBill, wasEdited: boolean) => void;
  showToast: TransportSectionProps['showToast'];
}

function TransportBillFormModal({
  open,
  bill,
  onClose,
  transportNames,
  partyNames,
  onSaved,
  showToast,
}: TransportBillFormModalProps) {
  const isEditing = Boolean(bill);
  const [receivedDate, setReceivedDate] = useState(todayISO());
  const [transportName, setTransportName] = useState('');
  const [item, setItem] = useState('');
  const [weight, setWeight] = useState('');
  const [biltyNo, setBiltyNo] = useState('');
  const [partyName, setPartyName] = useState('');
  const [amount, setAmount] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [savedPhotoUrl, setSavedPhotoUrl] = useState<string | null>(null);
  const [problem, setProblem] = useState<FormProblem | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const problemRef = useProblemScroll(problem);

  const reset = () => {
    setReceivedDate(todayISO());
    setTransportName('');
    setItem('');
    setWeight('');
    setBiltyNo('');
    setPartyName('');
    setAmount('');
    setPhotoFile(null);
    setSavedPhotoUrl(null);
    setProblem(null);
    setIsSaving(false);
    setIsExtracting(false);
  };

  const fillFormFrom = (source: TransportBill) => {
    setReceivedDate(source.receivedDate || todayISO());
    setTransportName(source.transportName);
    setItem(source.item);
    setWeight(source.weight);
    setBiltyNo(source.biltyNo);
    setPartyName(source.partyName);
    setAmount(source.amount ? String(source.amount) : '');
    setSavedPhotoUrl(source.photoUrl);
    setPhotoFile(null);
    setProblem(null);
    setIsSaving(false);
    setIsExtracting(false);
  };

  useEffect(() => {
    if (!open) return;
    if (bill) fillFormFrom(bill);
    else reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bill?.id]);

  const handleClose = () => {
    reset();
    onClose();
  };

  const fillFromPhoto = async (file: File) => {
    setIsExtracting(true);
    setProblem(null);
    try {
      const extracted = await extractTransportBillFromImage(file);
      if (extracted.receivedDate) setReceivedDate(extracted.receivedDate);
      if (extracted.transportName) setTransportName(extracted.transportName);
      if (extracted.item) setItem(extracted.item);
      if (extracted.weight) setWeight(extracted.weight);
      if (extracted.biltyNo) setBiltyNo(extracted.biltyNo);
      if (extracted.partyName) setPartyName(extracted.partyName);
      if (extracted.amount > 0) setAmount(String(extracted.amount));
      playSuccessChime();
      showToast(
        'Details filled from the photo. Please check every line and correct anything that is wrong before saving.',
        'info'
      );
    } catch (err) {
      showToast(
        err instanceof PhotoReadError
          ? err.message
          : 'Could not read the photo. Please fill the details by hand.',
        'error'
      );
    } finally {
      setIsExtracting(false);
    }
  };

  const handleAutoFill = () => {
    unlockSound();
    if (photoFile) fillFromPhoto(photoFile);
  };

  /** Reads the already-saved bilty photo again, for when the first read was wrong. */
  const handleReadSavedPhotoAgain = async () => {
    if (!savedPhotoUrl) return;
    unlockSound();
    setIsExtracting(true);
    let file: File;
    try {
      const response = await fetch(savedPhotoUrl);
      if (!response.ok) throw new Error('Could not download the saved photo');
      const blob = await response.blob();
      file = new File([blob], 'saved-bilty.jpg', { type: blob.type || 'image/jpeg' });
    } catch {
      setIsExtracting(false);
      showToast(
        'Could not open the saved photo again. You can pick the photo once more to read it.',
        'error'
      );
      return;
    }
    await fillFromPhoto(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);

    if (!transportName.trim()) {
      setProblem(fieldProblem('Please enter the transport name (who delivered the parcel).'));
      return;
    }
    const amountNum = parseNum(amount);
    if (amountNum <= 0) {
      setProblem(fieldProblem('Please enter the bill amount (freight to pay).'));
      return;
    }

    setIsSaving(true);
    let photoUrl: string | null = savedPhotoUrl;
    if (photoFile) {
      const uploaded = await uploadBillPhoto(photoFile, 'transport');
      if (uploaded) photoUrl = uploaded;
      else showToast('The photo could not be uploaded, but the bill will still be saved.', 'info');
    }

    const saved: TransportBill = {
      id: bill?.id ?? `tb-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      receivedDate,
      transportName: transportName.trim(),
      item: item.trim(),
      weight: weight.trim(),
      biltyNo: biltyNo.trim(),
      partyName: partyName.trim(),
      amount: Math.round(amountNum * 100) / 100,
      photoUrl,
      createdAt: bill?.createdAt ?? new Date().toISOString(),
    };

    try {
      if (bill) await updateTransportBillInDb(saved);
      else await insertTransportBill(saved);
      reset();
      onSaved(saved, Boolean(bill));
    } catch (err) {
      console.error('Saving the transport bill failed:', err);
      setIsSaving(false);
      setProblem(
        saveProblem(err, bill ? 'Your changes could not be saved' : 'The bill could not be saved')
      );
    }
  };

  return (
    <AppModal
      open={open}
      onClose={handleClose}
      title={isEditing ? 'Edit this bill' : 'Add transport bill'}
      description={
        isEditing
          ? 'Correct anything that is wrong and save again'
          : 'Save the bilty of a parcel that arrived by transport'
      }
      icon={<FileText className="h-5 w-5" />}
      accent="amber"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {problem?.near === 'fields' && (
          <div ref={problemRef}>
            <FormError message={problem.message} />
          </div>
        )}

        {savedPhotoUrl && !photoFile && (
          <div className="space-y-2">
            <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl p-2.5">
              <img
                src={savedPhotoUrl}
                alt=""
                loading="lazy"
                className="h-14 w-14 shrink-0 rounded-lg object-cover border border-slate-200 bg-white"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-700">Saved bilty photo</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Pick a new photo below to replace it
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSavedPhotoUrl(null)}
                disabled={isSaving}
                className="flex h-10 w-10 shrink-0 items-center justify-center text-slate-400 hover:text-red-600 rounded-lg cursor-pointer"
                aria-label="Remove the saved photo"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {isPhotoFillAvailable && (
              <button
                type="button"
                onClick={handleReadSavedPhotoAgain}
                disabled={isExtracting || isSaving}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-xl text-sm font-bold cursor-pointer transition-colors disabled:opacity-60"
              >
                {isExtracting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Reading the photo...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Read this photo again
                  </>
                )}
              </button>
            )}
          </div>
        )}

        <PhotoPicker
          label={savedPhotoUrl ? 'Replace bilty photo' : 'Add bilty photo'}
          file={photoFile}
          onSelect={setPhotoFile}
          onAutoFill={handleAutoFill}
          isExtracting={isExtracting}
          autoFillLabel="Fill details from photo"
          inputId="transport-bill-photo-input"
        />

        <div className="space-y-1.5">
          <label className="block text-sm font-semibold text-slate-700">Transport name</label>
          <input
            type="text"
            required
            list="transport-name-suggestions"
            placeholder="e.g. VRL Logistics"
            value={transportName}
            onChange={(e) => setTransportName(e.target.value)}
            disabled={isSaving}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3.5 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-4 focus:border-amber-500 focus:ring-amber-500/15 transition-all"
          />
          <datalist id="transport-name-suggestions">
            {transportNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <DateField
            label="Parcel received on"
            value={receivedDate}
            onChange={setReceivedDate}
            disabled={isSaving}
            accent="amber"
          />
          <FormInput
            label="Bilty number"
            type="text"
            placeholder="e.g. 78412"
            value={biltyNo}
            onChange={(e) => setBiltyNo(e.target.value)}
            disabled={isSaving}
            accent="amber"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-semibold text-slate-700">
            Party name (who sent the goods)
          </label>
          <input
            type="text"
            list="transport-party-suggestions"
            placeholder="e.g. Sharma Textiles"
            value={partyName}
            onChange={(e) => setPartyName(e.target.value)}
            disabled={isSaving}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3.5 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-4 focus:border-amber-500 focus:ring-amber-500/15 transition-all"
          />
          <datalist id="transport-party-suggestions">
            {partyNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>

        <FormInput
          label="Item (what was in the parcel)"
          type="text"
          placeholder="e.g. Cotton bales"
          value={item}
          onChange={(e) => setItem(e.target.value)}
          disabled={isSaving}
          accent="amber"
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormInput
            label="Weight"
            type="text"
            placeholder="e.g. 250 kg"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            disabled={isSaving}
            accent="amber"
          />
          <FormInput
            label="Bill amount ₹"
            type="number"
            inputMode="decimal"
            required
            min={0}
            step="any"
            placeholder="Freight to pay"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={isSaving}
            accent="amber"
          />
        </div>

        {/* Total */}
        <div className="bg-[#0F172A] text-white rounded-xl p-4">
          <div className="flex items-center justify-between text-base font-bold">
            <span>Amount to pay</span>
            <span className="tabular-nums text-amber-400">{formatMoney(parseNum(amount))}</span>
          </div>
        </div>

        {problem?.near === 'save' && (
          <div ref={problemRef}>
            <FormError
              message={`${problem.message} Nothing you typed here is lost — the bill stays on screen until it saves.`}
              detail={problem.detail}
            />
          </div>
        )}

        <ModalActions
          onCancel={handleClose}
          submitLabel={isEditing ? 'Save changes' : 'Save bill'}
          submitAccent="amber"
          isSubmitting={isSaving}
        />
      </form>
    </AppModal>
  );
}

// --- Add payment modal ---

interface AddTransportPaymentModalProps {
  bill: TransportBill;
  balance: number;
  onClose: () => void;
  onSaved: (payment: BillPayment, transportName: string) => void;
  showToast: TransportSectionProps['showToast'];
}

function AddTransportPaymentModal({
  bill,
  balance,
  onClose,
  onSaved,
  showToast,
}: AddTransportPaymentModalProps) {
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(todayISO());
  const [method, setMethod] = useState<PaymentMethod>('Cash');
  const [reference, setReference] = useState('');
  const [bankName, setBankName] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<FormProblem | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const problemRef = useProblemScroll(problem);

  const handleAutoFill = async () => {
    if (!photoFile) return;
    unlockSound();
    setIsExtracting(true);
    setProblem(null);
    try {
      const extracted = await extractPaymentFromImage(photoFile);
      if (extracted.amount > 0) setAmount(String(extracted.amount));
      if (extracted.paidOn) setPaidOn(extracted.paidOn);
      if (extracted.method) setMethod(extracted.method);
      if (extracted.reference) setReference(extracted.reference);
      if (extracted.bankName) setBankName(extracted.bankName);
      playSuccessChime();
      showToast('Details filled from the screenshot. Please check them once before saving.', 'info');
    } catch (err) {
      showToast(
        err instanceof PhotoReadError
          ? err.message
          : 'Could not read the screenshot. Please fill the details by hand.',
        'error'
      );
    } finally {
      setIsExtracting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);

    const amountNum = parseNum(amount);
    if (amountNum <= 0) {
      setProblem(fieldProblem('Please enter the amount you paid.'));
      return;
    }
    if (amountNum > balance) {
      setProblem(
        fieldProblem(
          `This is more than what is left to pay (${formatMoney(balance)}). Please check the amount.`
        )
      );
      return;
    }

    setIsSaving(true);
    let photoUrl: string | null = null;
    if (photoFile) {
      photoUrl = await uploadBillPhoto(photoFile, 'transport-payments');
      if (!photoUrl) {
        showToast('The screenshot could not be uploaded, but the payment will still be saved.', 'info');
      }
    }

    const payment: BillPayment = {
      id: `tpay-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      billId: bill.id,
      paidOn,
      amount: amountNum,
      method,
      reference: reference.trim(),
      bankName: bankName.trim(),
      photoUrl,
      createdAt: new Date().toISOString(),
    };

    try {
      await insertTransportPayment(payment);
      onSaved(payment, bill.transportName);
    } catch (err) {
      console.error('Saving the payment failed:', err);
      setIsSaving(false);
      setProblem(saveProblem(err, 'The payment could not be saved'));
    }
  };

  return (
    <AppModal
      open
      onClose={onClose}
      title="Add payment"
      description={`To ${bill.transportName} · Bilty ${bill.biltyNo || '—'} · Left to pay: ${formatMoney(balance)}`}
      icon={<Banknote className="h-5 w-5" />}
      accent="emerald"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {problem?.near === 'fields' && (
          <div ref={problemRef}>
            <FormError message={problem.message} />
          </div>
        )}

        <PhotoPicker
          label="Add payment screenshot or cheque photo"
          file={photoFile}
          onSelect={setPhotoFile}
          onAutoFill={handleAutoFill}
          isExtracting={isExtracting}
          autoFillLabel="Fill details from screenshot"
          inputId="transport-payment-photo-input"
        />

        <div>
          <FormInput
            label="Amount paid ₹"
            type="number"
            inputMode="decimal"
            required
            min={0}
            step="any"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={isSaving}
            accent="emerald"
          />
          <button
            type="button"
            onClick={() => setAmount(String(balance))}
            disabled={isSaving}
            className="mt-2 px-3 py-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-full cursor-pointer transition-colors"
          >
            Full payment — {formatMoney(balance)}
          </button>
        </div>

        <DateField
          label="Payment date"
          value={paidOn}
          onChange={setPaidOn}
          disabled={isSaving}
          accent="emerald"
        />

        <div className="space-y-1.5">
          <label className="block text-sm font-semibold text-slate-700">How did you pay?</label>
          <div className="grid grid-cols-2 gap-2">
            {PAYMENT_METHODS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setMethod(value)}
                disabled={isSaving}
                className={`px-3 py-3 text-sm font-semibold rounded-xl border transition-all cursor-pointer ${
                  method === value
                    ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {method !== 'Cash' && (
          <FormInput
            label={referenceLabel(method)}
            type="text"
            placeholder={method === 'Cheque' ? 'e.g. 004512' : 'e.g. 415223987654'}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            disabled={isSaving}
            accent="emerald"
          />
        )}

        {(method === 'Cheque' || method === 'Bank transfer') && (
          <FormInput
            label="Bank name"
            type="text"
            placeholder="e.g. SBI, HDFC"
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            disabled={isSaving}
            accent="emerald"
          />
        )}

        {problem?.near === 'save' && (
          <div ref={problemRef}>
            <FormError
              message={`${problem.message} Nothing you typed here is lost — it stays on screen until it saves.`}
              detail={problem.detail}
            />
          </div>
        )}

        <ModalActions
          onCancel={onClose}
          submitLabel="Save payment"
          submitAccent="emerald"
          isSubmitting={isSaving}
        />
      </form>
    </AppModal>
  );
}
