import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Banknote,
  Building2,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Layers,
  Loader2,
  Maximize2,
  Pencil,
  Plus,
  ReceiptText,
  Search,
  Sparkles,
  Trash2,
  Truck,
  Wallet,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { BillLineItem, BillPayment, PaymentMethod, PurchaseBill } from '../types';
import {
  deleteBillPaymentFromDb,
  deleteBillPaymentGroupFromDb,
  deletePurchaseBillFromDb,
  fetchBillPayments,
  fetchPurchaseBills,
  insertBillPayment,
  insertBillPayments,
  insertPurchaseBill,
  updatePurchaseBillInDb,
  uploadBillPhoto,
} from '../lib/database';
import {
  extractBillFromImage,
  extractPaymentFromImage,
  isPhotoFillAvailable,
  PhotoReadError,
} from '../lib/extractBill';
import { describeDbError, FriendlyError } from '../lib/dbErrors';
import { loadLocalFirst, localCopy, SAVED_COPY_NOTE } from '../lib/localFirst';
import { ShowMoreButton, useShowMore } from './ShowMore';
import { playSuccessChime, unlockSound } from '../lib/sounds';
import { AppModal } from './AppModal';
import { FormError, FormInput, ModalActions } from './FormInput';
import { DateField } from './DateField';
import { ImageViewer } from './ImageViewer';
import { PhotoPicker } from './PhotoPicker';
import { PremiumSelect } from './PremiumSelect';

interface BillsSectionProps {
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

interface ItemRow {
  name: string;
  hsn: string;
  quantity: string;
  unit: string;
  rate: string;
  amount: string;
}

interface DiscountRow {
  name: string;
  amount: string;
}

interface PhotoToView {
  url: string;
  title: string;
  subtitle: string;
  downloadName: string;
}

const EMPTY_ROW: ItemRow = { name: '', hsn: '', quantity: '', unit: '', rate: '', amount: '' };

const UNIT_SUGGESTIONS = ['Piece', 'Meter', 'Kg', 'Box', 'Dozen', 'Roll', 'Set', 'Bundle'];

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

/** Money in whole paise, so totals of many bills never drift by a fraction. */
function toPaise(amount: number): number {
  return Math.round(amount * 100);
}

/** Same party typed with different capitals or spacing is still the same party. */
function normalizeParty(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** "INV 1042" and "inv1042" are the same bill number. */
function normalizeBillNo(billNo: string): string {
  return billNo.toLowerCase().replace(/\s+/g, '');
}

function todayISO(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${mm}-${dd}`;
}

/**
 * Where the message belongs. A validation message points at a field near the
 * top of the form; a failed save belongs beside the button that was pressed,
 * which in these long forms is a whole screen away from the top.
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

/** Kept on this phone, so the page opens at once with the last copy. */
const firmBillsCopy = localCopy<{ bills: PurchaseBill[]; payments: BillPayment[] }>('firm-bills');

async function fetchFirmBills() {
  const [bills, payments] = await Promise.all([
    fetchPurchaseBills(),
    fetchBillPayments(),
  ]);
  return { bills, payments };
}

export function BillsSection({ showToast }: BillsSectionProps) {
  const [bills, setBills] = useState<PurchaseBill[]>([]);
  const [payments, setPayments] = useState<BillPayment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<FriendlyError | null>(null);

  // List controls
  const [view, setView] = useState<'bills' | 'firms'>('bills');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'due' | 'paid'>('all');
  const [firmFilter, setFirmFilter] = useState<string | null>(null);

  // Modals
  const [isAddBillOpen, setIsAddBillOpen] = useState(false);
  const [editingBillId, setEditingBillId] = useState<string | null>(null);
  const [detailBillId, setDetailBillId] = useState<string | null>(null);
  const [paymentBillId, setPaymentBillId] = useState<string | null>(null);
  // null = closed, '' = open with no party picked yet
  const [combinedPayFirm, setCombinedPayFirm] = useState<string | null>(null);
  const [deletingBillId, setDeletingBillId] = useState<string | null>(null);
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);
  const [viewingPhoto, setViewingPhoto] = useState<PhotoToView | null>(null);

  const [isFresh, setIsFresh] = useState(false);

  const loadData = async () => {
    // "Try again" after a failure: there is nothing to show meanwhile.
    if (loadError) setIsLoading(true);
    setLoadError(null);
    try {
      const result = await loadLocalFirst(firmBillsCopy, fetchFirmBills, (data, fresh) => {
        setBills(data.bills);
        setPayments(data.payments);
        setIsLoading(false);
        if (fresh) setIsFresh(true);
      });
      if (result === 'copy') showToast(SAVED_COPY_NOTE, 'info');
    } catch (err) {
      console.error('Loading the bills failed:', err);
      setLoadError(describeDbError(err, 'Your party bills could not be loaded'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Changes made on this page go into the saved copy too.
  useEffect(() => {
    if (isFresh) firmBillsCopy.write({ bills, payments });
  }, [isFresh, bills, payments]);

  const paidByBill = useMemo(() => {
    const map = new Map<string, number>();
    for (const payment of payments) {
      map.set(payment.billId, (map.get(payment.billId) ?? 0) + payment.amount);
    }
    return map;
  }, [payments]);

  const getPaid = (billId: string) => paidByBill.get(billId) ?? 0;
  const getBalance = (bill: PurchaseBill) => Math.max(0, bill.netAmount - getPaid(bill.id));

  const firmNames = useMemo(
    () => Array.from(new Set(bills.map((b) => b.firmName.trim()))).sort(),
    [bills]
  );

  const firmSummaries = useMemo(() => {
    const map = new Map<
      string,
      { name: string; billCount: number; dueCount: number; purchased: number; paid: number }
    >();
    for (const bill of bills) {
      const key = bill.firmName.trim();
      const entry = map.get(key) ?? { name: key, billCount: 0, dueCount: 0, purchased: 0, paid: 0 };
      entry.billCount += 1;
      if (getBalance(bill) > 0) entry.dueCount += 1;
      entry.purchased += bill.netAmount;
      entry.paid += Math.min(getPaid(bill.id), bill.netAmount);
      map.set(key, entry);
    }
    return Array.from(map.values()).sort(
      (a, b) => b.purchased - b.paid - (a.purchased - a.paid)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bills, paidByBill]);

  const filteredBills = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bills.filter((bill) => {
      if (firmFilter && bill.firmName.trim() !== firmFilter) return false;
      const balance = getBalance(bill);
      if (statusFilter === 'due' && balance <= 0) return false;
      if (statusFilter === 'paid' && balance > 0) return false;
      if (!q) return true;
      return (
        bill.firmName.toLowerCase().includes(q) ||
        bill.billNo.toLowerCase().includes(q) ||
        bill.transportName.toLowerCase().includes(q) ||
        bill.lrNo.toLowerCase().includes(q)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bills, search, statusFilter, firmFilter, paidByBill]);

  // Long lists draw their first bills only; totals still use them all.
  const shownBills = useShowMore(filteredBills, `${search}|${statusFilter}|${firmFilter}`);

  const detailBill = detailBillId ? bills.find((b) => b.id === detailBillId) ?? null : null;
  const paymentBill = paymentBillId ? bills.find((b) => b.id === paymentBillId) ?? null : null;
  const deletingBill = deletingBillId ? bills.find((b) => b.id === deletingBillId) ?? null : null;
  const editingBill = editingBillId ? bills.find((b) => b.id === editingBillId) ?? null : null;
  const deletingPayment = deletingPaymentId
    ? payments.find((p) => p.id === deletingPaymentId) ?? null
    : null;
  const deletingGroup = deletingPayment?.groupId
    ? payments.filter((p) => p.groupId === deletingPayment.groupId)
    : [];
  const partiesWithDues = firmSummaries.filter((f) => f.dueCount > 0);
  const firmFilterHasDues = Boolean(
    firmFilter && partiesWithDues.some((f) => f.name === firmFilter)
  );

  const billNoOf = (billId: string) => bills.find((b) => b.id === billId)?.billNo || '—';

  const handleBillSaved = (bill: PurchaseBill, wasEdited: boolean) => {
    if (wasEdited) {
      setBills((prev) => prev.map((b) => (b.id === bill.id ? bill : b)));
      setEditingBillId(null);
      // Back to the detail view so the corrected bill can be checked right away.
      setDetailBillId(bill.id);
      showToast(`Bill from "${bill.firmName}" updated.`, 'success');
      return;
    }
    setBills((prev) => [bill, ...prev]);
    setIsAddBillOpen(false);
    showToast(`Bill from "${bill.firmName}" saved — ${formatMoney(bill.netAmount)} to pay.`, 'success');
  };

  const handlePaymentSaved = (payment: BillPayment, firmName: string) => {
    setPayments((prev) => [payment, ...prev]);
    setPaymentBillId(null);
    showToast(`Payment of ${formatMoney(payment.amount)} to "${firmName}" saved.`, 'success');
  };

  const handleDeleteBill = async () => {
    if (!deletingBill) return;
    try {
      await deletePurchaseBillFromDb(deletingBill.id);
      setBills((prev) => prev.filter((b) => b.id !== deletingBill.id));
      setPayments((prev) => prev.filter((p) => p.billId !== deletingBill.id));
      setDeletingBillId(null);
      setDetailBillId(null);
      showToast(`Bill from "${deletingBill.firmName}" removed.`, 'info');
    } catch {
      showToast('Could not remove this bill. Please try again.', 'error');
    }
  };

  const handleCombinedSaved = (saved: BillPayment[], firmName: string) => {
    const total = saved.reduce((sum, p) => sum + toPaise(p.amount), 0) / 100;
    const billCount = new Set(saved.map((p) => p.billId)).size;
    const paymentCount = new Set(saved.map((p) => p.groupId ?? p.id)).size;
    setPayments((prev) => [...saved, ...prev]);
    setCombinedPayFirm(null);
    showToast(
      `${paymentCount > 1 ? `${paymentCount} payments` : 'Payment'} of ${formatMoney(
        total
      )} to "${firmName}" saved against ${billCount} ${billCount === 1 ? 'bill' : 'bills'}.`,
      'success'
    );
  };

  const handleDeletePayment = async () => {
    if (!deletingPayment) return;
    try {
      const groupId = deletingPayment.groupId;
      if (groupId) {
        // A combined payment is one real payment — removing only one bill's
        // share would leave the others claiming money that was never matched.
        await deleteBillPaymentGroupFromDb(groupId);
        setPayments((prev) => prev.filter((p) => p.groupId !== groupId));
      } else {
        await deleteBillPaymentFromDb(deletingPayment.id);
        setPayments((prev) => prev.filter((p) => p.id !== deletingPayment.id));
      }
      setDeletingPaymentId(null);
      showToast(
        groupId
          ? "Combined payment removed. Each bill's share is added back to its balance."
          : 'Payment entry removed. The amount is added back to the balance.',
        'info'
      );
    } catch {
      showToast('Could not remove this payment. Please try again.', 'error');
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#F8FAFC] p-6">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="h-8 w-8 animate-spin text-amber-600" />
          <p className="text-base font-medium">Loading party bills...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#F8FAFC] p-6">
        <div className="max-w-md w-full bg-white border border-red-200 rounded-xl p-6 shadow-lg text-center space-y-4">
          <ReceiptText className="h-10 w-10 text-red-500 mx-auto" />
          <h2 className="text-xl font-bold text-slate-900">Could not load party bills</h2>
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
    <div className="@container flex-1 overflow-y-auto bg-[#F8FAFC] p-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:p-6 md:p-8 space-y-4 sm:space-y-5 font-sans text-slate-900 selection:bg-amber-500 selection:text-white">
      {/* View tabs + filters */}
      <div className="flex flex-col gap-2 @xl:gap-3">
        <div className="flex flex-wrap items-center gap-2 @xl:gap-3">
          <div className="flex rounded-lg bg-slate-100 p-0.5">
            {(
              [
                { key: 'bills' as const, label: 'Bills', shortLabel: 'Bills' },
                { key: 'firms' as const, label: 'Party-wise total', shortLabel: 'By party' },
              ]
            ).map(({ key, label, shortLabel }) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                className={`px-3 py-2 @xl:px-4 text-sm rounded-md font-semibold cursor-pointer transition-colors whitespace-nowrap ${
                  view === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <span className="@xl:hidden">{shortLabel}</span>
                <span className="hidden @xl:inline">{label}</span>
              </button>
            ))}
          </div>
          {/* Kept together so a narrow screen wraps both to the next line, not one */}
          <div className="ml-auto flex items-center gap-2 @xl:gap-3">
            {partiesWithDues.length > 0 && (
              <button
                type="button"
                onClick={() => setCombinedPayFirm(firmFilterHasDues ? firmFilter : '')}
                title="Pay several bills of one party with a single payment"
                className="shrink-0 flex items-center gap-1.5 px-3 py-2 @xl:px-4 @xl:py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold whitespace-nowrap shadow-xs cursor-pointer transition-all"
              >
                <Layers className="h-4 w-4" />
                <span className="@xl:hidden">Pay many</span>
                <span className="hidden @xl:inline">Pay bills together</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsAddBillOpen(true)}
              className="shrink-0 flex items-center gap-1.5 px-3 py-2 @xl:px-4 @xl:py-2.5 bg-[#0F172A] hover:bg-slate-800 text-white rounded-lg text-sm font-bold whitespace-nowrap shadow-xs cursor-pointer transition-all"
            >
              <Plus className="h-4 w-4" />
              Add bill
            </button>
          </div>
        </div>

        {view === 'bills' && (
          <div className="flex flex-col @xl:flex-row @xl:items-center gap-2">
            <div className="relative w-full @xl:max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search party or bill number..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-white border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 w-full transition-all"
              />
            </div>
            <div className="flex rounded-lg bg-slate-50 p-0.5 border border-slate-200 w-full @xl:w-auto">
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
                  className={`flex-1 @xl:flex-none px-2 py-2 @xl:px-3 text-xs @xl:text-sm rounded-md font-semibold whitespace-nowrap cursor-pointer transition-colors ${
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

        {view === 'bills' && firmFilter && (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 bg-amber-50 text-amber-800 border border-amber-200 rounded-full text-xs font-semibold max-w-full">
              <Building2 className="h-3 w-3 shrink-0" />
              <span className="truncate">{firmFilter}</span>
              <button
                type="button"
                onClick={() => setFirmFilter(null)}
                className="p-1 hover:bg-amber-100 rounded-full cursor-pointer shrink-0"
                aria-label="Show all parties"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
            {firmFilterHasDues && (
              <button
                type="button"
                onClick={() => setCombinedPayFirm(firmFilter)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-full cursor-pointer whitespace-nowrap transition-colors"
              >
                <Layers className="h-3.5 w-3.5" />
                Pay these bills together
              </button>
            )}
          </div>
        )}
      </div>

      {/* Firms view */}
      {view === 'firms' && (
        <div className="space-y-3">
          {firmSummaries.length === 0 ? (
            <EmptyState onAdd={() => setIsAddBillOpen(true)} />
          ) : (
            firmSummaries.map((firm) => {
              const due = Math.max(0, firm.purchased - firm.paid);
              return (
                <div
                  key={firm.name}
                  className="bg-white border border-slate-200 rounded-xl shadow-xs hover:border-amber-300 transition-colors overflow-hidden"
                >
                <button
                  type="button"
                  onClick={() => {
                    setFirmFilter(firm.name);
                    setView('bills');
                  }}
                  className="w-full text-left p-4 cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-base font-bold text-slate-900 truncate">{firm.name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {firm.billCount} {firm.billCount === 1 ? 'bill' : 'bills'}
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
                      <p className="text-xs text-slate-500">Bought</p>
                      <p className="font-bold text-slate-900 tabular-nums">{formatMoney(firm.purchased)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Paid</p>
                      <p className="font-bold text-emerald-700 tabular-nums">{formatMoney(firm.paid)}</p>
                    </div>
                  </div>
                </button>
                {firm.dueCount > 1 && (
                  <div className="px-4 pb-4">
                    <button
                      type="button"
                      onClick={() => setCombinedPayFirm(firm.name)}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold cursor-pointer transition-colors"
                    >
                      <Layers className="h-4 w-4" />
                      Pay {firm.dueCount} bills together
                    </button>
                  </div>
                )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Bills view */}
      {view === 'bills' && (
        <>
          <div className="space-y-3 @3xl:grid @3xl:grid-cols-2 @6xl:grid-cols-3 @3xl:gap-4 @3xl:space-y-0">
            {filteredBills.length === 0 ? (
              <div className="@3xl:col-span-2 @6xl:col-span-3">
                {bills.length === 0 ? (
                  <EmptyState onAdd={() => setIsAddBillOpen(true)} />
                ) : (
                  <div className="p-8 text-center text-slate-400 text-sm bg-white border border-slate-200 rounded-xl">
                    No bills match your search or filter.
                  </div>
                )}
              </div>
            ) : (
              shownBills.visible.map((bill) => {
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
                          <p className="text-base font-bold text-slate-900 truncate">{bill.firmName}</p>
                          <p className="text-sm text-slate-500 mt-0.5 truncate">
                            Bill {bill.billNo || '—'} · {formatDate(bill.billDate)}
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
                              {formatMoney(bill.netAmount)}
                            </p>
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs text-slate-500">Paid</p>
                            <p className="font-bold text-emerald-700 tabular-nums truncate">
                              {formatMoney(paid)}
                            </p>
                          </div>
                        </div>
                        {bill.transportName && (
                          <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500 min-w-0">
                            <Truck className="h-3.5 w-3.5 shrink-0" />
                            <span className="font-semibold text-slate-700 truncate">
                              {bill.transportName}
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
          <ShowMoreButton hidden={shownBills.hidden} onMore={shownBills.showMore} />
        </>
      )}

      {/* Add / edit bill modal */}
      <BillFormModal
        open={isAddBillOpen || Boolean(editingBill)}
        bill={editingBill}
        onClose={() => {
          setIsAddBillOpen(false);
          setEditingBillId(null);
        }}
        firmNames={firmNames}
        existingBills={bills}
        onSaved={handleBillSaved}
        showToast={showToast}
      />

      {/* Bill detail modal */}
      <AppModal
        open={Boolean(detailBill)}
        onClose={() => setDetailBillId(null)}
        title={detailBill?.firmName ?? ''}
        description={detailBill ? `Bill ${detailBill.billNo || '—'} · ${formatDate(detailBill.billDate)}` : undefined}
        icon={<ReceiptText className="h-5 w-5" />}
        accent="amber"
      >
        {detailBill && (
          <div className="space-y-5">
            {/* Amount summary — one row per amount on phones so nothing is cut off */}
            <div className="space-y-2 sm:space-y-0 sm:grid sm:grid-cols-3 sm:gap-2">
              <AmountTile label="Bill amount" value={formatMoney(detailBill.netAmount)} />
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
              <InfoRow label="Bill number" value={detailBill.billNo || '—'} />
              <InfoRow label="Bill date" value={formatDate(detailBill.billDate)} />
              <InfoRow label="GST number" value={detailBill.gstNumber || '—'} />
              <InfoRow label="LR number" value={detailBill.lrNo || '—'} />
              <InfoRow label="Transport" value={detailBill.transportName || '—'} />
            </div>

            {/* Items */}
            <BillItems bill={detailBill} />

            {detailBill.photoUrl && (
              <PhotoThumbButton
                url={detailBill.photoUrl}
                label="Bill photo"
                hint="Tap to zoom, rotate or save"
                onOpen={() =>
                  setViewingPhoto({
                    url: detailBill.photoUrl as string,
                    title: detailBill.firmName,
                    subtitle: `Bill ${detailBill.billNo || '—'} · ${formatDate(detailBill.billDate)}`,
                    downloadName: `${detailBill.firmName} bill ${detailBill.billNo || ''}`,
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
                    .map((payment) => {
                      const group = payment.groupId
                        ? payments.filter((p) => p.groupId === payment.groupId)
                        : [];
                      const groupTotal =
                        group.reduce((sum, p) => sum + toPaise(p.amount), 0) / 100;
                      const groupBillNos = group.map((p) => billNoOf(p.billId)).join(', ');
                      return (
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
                          {group.length > 1 && (
                            <p className="mt-1.5 inline-flex items-start gap-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1">
                              <Layers className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                              <span className="break-words">
                                Share of one payment of {formatMoney(groupTotal)} for{' '}
                                {group.length} bills ({groupBillNos})
                              </span>
                            </p>
                          )}
                          {payment.photoUrl && (
                            <button
                              type="button"
                              onClick={() =>
                                setViewingPhoto({
                                  url: payment.photoUrl as string,
                                  title:
                                    group.length > 1
                                      ? `${formatMoney(groupTotal)} · ${payment.method} · ${group.length} bills`
                                      : `${formatMoney(payment.amount)} · ${payment.method}`,
                                  subtitle:
                                    group.length > 1
                                      ? `${detailBill.firmName} · Bills ${groupBillNos} · ${formatDate(payment.paidOn)}`
                                      : `${detailBill.firmName} · ${formatDate(payment.paidOn)}`,
                                  downloadName: `${detailBill.firmName} payment ${formatDate(payment.paidOn)}`,
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
                      );
                    })}
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
        <AddPaymentModal
          bill={paymentBill}
          balance={getBalance(paymentBill)}
          onClose={() => setPaymentBillId(null)}
          onSaved={handlePaymentSaved}
          showToast={showToast}
        />
      )}

      {/* One payment covering several bills of a party */}
      {combinedPayFirm !== null && (
        <CombinedPaymentModal
          initialFirm={combinedPayFirm}
          parties={partiesWithDues.map((f) => f.name)}
          bills={bills}
          getBalance={getBalance}
          onClose={() => setCombinedPayFirm(null)}
          onSaved={handleCombinedSaved}
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
            ? `The bill from "${deletingBill.firmName}" and all its payment entries will be removed. This cannot be undone.`
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
        open={Boolean(deletingPayment)}
        onClose={() => setDeletingPaymentId(null)}
        title={deletingGroup.length > 1 ? 'Remove this whole payment?' : 'Remove this payment entry?'}
        description={
          deletingGroup.length > 1
            ? `This was one payment of ${formatMoney(
                deletingGroup.reduce((sum, p) => sum + toPaise(p.amount), 0) / 100
              )} covering ${deletingGroup.length} bills (${deletingGroup
                .map((p) => billNoOf(p.billId))
                .join(', ')}). It will be removed from all of them, and each bill's share added back to its balance.`
            : "The amount will be added back to the bill's balance."
        }
        icon={<Trash2 className="h-5 w-5" />}
        accent="red"
      >
        <ModalActions
          onCancel={() => setDeletingPaymentId(null)}
          submitLabel={deletingGroup.length > 1 ? 'Remove whole payment' : 'Remove payment'}
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

/**
 * Items are shown as stacked cards on phones — a four column table gets
 * squeezed to the point where the amount is unreadable on a small screen.
 */
function BillItems({ bill }: { bill: PurchaseBill }) {
  return (
    <div>
      <h4 className="text-sm font-bold text-slate-800 mb-2">Items on this bill</h4>

      <div className="space-y-2 sm:hidden">
        {bill.items.map((item, index) => (
          <div key={index} className="border border-slate-200 rounded-xl p-3 bg-white">
            <p className="text-sm font-semibold text-slate-800 break-words">{item.name}</p>
            {item.hsn && (
              <p className="text-xs text-slate-500 mt-0.5">HSN/SAC: {item.hsn}</p>
            )}
            <div className="flex items-end justify-between gap-3 mt-2 pt-2 border-t border-slate-100">
              <p className="text-xs text-slate-500 tabular-nums">
                {item.quantity ? `${item.quantity}${item.unit ? ` ${item.unit}` : ''}` : '—'}
                {item.rate ? ` × ${formatMoney(item.rate)}` : ''}
              </p>
              <p className="text-sm font-bold text-slate-900 tabular-nums whitespace-nowrap">
                {formatMoney(item.amount)}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden sm:block border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-xs font-bold text-slate-500 border-b border-slate-200">
              <th className="text-left px-3 py-2">Item</th>
              <th className="text-left px-3 py-2 whitespace-nowrap">HSN/SAC</th>
              <th className="text-right px-3 py-2">Qty</th>
              <th className="text-right px-3 py-2">Rate</th>
              <th className="text-right px-3 py-2">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {bill.items.map((item, index) => (
              <tr key={index}>
                <td className="px-3 py-2 font-semibold text-slate-800 break-words">{item.name}</td>
                <td className="px-3 py-2 tabular-nums text-slate-600 whitespace-nowrap">
                  {item.hsn || '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600 whitespace-nowrap">
                  {item.quantity ? `${item.quantity}${item.unit ? ` ${item.unit}` : ''}` : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                  {item.rate ? formatMoney(item.rate) : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">
                  {formatMoney(item.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div className="mt-2 border border-slate-200 rounded-xl overflow-hidden text-sm">
        <div className="flex items-center justify-between gap-3 px-3 py-2">
          <span className="text-slate-500">Total</span>
          <span className="font-semibold tabular-nums">{formatMoney(bill.grossAmount)}</span>
        </div>
        {bill.discounts.map((d, index) => (
          <div
            key={index}
            className="flex items-center justify-between gap-3 px-3 py-2 border-t border-slate-100"
          >
            <span className="text-slate-500">{d.name}</span>
            <span className="font-semibold tabular-nums text-emerald-700">
              − {formatMoney(d.amount)}
            </span>
          </div>
        ))}
        {bill.gstAmount > 0 && (
          <div className="flex items-center justify-between gap-3 px-3 py-2 border-t border-slate-100">
            <span className="text-slate-500">GST / tax</span>
            <span className="font-semibold tabular-nums text-slate-700">
              + {formatMoney(bill.gstAmount)}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 px-3 py-2.5 bg-slate-50 border-t border-slate-200">
          <span className="font-bold text-slate-800">Final amount to pay</span>
          <span className="font-bold tabular-nums text-slate-900 whitespace-nowrap">
            {formatMoney(bill.netAmount)}
          </span>
        </div>
      </div>
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
      <ReceiptText className="h-10 w-10 mx-auto text-slate-300 mb-3" />
      <p className="text-base font-bold text-slate-700">No bills saved yet</p>
      <p className="text-sm text-slate-500 mt-1 leading-relaxed">
        When goods arrive from a party, save the bill here. You can then record every payment and
        always know how much is left to pay.
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

interface BillFormModalProps {
  open: boolean;
  /** The saved bill being corrected, or null when adding a new one. */
  bill: PurchaseBill | null;
  onClose: () => void;
  firmNames: string[];
  /** Every saved bill, to stop the same bill being entered twice. */
  existingBills: PurchaseBill[];
  onSaved: (bill: PurchaseBill, wasEdited: boolean) => void;
  showToast: BillsSectionProps['showToast'];
}

function BillFormModal({
  open,
  bill,
  onClose,
  firmNames,
  existingBills,
  onSaved,
  showToast,
}: BillFormModalProps) {
  const isEditing = Boolean(bill);
  const [firmName, setFirmName] = useState('');
  const [billNo, setBillNo] = useState('');
  const [billDate, setBillDate] = useState(todayISO());
  const [gstNumber, setGstNumber] = useState('');
  const [lrNo, setLrNo] = useState('');
  const [transportName, setTransportName] = useState('');
  const [rows, setRows] = useState<ItemRow[]>([{ ...EMPTY_ROW }]);
  const [discountRows, setDiscountRows] = useState<DiscountRow[]>([]);
  const [gstAmount, setGstAmount] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [savedPhotoUrl, setSavedPhotoUrl] = useState<string | null>(null);
  const [problem, setProblem] = useState<FormProblem | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const problemRef = useProblemScroll(problem);

  const gross = rows.reduce((sum, row) => sum + parseNum(row.amount), 0);
  const totalDiscount = discountRows.reduce((sum, row) => sum + parseNum(row.amount), 0);
  const gst = parseNum(gstAmount);
  const net = Math.max(0, gross - totalDiscount + gst);

  // Bill numbers only have to be unique per party — two suppliers can both
  // print "Bill 1042".
  const duplicateOf = useMemo(() => {
    const party = normalizeParty(firmName);
    const number = normalizeBillNo(billNo);
    if (!party || !number) return null;
    return (
      existingBills.find(
        (b) =>
          b.id !== bill?.id &&
          normalizeParty(b.firmName) === party &&
          normalizeBillNo(b.billNo) === number
      ) ?? null
    );
  }, [existingBills, firmName, billNo, bill?.id]);

  const duplicateMessage = duplicateOf
    ? `Bill ${duplicateOf.billNo} from "${duplicateOf.firmName}" is already saved (${formatDate(
        duplicateOf.billDate
      )}, ${formatMoney(duplicateOf.netAmount)}). The same bill cannot be entered twice.`
    : '';

  const reset = () => {
    setFirmName('');
    setBillNo('');
    setBillDate(todayISO());
    setGstNumber('');
    setLrNo('');
    setTransportName('');
    setRows([{ ...EMPTY_ROW }]);
    setDiscountRows([]);
    setGstAmount('');
    setPhotoFile(null);
    setSavedPhotoUrl(null);
    setProblem(null);
    setIsSaving(false);
    setIsExtracting(false);
  };

  const fillFormFrom = (source: PurchaseBill) => {
    setFirmName(source.firmName);
    setBillNo(source.billNo);
    setBillDate(source.billDate || todayISO());
    setGstNumber(source.gstNumber);
    setLrNo(source.lrNo);
    setTransportName(source.transportName);
    setRows(
      source.items.length > 0
        ? source.items.map((item) => ({
            name: item.name,
            hsn: item.hsn,
            quantity: item.quantity ? String(item.quantity) : '',
            unit: item.unit,
            rate: item.rate ? String(item.rate) : '',
            amount: item.amount ? String(item.amount) : '',
          }))
        : [{ ...EMPTY_ROW }]
    );
    setDiscountRows(source.discounts.map((d) => ({ name: d.name, amount: String(d.amount) })));
    setGstAmount(source.gstAmount ? String(source.gstAmount) : '');
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

  const updateRow = (index: number, patch: Partial<ItemRow>) => {
    setRows((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        const next = { ...row, ...patch };
        // Auto-calculate amount when qty or rate changes
        if ('quantity' in patch || 'rate' in patch) {
          const qty = parseNum(next.quantity);
          const rate = parseNum(next.rate);
          if (qty > 0 && rate > 0) {
            next.amount = String(Math.round(qty * rate * 100) / 100);
          }
        }
        return next;
      })
    );
  };

  const fillFromPhoto = async (file: File) => {
    setIsExtracting(true);
    setProblem(null);
    try {
      const extracted = await extractBillFromImage(file);
      if (extracted.firmName) setFirmName(extracted.firmName);
      if (extracted.billNo) setBillNo(extracted.billNo);
      if (extracted.billDate) setBillDate(extracted.billDate);
      if (extracted.gstNumber) setGstNumber(extracted.gstNumber);
      if (extracted.lrNo) setLrNo(extracted.lrNo);
      if (extracted.transportName) setTransportName(extracted.transportName);
      if (extracted.discounts.length > 0) {
        setDiscountRows(
          extracted.discounts.map((d) => ({ name: d.name, amount: String(d.amount) }))
        );
      }
      if (extracted.gstAmount > 0) setGstAmount(String(extracted.gstAmount));
      if (extracted.items.length > 0) {
        setRows(
          extracted.items.map((item) => ({
            name: item.name,
            hsn: item.hsn,
            quantity: item.quantity ? String(item.quantity) : '',
            unit: item.unit,
            rate: item.rate ? String(item.rate) : '',
            amount: item.amount ? String(item.amount) : '',
          }))
        );
      }
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

  /** Reads the already-saved bill photo again, for when the first read was wrong. */
  const handleReadSavedPhotoAgain = async () => {
    if (!savedPhotoUrl) return;
    unlockSound();
    setIsExtracting(true);
    let file: File;
    try {
      const response = await fetch(savedPhotoUrl);
      if (!response.ok) throw new Error('Could not download the saved photo');
      const blob = await response.blob();
      file = new File([blob], 'saved-bill.jpg', { type: blob.type || 'image/jpeg' });
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

    if (!firmName.trim()) {
      setProblem(fieldProblem('Please enter the party name (who you bought from).'));
      return;
    }
    if (!billNo.trim()) {
      setProblem(fieldProblem('Please enter the bill number.'));
      return;
    }
    if (duplicateOf) {
      setProblem(fieldProblem(duplicateMessage));
      return;
    }
    const items: BillLineItem[] = rows
      .filter((row) => row.name.trim() || parseNum(row.amount) > 0)
      .map((row) => ({
        name: row.name.trim(),
        hsn: row.hsn.trim(),
        quantity: parseNum(row.quantity),
        unit: row.unit.trim(),
        rate: parseNum(row.rate),
        amount: parseNum(row.amount),
      }));
    if (items.length === 0) {
      setProblem(fieldProblem('Please add at least one item with its amount.'));
      return;
    }
    if (items.some((item) => !item.name)) {
      setProblem(fieldProblem('Every item needs a name.'));
      return;
    }
    if (net <= 0) {
      setProblem(
        fieldProblem(
          'The final amount to pay must be more than zero. Check the amounts and discounts.'
        )
      );
      return;
    }
    const discounts = discountRows
      .filter((row) => parseNum(row.amount) > 0)
      .map((row) => ({ name: row.name.trim() || 'Discount', amount: parseNum(row.amount) }));

    setIsSaving(true);
    let photoUrl: string | null = savedPhotoUrl;
    if (photoFile) {
      const uploaded = await uploadBillPhoto(photoFile, 'bills');
      if (uploaded) photoUrl = uploaded;
      else showToast('The photo could not be uploaded, but the bill will still be saved.', 'info');
    }

    const saved: PurchaseBill = {
      id: bill?.id ?? `pb-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      firmName: firmName.trim(),
      billNo: billNo.trim(),
      billDate,
      gstNumber: gstNumber.trim().toUpperCase(),
      lrNo: lrNo.trim(),
      transportName: transportName.trim(),
      items,
      grossAmount: Math.round(gross * 100) / 100,
      discounts,
      discount: Math.round(totalDiscount * 100) / 100,
      gstAmount: Math.round(gst * 100) / 100,
      netAmount: Math.round(net * 100) / 100,
      photoUrl,
      createdAt: bill?.createdAt ?? new Date().toISOString(),
    };

    try {
      if (bill) await updatePurchaseBillInDb(saved);
      else await insertPurchaseBill(saved);
      reset();
      onSaved(saved, Boolean(bill));
    } catch (err) {
      console.error('Saving the bill failed:', err);
      setIsSaving(false);
      // The database's own duplicate guard caught one this device did not know
      // about yet (e.g. saved from another phone a moment ago).
      if ((err as { code?: string })?.code === '23505') {
        setProblem(
          fieldProblem(
            `Bill ${saved.billNo} from "${saved.firmName}" is already saved. The same bill cannot be entered twice — reload the page to see it.`
          )
        );
        return;
      }
      setProblem(
        saveProblem(err, bill ? 'Your changes could not be saved' : 'The bill could not be saved')
      );
    }
  };

  return (
    <AppModal
      open={open}
      onClose={handleClose}
      title={isEditing ? 'Edit this bill' : 'Add party bill'}
      description={
        isEditing
          ? 'Correct anything that is wrong and save again'
          : 'Save a bill of goods you bought from a party'
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
                <p className="text-sm font-semibold text-slate-700">Saved bill photo</p>
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
          label={savedPhotoUrl ? 'Replace bill photo' : 'Add bill photo'}
          file={photoFile}
          onSelect={setPhotoFile}
          onAutoFill={handleAutoFill}
          isExtracting={isExtracting}
          autoFillLabel="Fill details from photo"
          inputId="bill-photo-input"
        />

        <div className="space-y-1.5">
          <label className="block text-sm font-semibold text-slate-700">Party name</label>
          <input
            type="text"
            required
            list="firm-name-suggestions"
            placeholder="e.g. Sharma Textiles"
            value={firmName}
            onChange={(e) => {
              setFirmName(e.target.value);
              if (problem?.near === 'fields') setProblem(null);
            }}
            disabled={isSaving}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3.5 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-4 focus:border-amber-500 focus:ring-amber-500/15 transition-all"
          />
          <datalist id="firm-name-suggestions">
            {firmNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormInput
            label="Bill number"
            type="text"
            required
            placeholder="e.g. 1042"
            value={billNo}
            onChange={(e) => {
              setBillNo(e.target.value);
              if (problem?.near === 'fields') setProblem(null);
            }}
            disabled={isSaving}
            accent="amber"
            aria-invalid={Boolean(duplicateOf)}
          />
          <DateField
            label="Bill date"
            value={billDate}
            onChange={setBillDate}
            disabled={isSaving}
            accent="amber"
          />
        </div>

        {duplicateOf && (
          <p
            role="alert"
            className="-mt-2 text-sm font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5 leading-relaxed"
          >
            {duplicateMessage}
          </p>
        )}

        <FormInput
          label="GST number of the party (optional)"
          type="text"
          placeholder="e.g. 24ABCDE1234F1Z5"
          value={gstNumber}
          onChange={(e) => setGstNumber(e.target.value.toUpperCase())}
          disabled={isSaving}
          maxLength={15}
          accent="amber"
          className="uppercase"
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormInput
            label="LR number (optional)"
            type="text"
            placeholder="Lorry receipt no."
            value={lrNo}
            onChange={(e) => setLrNo(e.target.value)}
            disabled={isSaving}
            accent="amber"
          />
          <FormInput
            label="Transport name (optional)"
            type="text"
            placeholder="e.g. VRL Logistics"
            value={transportName}
            onChange={(e) => setTransportName(e.target.value)}
            disabled={isSaving}
            accent="amber"
          />
        </div>

        {/* Items */}
        <div className="space-y-3">
          <label className="block text-sm font-semibold text-slate-700">Items on the bill</label>
          {rows.map((row, index) => (
            <div key={index} className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2.5">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder={`Item ${index + 1} name`}
                  value={row.name}
                  onChange={(e) => updateRow(index, { name: e.target.value })}
                  disabled={isSaving}
                  className="flex-1 min-w-0 bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 transition-all"
                />
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                    className="p-2.5 text-slate-400 hover:text-red-600 bg-white border border-slate-200 rounded-lg cursor-pointer shrink-0"
                    aria-label="Remove this item"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  HSN / SAC code
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="e.g. 5208"
                  maxLength={10}
                  value={row.hsn}
                  onChange={(e) => updateRow(index, { hsn: e.target.value })}
                  disabled={isSaving}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 transition-all tabular-nums"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Qty</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    placeholder="0"
                    value={row.quantity}
                    onChange={(e) => updateRow(index, { quantity: e.target.value })}
                    disabled={isSaving}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 transition-all tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Unit</label>
                  <input
                    type="text"
                    list="unit-suggestions"
                    placeholder="e.g. Meter"
                    value={row.unit}
                    onChange={(e) => updateRow(index, { unit: e.target.value })}
                    disabled={isSaving}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 transition-all"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Rate ₹ per unit</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    placeholder="0"
                    value={row.rate}
                    onChange={(e) => updateRow(index, { rate: e.target.value })}
                    disabled={isSaving}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 transition-all tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Amount ₹</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    placeholder="0"
                    value={row.amount}
                    onChange={(e) => updateRow(index, { amount: e.target.value })}
                    disabled={isSaving}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-base font-semibold text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 transition-all tabular-nums"
                  />
                </div>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setRows((prev) => [...prev, { ...EMPTY_ROW }])}
            disabled={isSaving}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-slate-600 bg-white hover:bg-slate-50 border border-dashed border-slate-300 rounded-xl cursor-pointer transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add another item
          </button>
          <datalist id="unit-suggestions">
            {UNIT_SUGGESTIONS.map((unit) => (
              <option key={unit} value={unit} />
            ))}
          </datalist>
        </div>

        {/* Discounts */}
        <div className="space-y-2.5">
          <label className="block text-sm font-semibold text-slate-700">Discounts (if any)</label>
          {discountRows.map((row, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="text"
                placeholder="e.g. Cash discount"
                value={row.name}
                onChange={(e) =>
                  setDiscountRows((prev) =>
                    prev.map((r, i) => (i === index ? { ...r, name: e.target.value } : r))
                  )
                }
                disabled={isSaving}
                className="flex-1 min-w-0 bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 transition-all"
              />
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                placeholder="₹"
                value={row.amount}
                onChange={(e) =>
                  setDiscountRows((prev) =>
                    prev.map((r, i) => (i === index ? { ...r, amount: e.target.value } : r))
                  )
                }
                disabled={isSaving}
                className="w-28 bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 transition-all tabular-nums shrink-0"
              />
              <button
                type="button"
                onClick={() => setDiscountRows((prev) => prev.filter((_, i) => i !== index))}
                disabled={isSaving}
                className="p-2.5 text-slate-400 hover:text-red-600 bg-white border border-slate-200 rounded-lg cursor-pointer shrink-0"
                aria-label="Remove this discount"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setDiscountRows((prev) => [...prev, { name: '', amount: '' }])}
            disabled={isSaving}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-slate-600 bg-white hover:bg-slate-50 border border-dashed border-slate-300 rounded-xl cursor-pointer transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add a discount
          </button>
        </div>

        <FormInput
          label="GST / tax amount ₹ (if any)"
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          placeholder="CGST + SGST total"
          value={gstAmount}
          onChange={(e) => setGstAmount(e.target.value)}
          disabled={isSaving}
          accent="amber"
        />

        {/* Totals */}
        <div className="bg-[#0F172A] text-white rounded-xl p-4 space-y-1.5">
          <div className="flex items-center justify-between text-sm text-slate-300">
            <span>Total of items</span>
            <span className="tabular-nums">{formatMoney(gross)}</span>
          </div>
          {discountRows
            .filter((row) => parseNum(row.amount) > 0)
            .map((row, index) => (
              <div key={index} className="flex items-center justify-between text-sm text-emerald-400">
                <span>{row.name.trim() || 'Discount'}</span>
                <span className="tabular-nums">− {formatMoney(parseNum(row.amount))}</span>
              </div>
            ))}
          {gst > 0 && (
            <div className="flex items-center justify-between text-sm text-slate-300">
              <span>GST / tax</span>
              <span className="tabular-nums">+ {formatMoney(gst)}</span>
            </div>
          )}
          <div className="flex items-center justify-between pt-1.5 border-t border-white/10 text-base font-bold">
            <span>Final amount to pay</span>
            <span className="tabular-nums text-amber-400">{formatMoney(net)}</span>
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

interface AddPaymentModalProps {
  bill: PurchaseBill;
  balance: number;
  onClose: () => void;
  onSaved: (payment: BillPayment, firmName: string) => void;
  showToast: BillsSectionProps['showToast'];
}

function AddPaymentModal({ bill, balance, onClose, onSaved, showToast }: AddPaymentModalProps) {
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
      photoUrl = await uploadBillPhoto(photoFile, 'payments');
      if (!photoUrl) {
        showToast('The screenshot could not be uploaded, but the payment will still be saved.', 'info');
      }
    }

    const payment: BillPayment = {
      id: `pay-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      billId: bill.id,
      paidOn,
      amount: amountNum,
      method,
      reference: reference.trim(),
      bankName: bankName.trim(),
      photoUrl,
      groupId: null,
      createdAt: new Date().toISOString(),
    };

    try {
      await insertBillPayment(payment);
      onSaved(payment, bill.firmName);
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
      description={`To ${bill.firmName} · Bill ${bill.billNo || '—'} · Left to pay: ${formatMoney(balance)}`}
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
          inputId="payment-photo-input"
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

// --- One payment covering several bills ---

interface CombinedPaymentModalProps {
  /** Party to start with; '' lets the person pick one. */
  initialFirm: string;
  /** Parties that still have something left to pay. */
  parties: string[];
  bills: PurchaseBill[];
  getBalance: (bill: PurchaseBill) => number;
  onClose: () => void;
  onSaved: (payments: BillPayment[], firmName: string) => void;
  showToast: BillsSectionProps['showToast'];
}

/** One payment as it left the shop: its own amount, date, method and proof. */
interface PaymentEntry {
  key: string;
  amount: string;
  /** Typed (or read from a screenshot); otherwise the app fills in what is left to pay. */
  amountTouched: boolean;
  paidOn: string;
  method: PaymentMethod;
  reference: string;
  bankName: string;
  photoFile: File | null;
}

let entryCounter = 0;

function newPaymentEntry(from?: PaymentEntry): PaymentEntry {
  entryCounter += 1;
  return {
    key: `entry-${entryCounter}`,
    amount: '',
    amountTouched: false,
    // Two transfers to one party are usually made the same way, often the same day.
    paidOn: from?.paidOn ?? todayISO(),
    method: from?.method ?? 'Bank transfer',
    reference: '',
    bankName: from?.bankName ?? '',
    photoFile: null,
  };
}

/** The part of one payment that goes to one bill. */
interface Part {
  entryIndex: number;
  bill: PurchaseBill;
  amount: number; // paise
}

/**
 * Paying five bills with one transfer used to mean adding five payments by
 * hand, adding the balances up on a calculator, and attaching the same
 * screenshot five times. One wrong sum there sent ₹50,000 too much. Here the
 * app adds the ticked bills up itself, refuses payments larger than that
 * total, and saves every bill's share with its proof photo in a single go.
 * Bills are often paid in several goes (two transfers and some cash), so one
 * save can hold several payments; they clear the oldest bills first.
 */
function CombinedPaymentModal({
  initialFirm,
  parties,
  bills,
  getBalance,
  onClose,
  onSaved,
  showToast,
}: CombinedPaymentModalProps) {
  const [firm, setFirm] = useState(initialFirm);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [entries, setEntries] = useState<PaymentEntry[]>(() => [newPaymentEntry()]);
  const [problem, setProblem] = useState<FormProblem | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [extractingKey, setExtractingKey] = useState<string | null>(null);
  const problemRef = useProblemScroll(problem);

  // Oldest bill first: when the money does not cover everything, the oldest
  // bills are the ones that get cleared.
  const dueBills = useMemo(
    () =>
      bills
        .filter((b) => b.firmName.trim() === firm && getBalance(b) > 0)
        .sort((a, b) => {
          const byDate = (a.billDate || '9999').localeCompare(b.billDate || '9999');
          return byDate !== 0 ? byDate : a.createdAt.localeCompare(b.createdAt);
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bills, firm]
  );

  const selectedBills = dueBills.filter((b) => selected.has(b.id));
  const selectedTotal = selectedBills.reduce((sum, b) => sum + toPaise(getBalance(b)), 0);

  // A typed amount is kept; one left untyped (the newest) is what is still to pay.
  const typedTotal = entries.reduce(
    (sum, e) => sum + (e.amountTouched ? toPaise(parseNum(e.amount)) : 0),
    0
  );
  const amounts = entries.map((e) =>
    e.amountTouched ? toPaise(parseNum(e.amount)) : Math.max(0, selectedTotal - typedTotal)
  );
  const paidTotal = amounts.reduce((sum, a) => sum + a, 0);
  const isMulti = entries.length > 1;

  // Each payment fills the ticked bills oldest first, carrying on where the one before stopped.
  const parts: Part[] = [];
  let billIndex = 0;
  let leftOnBill = selectedBills.length > 0 ? toPaise(getBalance(selectedBills[0])) : 0;
  amounts.forEach((amount, entryIndex) => {
    let remaining = amount;
    while (remaining > 0 && billIndex < selectedBills.length) {
      const take = Math.min(remaining, leftOnBill);
      parts.push({ entryIndex, bill: selectedBills[billIndex], amount: take });
      remaining -= take;
      leftOnBill -= take;
      if (leftOnBill === 0) {
        billIndex += 1;
        leftOnBill = billIndex < selectedBills.length ? toPaise(getBalance(selectedBills[billIndex])) : 0;
      }
    }
  });

  const paidOnBill = (billId: string) =>
    parts.filter((p) => p.bill.id === billId).reduce((sum, p) => sum + p.amount, 0);
  const overBy = paidTotal - selectedTotal;
  const uncovered = selectedBills.filter((b) => paidOnBill(b.id) === 0);

  const changeFirm = (next: string) => {
    setFirm(next);
    setSelected(new Set());
    setEntries((prev) => prev.map((e) => ({ ...e, amount: '', amountTouched: false })));
    setProblem(null);
  };

  const toggle = (billId: string) => {
    setProblem(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(billId)) next.delete(billId);
      else next.add(billId);
      return next;
    });
  };

  const allTicked = dueBills.length > 0 && selectedBills.length === dueBills.length;

  const updateEntry = (key: string, change: Partial<PaymentEntry>) => {
    setProblem(null);
    setEntries((prev) => prev.map((e) => (e.key === key ? { ...e, ...change } : e)));
  };

  const addEntry = () => {
    setProblem(null);
    setEntries((prev) => [
      // Amounts shown so far stay as they are; the new payment gets what is left.
      ...prev.map((e, i) =>
        e.amountTouched
          ? e
          : { ...e, amount: amounts[i] > 0 ? String(amounts[i] / 100) : '', amountTouched: true }
      ),
      newPaymentEntry(prev[prev.length - 1]),
    ]);
  };

  const removeEntry = (key: string) => {
    setProblem(null);
    setEntries((prev) => prev.filter((e) => e.key !== key));
  };

  const handleAutoFill = async (entry: PaymentEntry) => {
    if (!entry.photoFile) return;
    unlockSound();
    setExtractingKey(entry.key);
    setProblem(null);
    try {
      const extracted = await extractPaymentFromImage(entry.photoFile);
      const change: Partial<PaymentEntry> = {};
      if (extracted.amount > 0) {
        change.amount = String(extracted.amount);
        change.amountTouched = true;
      }
      if (extracted.paidOn) change.paidOn = extracted.paidOn;
      if (extracted.method) change.method = extracted.method;
      if (extracted.reference) change.reference = extracted.reference;
      if (extracted.bankName) change.bankName = extracted.bankName;
      updateEntry(entry.key, change);
      playSuccessChime();
      showToast(
        'Details filled from the screenshot. Check that the amount matches the ticked bills before saving.',
        'info'
      );
    } catch (err) {
      showToast(
        err instanceof PhotoReadError
          ? err.message
          : 'Could not read the screenshot. Please fill the details by hand.',
        'error'
      );
    } finally {
      setExtractingKey(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);

    if (!firm) {
      setProblem(fieldProblem('Please pick the party you paid.'));
      return;
    }
    if (selectedBills.length === 0) {
      setProblem(fieldProblem('Tick the bills this payment is for.'));
      return;
    }
    const emptyIndex = amounts.findIndex((a) => a <= 0);
    if (emptyIndex !== -1) {
      setProblem(
        fieldProblem(
          isMulti
            ? `Payment ${emptyIndex + 1} has no amount. Enter it, or remove that payment.`
            : 'Please enter the amount you paid.'
        )
      );
      return;
    }
    if (overBy > 0) {
      setProblem(
        fieldProblem(
          `${isMulti ? 'The payments add up to' : 'The amount is'} ${formatMoney(
            overBy / 100
          )} more than the ticked bills add up to (${formatMoney(
            selectedTotal / 100
          )}). Check the amount, or tick the bill that is missing.`
        )
      );
      return;
    }
    if (uncovered.length > 0) {
      setProblem(
        fieldProblem(
          `The amount does not reach ${uncovered.length === 1 ? 'bill' : 'bills'} ${uncovered
            .map((b) => b.billNo || '—')
            .join(', ')}. Untick ${uncovered.length === 1 ? 'it' : 'them'}, or check the amount.`
        )
      );
      return;
    }

    setIsSaving(true);
    const photoUrls = await Promise.all(
      entries.map((entry) => (entry.photoFile ? uploadBillPhoto(entry.photoFile, 'payments') : null))
    );
    if (entries.some((entry, i) => entry.photoFile && !photoUrls[i])) {
      showToast('A screenshot could not be uploaded, but the payment will still be saved.', 'info');
    }

    const stamp = Date.now();
    const createdAt = new Date().toISOString();
    // Each payment keeps its own group, so it shows (and is removed) as the one payment it was.
    const groupIds = entries.map((_, i) => `grp-${stamp}-${i}-${Math.floor(Math.random() * 100000)}`);
    const payments: BillPayment[] = parts.map((part, i) => {
      const entry = entries[part.entryIndex];
      return {
        id: `pay-${stamp}-${i}-${Math.floor(Math.random() * 1000)}`,
        billId: part.bill.id,
        paidOn: entry.paidOn,
        amount: part.amount / 100,
        method: entry.method,
        reference: entry.method === 'Cash' ? '' : entry.reference.trim(),
        bankName:
          entry.method === 'Cheque' || entry.method === 'Bank transfer' ? entry.bankName.trim() : '',
        photoUrl: photoUrls[part.entryIndex],
        groupId: groupIds[part.entryIndex],
        createdAt,
      };
    });

    try {
      // One request: either every payment is saved on every bill, or none is.
      await insertBillPayments(payments);
      onSaved(payments, firm);
    } catch (err) {
      console.error('Saving the combined payment failed:', err);
      setIsSaving(false);
      const code = (err as { code?: string })?.code;
      if (code === 'PGRST204' || code === '42703') {
        setProblem({
          message:
            'The database is not set up for combined payments yet. Run supabase/add-combined-payments.sql in the Supabase SQL Editor once, then save again.',
          detail: '',
          near: 'save',
        });
        return;
      }
      setProblem(saveProblem(err, 'The payment could not be saved'));
    }
  };

  const partyOptions = parties.map((name) => ({ value: name, label: name }));
  const isShort = selectedTotal > 0 && paidTotal > 0 && paidTotal < selectedTotal;

  return (
    <AppModal
      open
      onClose={onClose}
      title="Pay bills together"
      description="One or more payments for several bills of the same party"
      icon={<Layers className="h-5 w-5" />}
      accent="emerald"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {problem?.near === 'fields' && (
          <div ref={problemRef}>
            <FormError message={problem.message} />
          </div>
        )}

        <PremiumSelect
          label="Party you paid"
          value={firm}
          onChange={changeFirm}
          options={partyOptions}
          placeholder="Pick a party"
          searchable={partyOptions.length > 6}
          searchPlaceholder="Search party..."
          disabled={isSaving}
          accent="emerald"
        />

        {firm && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label className="block text-sm font-semibold text-slate-700">
                Tick the bills you are paying
              </label>
              {dueBills.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    setSelected(allTicked ? new Set() : new Set(dueBills.map((b) => b.id)))
                  }
                  disabled={isSaving}
                  className="shrink-0 px-2 py-1 text-xs font-bold text-emerald-700 hover:text-emerald-800 cursor-pointer"
                >
                  {allTicked ? 'Untick all' : 'Tick all'}
                </button>
              )}
            </div>

            {dueBills.length === 0 ? (
              <p className="text-sm text-slate-500 bg-slate-50 border border-slate-100 rounded-xl p-3">
                Nothing is left to pay to this party.
              </p>
            ) : (
              <div className="space-y-2">
                {dueBills.map((bill) => {
                  const isOn = selected.has(bill.id);
                  const balance = toPaise(getBalance(bill));
                  const paid = paidOnBill(bill.id);
                  const payers = Array.from(
                    new Set(parts.filter((p) => p.bill.id === bill.id).map((p) => p.entryIndex + 1))
                  );
                  return (
                    <button
                      key={bill.id}
                      type="button"
                      role="checkbox"
                      aria-checked={isOn}
                      onClick={() => toggle(bill.id)}
                      disabled={isSaving}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left cursor-pointer transition-colors ${
                        isOn
                          ? 'bg-emerald-50 border-emerald-300'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 ${
                          isOn ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-300 bg-white'
                        }`}
                      >
                        {isOn && <CheckCircle2 className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-bold text-slate-900 truncate">
                          Bill {bill.billNo || '—'}
                        </span>
                        <span className="block text-xs text-slate-500">
                          {formatDate(bill.billDate)} · Bill amount {formatMoney(bill.netAmount)}
                        </span>
                        {isOn && isMulti && payers.length > 0 && (
                          <span className="block text-xs font-semibold text-emerald-800 mt-0.5">
                            Paid by payment {payers.join(' + ')}
                          </span>
                        )}
                        {isOn && paid > 0 && paid < balance && (
                          <span className="block text-xs font-semibold text-amber-700 mt-0.5">
                            Only {formatMoney(paid / 100)} of this bill gets paid
                          </span>
                        )}
                        {isOn && paid === 0 && paidTotal > 0 && (
                          <span className="block text-xs font-semibold text-red-700 mt-0.5">
                            The amount does not reach this bill
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-xs text-slate-500">Left to pay</span>
                        <span className="block text-sm font-bold text-red-700 tabular-nums">
                          {formatMoney(getBalance(bill))}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Running total of the ticked bills — the number to actually pay */}
        {selectedBills.length > 0 && (
          <div className="bg-[#0F172A] text-white rounded-xl p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-slate-300">
                Total of {selectedBills.length} ticked {selectedBills.length === 1 ? 'bill' : 'bills'}
              </span>
              <span className="text-xl font-bold tabular-nums text-amber-400">
                {formatMoney(selectedTotal / 100)}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1 break-words">
              Bills {selectedBills.map((b) => b.billNo || '—').join(', ')}
            </p>
            {isMulti && (
              <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-white/10">
                <span className="text-sm text-slate-300">{entries.length} payments add up to</span>
                <span
                  className={`text-base font-bold tabular-nums ${
                    paidTotal === selectedTotal ? 'text-emerald-400' : 'text-white'
                  }`}
                >
                  {formatMoney(paidTotal / 100)}
                </span>
              </div>
            )}
          </div>
        )}

        {entries.map((entry, index) => {
          const shown = entry.amountTouched
            ? entry.amount
            : amounts[index] > 0
              ? String(amounts[index] / 100)
              : '';
          // What this payment would be to settle everything ticked, given the others.
          const fillTo = selectedTotal - (paidTotal - amounts[index]);
          const myParts = parts.filter((p) => p.entryIndex === index);
          return (
            <div
              key={entry.key}
              className={isMulti ? 'space-y-4 rounded-2xl border border-slate-200 p-3.5' : 'space-y-4'}
            >
              {isMulti && (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-bold text-slate-900">
                    Payment {index + 1}
                    {amounts[index] > 0 && (
                      <span className="ml-2 font-semibold text-emerald-700 tabular-nums">
                        {formatMoney(amounts[index] / 100)}
                      </span>
                    )}
                  </p>
                  <button
                    type="button"
                    onClick={() => removeEntry(entry.key)}
                    disabled={isSaving}
                    aria-label={`Remove payment ${index + 1}`}
                    className="flex items-center gap-1 px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-50 rounded-lg cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                    Remove
                  </button>
                </div>
              )}

              <PhotoPicker
                label={
                  isMulti
                    ? 'Screenshot or cheque photo of this payment'
                    : 'Add payment screenshot or cheque photo (one for all bills)'
                }
                file={entry.photoFile}
                onSelect={(file) => updateEntry(entry.key, { photoFile: file })}
                onAutoFill={() => handleAutoFill(entry)}
                isExtracting={extractingKey === entry.key}
                autoFillLabel="Fill details from screenshot"
                inputId={`combined-payment-photo-input-${entry.key}`}
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
                  value={shown}
                  onChange={(e) => updateEntry(entry.key, { amount: e.target.value, amountTouched: true })}
                  disabled={isSaving}
                  accent="emerald"
                />
                {fillTo > 0 && fillTo !== amounts[index] && (
                  <button
                    type="button"
                    onClick={() =>
                      updateEntry(
                        entry.key,
                        // The last payment keeps following what is left; an earlier one is fixed.
                        index === entries.length - 1
                          ? { amount: '', amountTouched: false }
                          : { amount: String(fillTo / 100), amountTouched: true }
                      )
                    }
                    disabled={isSaving}
                    className="mt-2 px-3 py-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-full cursor-pointer transition-colors"
                  >
                    {isMulti ? 'Use what is left' : 'Use total of ticked bills'} — {formatMoney(fillTo / 100)}
                  </button>
                )}
                {isMulti && myParts.length > 0 && (
                  <p className="mt-2 text-xs text-slate-500 break-words">
                    Goes to{' '}
                    {myParts
                      .map((p) => `bill ${p.bill.billNo || '—'} ${formatMoney(p.amount / 100)}`)
                      .join(' · ')}
                  </p>
                )}
              </div>

              <DateField
                label="Payment date"
                value={entry.paidOn}
                onChange={(paidOn) => updateEntry(entry.key, { paidOn })}
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
                      onClick={() => updateEntry(entry.key, { method: value })}
                      disabled={isSaving}
                      className={`px-3 py-3 text-sm font-semibold rounded-xl border transition-all cursor-pointer ${
                        entry.method === value
                          ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {entry.method !== 'Cash' && (
                <FormInput
                  label={referenceLabel(entry.method)}
                  type="text"
                  placeholder={entry.method === 'Cheque' ? 'e.g. 004512' : 'e.g. 415223987654'}
                  value={entry.reference}
                  onChange={(e) => updateEntry(entry.key, { reference: e.target.value })}
                  disabled={isSaving}
                  accent="emerald"
                />
              )}

              {(entry.method === 'Cheque' || entry.method === 'Bank transfer') && (
                <FormInput
                  label="Bank name"
                  type="text"
                  placeholder="e.g. SBI, HDFC"
                  value={entry.bankName}
                  onChange={(e) => updateEntry(entry.key, { bankName: e.target.value })}
                  disabled={isSaving}
                  accent="emerald"
                />
              )}
            </div>
          );
        })}

        <button
          type="button"
          onClick={addEntry}
          disabled={isSaving}
          className="w-full flex items-center justify-center gap-2 px-4 py-3.5 text-sm font-bold text-emerald-700 bg-white hover:bg-emerald-50 border-2 border-dashed border-emerald-300 rounded-xl cursor-pointer transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add another payment
        </button>

        {/* Mismatch checks — the exact mistake this screen exists to stop */}
        {selectedTotal > 0 && overBy > 0 && (
          <div
            role="alert"
            className="bg-red-50 border-2 border-red-300 text-red-800 p-3.5 text-sm rounded-xl leading-relaxed font-semibold"
          >
            {isMulti ? 'The payments add up to' : 'This is'} {formatMoney(overBy / 100)} MORE than the
            ticked bills add up to ({formatMoney(selectedTotal / 100)}). It cannot be saved like this —
            check the amounts, or tick the bill that is missing.
          </div>
        )}
        {isShort && uncovered.length === 0 && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3.5 text-sm rounded-xl leading-relaxed">
            {isMulti ? 'The payments are' : 'This is'} {formatMoney((selectedTotal - paidTotal) / 100)} less
            than the ticked bills. The oldest bills are cleared first; the rest stays as balance on the
            last bill.
          </div>
        )}
        {paidTotal > 0 && paidTotal === selectedTotal && (
          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {isMulti ? 'The payments match' : 'Amount matches'} the ticked bills exactly. All of them will
            be marked fully paid.
          </p>
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
          submitLabel={
            selectedBills.length > 0 && paidTotal > 0
              ? `Save ${isMulti ? `${entries.length} payments, ` : ''}${formatMoney(paidTotal / 100)} for ${
                  selectedBills.length
                } ${selectedBills.length === 1 ? 'bill' : 'bills'}`
              : 'Save payment'
          }
          submitAccent="emerald"
          isSubmitting={isSaving}
        />
      </form>
    </AppModal>
  );
}
