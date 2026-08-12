import React, { useEffect, useMemo, useState } from 'react';
import {
  Banknote,
  Building2,
  Camera,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
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
  deletePurchaseBillFromDb,
  fetchBillPayments,
  fetchPurchaseBills,
  insertBillPayment,
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
import { shrinkImage } from '../lib/imageTools';
import { AppModal } from './AppModal';
import { FormError, FormInput, ModalActions } from './FormInput';
import { DateField } from './DateField';
import { ImageViewer } from './ImageViewer';

interface BillsSectionProps {
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

interface ItemRow {
  name: string;
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

const EMPTY_ROW: ItemRow = { name: '', quantity: '', unit: '', rate: '', amount: '' };

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

function todayISO(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${mm}-${dd}`;
}

function referenceLabel(method: PaymentMethod): string {
  if (method === 'Cheque') return 'Cheque number';
  if (method === 'Bank transfer') return 'UTR / reference number';
  if (method === 'UPI') return 'Transaction ID (UTR)';
  return 'Note (optional)';
}

export function BillsSection({ showToast }: BillsSectionProps) {
  const [bills, setBills] = useState<PurchaseBill[]>([]);
  const [payments, setPayments] = useState<BillPayment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

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
  const [deletingBillId, setDeletingBillId] = useState<string | null>(null);
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);
  const [viewingPhoto, setViewingPhoto] = useState<PhotoToView | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [billsData, paymentsData] = await Promise.all([
        fetchPurchaseBills(),
        fetchBillPayments(),
      ]);
      setBills(billsData);
      setPayments(paymentsData);
    } catch {
      setLoadError(
        'Could not load your party bills. Check your internet and try again. If this keeps happening, the bills table may not be set up in the database yet.'
      );
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
  const getBalance = (bill: PurchaseBill) => Math.max(0, bill.netAmount - getPaid(bill.id));

  const firmNames = useMemo(
    () => Array.from(new Set(bills.map((b) => b.firmName.trim()))).sort(),
    [bills]
  );

  const firmSummaries = useMemo(() => {
    const map = new Map<
      string,
      { name: string; billCount: number; purchased: number; paid: number }
    >();
    for (const bill of bills) {
      const key = bill.firmName.trim();
      const entry = map.get(key) ?? { name: key, billCount: 0, purchased: 0, paid: 0 };
      entry.billCount += 1;
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

  const detailBill = detailBillId ? bills.find((b) => b.id === detailBillId) ?? null : null;
  const paymentBill = paymentBillId ? bills.find((b) => b.id === paymentBillId) ?? null : null;
  const deletingBill = deletingBillId ? bills.find((b) => b.id === deletingBillId) ?? null : null;
  const editingBill = editingBillId ? bills.find((b) => b.id === editingBillId) ?? null : null;

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

  const handleDeletePayment = async () => {
    if (!deletingPaymentId) return;
    try {
      await deleteBillPaymentFromDb(deletingPaymentId);
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
          <p className="text-sm text-slate-600 leading-relaxed">{loadError}</p>
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
                { key: 'firms' as const, label: 'Party-wise total', shortLabel: 'By party' },
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
                placeholder="Search party or bill number..."
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
                <button
                  key={firm.name}
                  type="button"
                  onClick={() => {
                    setFirmFilter(firm.name);
                    setView('bills');
                  }}
                  className="w-full text-left bg-white border border-slate-200 rounded-xl p-4 shadow-xs hover:border-amber-300 transition-colors cursor-pointer"
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
                                  subtitle: `${detailBill.firmName} · ${formatDate(payment.paidOn)}`,
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
        <AddPaymentModal
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
              <th className="text-right px-3 py-2">Qty</th>
              <th className="text-right px-3 py-2">Rate</th>
              <th className="text-right px-3 py-2">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {bill.items.map((item, index) => (
              <tr key={index}>
                <td className="px-3 py-2 font-semibold text-slate-800 break-words">{item.name}</td>
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

// --- Photo picker used by both forms ---

interface PhotoPickerProps {
  label: string;
  file: File | null;
  onSelect: (file: File | null) => void;
  onAutoFill?: () => void;
  isExtracting?: boolean;
  autoFillLabel?: string;
  inputId: string;
}

function PhotoPicker({
  label,
  file,
  onSelect,
  onAutoFill,
  isExtracting = false,
  autoFillLabel = 'Fill details from photo',
  inputId,
}: PhotoPickerProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const cameraInputId = `${inputId}-camera`;

  useEffect(() => {
    if (!file) {
      setPreview(null);
      setIsPreviewOpen(false);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const handlePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    e.target.value = '';
    // Camera photos are 8-15 MB; shrink before AI reading / upload
    // so everything stays fast even on slow mobile data.
    onSelect(selected ? await shrinkImage(selected) : null);
  };

  return (
    <div className="space-y-2">
      {!file ? (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-700">{label}</p>
          <div className="grid grid-cols-2 gap-2">
            <label
              htmlFor={cameraInputId}
              className="flex items-center justify-center gap-2 px-4 py-4 border-2 border-dashed border-slate-300 hover:border-amber-400 rounded-xl text-sm font-semibold text-slate-600 bg-slate-50 cursor-pointer transition-colors"
            >
              <Camera className="h-4 w-4 text-amber-600" />
              Take photo
            </label>
            <label
              htmlFor={inputId}
              className="flex items-center justify-center gap-2 px-4 py-4 border-2 border-dashed border-slate-300 hover:border-amber-400 rounded-xl text-sm font-semibold text-slate-600 bg-slate-50 cursor-pointer transition-colors"
            >
              <ImageIcon className="h-4 w-4 text-amber-600" />
              Gallery
            </label>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl p-2.5">
          {preview && (
            <button
              type="button"
              onClick={() => setIsPreviewOpen(true)}
              aria-label="Open the selected photo"
              className="shrink-0 cursor-pointer"
            >
              <img
                src={preview}
                alt="Selected"
                className="h-14 w-14 rounded-lg object-cover border border-slate-200"
              />
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsPreviewOpen(true)}
            className="flex-1 min-w-0 text-left cursor-pointer"
          >
            <span className="block text-sm text-slate-700 font-semibold truncate">{file.name}</span>
            <span className="block text-xs text-slate-500 mt-0.5">Tap to check the photo</span>
          </button>
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="flex h-10 w-10 shrink-0 items-center justify-center text-slate-400 hover:text-red-600 rounded-lg cursor-pointer"
            aria-label="Remove photo"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <input
        id={cameraInputId}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handlePick}
      />
      <input id={inputId} type="file" accept="image/*" className="hidden" onChange={handlePick} />

      {file && onAutoFill && isPhotoFillAvailable && (
        <button
          type="button"
          onClick={onAutoFill}
          disabled={isExtracting}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-amber-500 hover:bg-amber-600 text-[#0F172A] rounded-xl text-sm font-bold cursor-pointer transition-colors disabled:opacity-60"
        >
          {isExtracting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Reading the photo...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              {autoFillLabel}
            </>
          )}
        </button>
      )}
      {file && onAutoFill && !isPhotoFillAvailable && (
        <p className="text-xs text-slate-500 leading-relaxed px-1">
          The photo will be saved with this entry. Auto-fill from photo is not switched on yet —
          it needs a Gemini AI key to be added to the app settings.
        </p>
      )}

      <ImageViewer
        open={isPreviewOpen}
        src={preview}
        title={file?.name}
        subtitle="Check that the whole bill is clear and readable"
        downloadName={file ? file.name.replace(/\.[^.]+$/, '') : undefined}
        onClose={() => setIsPreviewOpen(false)}
      />
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
  onSaved: (bill: PurchaseBill, wasEdited: boolean) => void;
  showToast: BillsSectionProps['showToast'];
}

function BillFormModal({ open, bill, onClose, firmNames, onSaved, showToast }: BillFormModalProps) {
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
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);

  const gross = rows.reduce((sum, row) => sum + parseNum(row.amount), 0);
  const totalDiscount = discountRows.reduce((sum, row) => sum + parseNum(row.amount), 0);
  const gst = parseNum(gstAmount);
  const net = Math.max(0, gross - totalDiscount + gst);

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
    setError('');
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
    setError('');
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
    setError('');
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
            quantity: item.quantity ? String(item.quantity) : '',
            unit: item.unit,
            rate: item.rate ? String(item.rate) : '',
            amount: item.amount ? String(item.amount) : '',
          }))
        );
      }
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
    if (photoFile) fillFromPhoto(photoFile);
  };

  /** Reads the already-saved bill photo again, for when the first read was wrong. */
  const handleReadSavedPhotoAgain = async () => {
    if (!savedPhotoUrl) return;
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
    setError('');

    if (!firmName.trim()) {
      setError('Please enter the party name (who you bought from).');
      return;
    }
    if (!billNo.trim()) {
      setError('Please enter the bill number.');
      return;
    }
    const items: BillLineItem[] = rows
      .filter((row) => row.name.trim() || parseNum(row.amount) > 0)
      .map((row) => ({
        name: row.name.trim(),
        quantity: parseNum(row.quantity),
        unit: row.unit.trim(),
        rate: parseNum(row.rate),
        amount: parseNum(row.amount),
      }));
    if (items.length === 0) {
      setError('Please add at least one item with its amount.');
      return;
    }
    if (items.some((item) => !item.name)) {
      setError('Every item needs a name.');
      return;
    }
    if (net <= 0) {
      setError('The final amount to pay must be more than zero. Check the amounts and discounts.');
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
    } catch {
      setIsSaving(false);
      setError(
        bill
          ? 'Could not save your changes. Please check your internet and try again.'
          : 'Could not save the bill. Please check your internet and try again.'
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
        {error && <FormError message={error} />}

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
            onChange={(e) => setFirmName(e.target.value)}
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
            onChange={(e) => setBillNo(e.target.value)}
            disabled={isSaving}
            accent="amber"
          />
          <DateField
            label="Bill date"
            value={billDate}
            onChange={setBillDate}
            disabled={isSaving}
            accent="amber"
          />
        </div>

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
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);

  const handleAutoFill = async () => {
    if (!photoFile) return;
    setIsExtracting(true);
    setError('');
    try {
      const extracted = await extractPaymentFromImage(photoFile);
      if (extracted.amount > 0) setAmount(String(extracted.amount));
      if (extracted.paidOn) setPaidOn(extracted.paidOn);
      if (extracted.method) setMethod(extracted.method);
      if (extracted.reference) setReference(extracted.reference);
      if (extracted.bankName) setBankName(extracted.bankName);
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
    setError('');

    const amountNum = parseNum(amount);
    if (amountNum <= 0) {
      setError('Please enter the amount you paid.');
      return;
    }
    if (amountNum > balance) {
      setError(
        `This is more than what is left to pay (${formatMoney(balance)}). Please check the amount.`
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
      createdAt: new Date().toISOString(),
    };

    try {
      await insertBillPayment(payment);
      onSaved(payment, bill.firmName);
    } catch {
      setIsSaving(false);
      setError('Could not save the payment. Please check your internet and try again.');
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
        {error && <FormError message={error} />}

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
