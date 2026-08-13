import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Banknote,
  CalendarDays,
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  PackageCheck,
  PackageOpen,
  Pencil,
  Phone,
  Plus,
  Scissors,
  Search,
  Store,
  Trash2,
  UserRound,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  Category,
  GoodsIssue,
  GoodsItem,
  GoodsReturn,
  PaymentMethod,
  Worker,
  WorkerPayment,
  WorkerType,
} from '../types';
import {
  deleteGoodsIssueFromDb,
  deleteGoodsReturnFromDb,
  deleteWorkerFromDb,
  deleteWorkerPaymentFromDb,
  fetchCategories,
  fetchGoodsIssues,
  fetchGoodsReturns,
  fetchWorkerPayments,
  fetchWorkers,
  insertGoodsIssue,
  insertGoodsReturn,
  insertWorker,
  insertWorkerPayment,
  updateWorkerInDb,
  uploadBillPhoto,
} from '../lib/database';
import { extractPaymentFromImage, PhotoReadError } from '../lib/extractBill';
import { describeDbError, FriendlyError } from '../lib/dbErrors';
import { playSuccessChime, unlockSound } from '../lib/sounds';
import { AppModal } from './AppModal';
import { FormError, FormInput, ModalActions } from './FormInput';
import { DateField } from './DateField';
import { ImageViewer } from './ImageViewer';
import { PhotoPicker } from './PhotoPicker';
import { SuggestInput } from './SuggestInput';

interface WorkersSectionProps {
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

const ISSUE_UNIT_SUGGESTIONS = ['Meter', 'Kg', 'Piece', 'Roll', 'Than', 'Bundle'];
const RETURN_UNIT_SUGGESTIONS = ['Dozen', 'Piece', 'Fall', 'Set', 'Bundle'];

/** Units that count as meters, so given and worked cloth can be compared. */
const METER_UNITS = new Set(['meter', 'meters', 'metre', 'metres', 'mtr', 'mtrs', 'm']);

function isMeterUnit(unit: string): boolean {
  return METER_UNITS.has(unit.trim().toLowerCase());
}

/** "500 Meter of "Cotton cloth"" for one item, "3 items" for more. */
function describeItems(items: GoodsItem[]): string {
  if (items.length === 1) {
    return `${formatQty(items[0].quantity, items[0].unit)} of "${items[0].item}"`;
  }
  return `${items.length} items`;
}

function parseNum(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function formatQty(quantity: number, unit: string): string {
  const qty = quantity.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return unit ? `${qty} ${unit}` : qty;
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

/** "2026-08-13" → "2026-08" */
function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
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

export function WorkersSection({ showToast }: WorkersSectionProps) {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [issues, setIssues] = useState<GoodsIssue[]>([]);
  const [returns, setReturns] = useState<GoodsReturn[]>([]);
  const [payments, setPayments] = useState<WorkerPayment[]>([]);
  const [stockItems, setStockItems] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<FriendlyError | null>(null);

  // List controls
  const [typeFilter, setTypeFilter] = useState<'all' | WorkerType>('all');
  const [search, setSearch] = useState('');

  // Modals
  const [isAddWorkerOpen, setIsAddWorkerOpen] = useState(false);
  const [editingWorkerId, setEditingWorkerId] = useState<string | null>(null);
  const [detailWorkerId, setDetailWorkerId] = useState<string | null>(null);
  const [issueWorkerId, setIssueWorkerId] = useState<string | null>(null);
  const [returnWorkerId, setReturnWorkerId] = useState<string | null>(null);
  const [paymentWorkerId, setPaymentWorkerId] = useState<string | null>(null);
  const [deletingWorkerId, setDeletingWorkerId] = useState<string | null>(null);
  const [deletingIssueId, setDeletingIssueId] = useState<string | null>(null);
  const [deletingReturnId, setDeletingReturnId] = useState<string | null>(null);
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);
  const [viewingPhoto, setViewingPhoto] = useState<PhotoToView | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [workersData, issuesData, returnsData, paymentsData, stockData] = await Promise.all([
        fetchWorkers(),
        fetchGoodsIssues(),
        fetchGoodsReturns(),
        fetchWorkerPayments(),
        // Stock names only feed the item suggestions — the page must still
        // open even if this list cannot be loaded.
        fetchCategories().catch(() => [] as Category[]),
      ]);
      setWorkers(workersData);
      setIssues(issuesData);
      setReturns(returnsData);
      setPayments(paymentsData);
      setStockItems(stockData);
    } catch (err) {
      console.error('Loading the workers failed:', err);
      setLoadError(describeDbError(err, 'Your workers could not be loaded'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const paidByWorker = useMemo(() => {
    const map = new Map<string, number>();
    for (const payment of payments) {
      map.set(payment.workerId, (map.get(payment.workerId) ?? 0) + payment.amount);
    }
    return map;
  }, [payments]);

  const earnedByWorker = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of returns) {
      map.set(entry.workerId, (map.get(entry.workerId) ?? 0) + entry.amount);
    }
    return map;
  }, [returns]);

  const getPaid = (workerId: string) => paidByWorker.get(workerId) ?? 0;
  const getEarned = (workerId: string) => earnedByWorker.get(workerId) ?? 0;

  /** Paid to a shop worker within the current calendar month. */
  const getPaidThisMonth = (workerId: string) => {
    const thisMonth = monthKey(todayISO());
    return payments
      .filter((p) => p.workerId === workerId && monthKey(p.paidOn) === thisMonth)
      .reduce((sum, p) => sum + p.amount, 0);
  };

  /** Meters of cloth given minus meters reported as worked — still with the worker. */
  const getClothLeft = (workerId: string) => {
    const given = issues
      .filter((i) => i.workerId === workerId)
      .flatMap((i) => i.items)
      .filter((it) => isMeterUnit(it.unit))
      .reduce((sum, it) => sum + it.quantity, 0);
    const worked = returns
      .filter((r) => r.workerId === workerId)
      .reduce((sum, r) => sum + r.metersUsed, 0);
    return given - worked;
  };

  const filteredWorkers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return workers.filter((worker) => {
      if (typeFilter !== 'all' && worker.type !== typeFilter) return false;
      if (!q) return true;
      return worker.name.toLowerCase().includes(q) || worker.phone.toLowerCase().includes(q);
    });
  }, [workers, search, typeFilter]);

  const detailWorker = detailWorkerId ? workers.find((w) => w.id === detailWorkerId) ?? null : null;
  const editingWorker = editingWorkerId ? workers.find((w) => w.id === editingWorkerId) ?? null : null;
  const issueWorker = issueWorkerId ? workers.find((w) => w.id === issueWorkerId) ?? null : null;
  const returnWorker = returnWorkerId ? workers.find((w) => w.id === returnWorkerId) ?? null : null;
  const paymentWorker = paymentWorkerId ? workers.find((w) => w.id === paymentWorkerId) ?? null : null;
  const deletingWorker = deletingWorkerId ? workers.find((w) => w.id === deletingWorkerId) ?? null : null;

  // The "Give goods" dropdown offers everything from All stock, plus any
  // item name that was typed by hand in an earlier entry.
  const itemSuggestions = useMemo(() => {
    const names = new Set<string>(stockItems.map((c) => c.name.trim()).filter(Boolean));
    for (const issue of issues) {
      for (const it of issue.items) if (it.item.trim()) names.add(it.item.trim());
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [stockItems, issues]);

  /** Unit of a stock item, so picking one fills the unit automatically. */
  const resolveStockUnit = useMemo(() => {
    const unitByName = new Map<string, string>();
    for (const category of stockItems) {
      if (category.unit) unitByName.set(category.name.trim().toLowerCase(), category.unit);
    }
    return (item: string) => unitByName.get(item.trim().toLowerCase());
  }, [stockItems]);
  const returnItemSuggestions = useMemo(
    () =>
      Array.from(
        new Set(returns.flatMap((r) => r.items).map((it) => it.item.trim()).filter(Boolean))
      ).sort(),
    [returns]
  );

  const handleWorkerSaved = (worker: Worker, wasEdited: boolean) => {
    if (wasEdited) {
      setWorkers((prev) => prev.map((w) => (w.id === worker.id ? worker : w)));
      setEditingWorkerId(null);
      setDetailWorkerId(worker.id);
      showToast(`"${worker.name}" updated.`, 'success');
      return;
    }
    setWorkers((prev) =>
      [...prev, worker].sort((a, b) => a.name.localeCompare(b.name))
    );
    setIsAddWorkerOpen(false);
    showToast(`Worker "${worker.name}" added.`, 'success');
  };

  const handleIssueSaved = (issue: GoodsIssue, workerName: string) => {
    setIssues((prev) => [issue, ...prev]);
    setIssueWorkerId(null);
    showToast(`Noted: ${describeItems(issue.items)} given to ${workerName}.`, 'success');
  };

  const handleReturnSaved = (entry: GoodsReturn, workerName: string) => {
    setReturns((prev) => [entry, ...prev]);
    setReturnWorkerId(null);
    showToast(`Noted: ${describeItems(entry.items)} received from ${workerName}.`, 'success');
  };

  const handlePaymentSaved = (payment: WorkerPayment, workerName: string) => {
    setPayments((prev) => [payment, ...prev]);
    setPaymentWorkerId(null);
    showToast(`Payment of ${formatMoney(payment.amount)} to "${workerName}" saved.`, 'success');
  };

  const handleDeleteWorker = async () => {
    if (!deletingWorker) return;
    try {
      await deleteWorkerFromDb(deletingWorker.id);
      setWorkers((prev) => prev.filter((w) => w.id !== deletingWorker.id));
      setIssues((prev) => prev.filter((i) => i.workerId !== deletingWorker.id));
      setReturns((prev) => prev.filter((r) => r.workerId !== deletingWorker.id));
      setPayments((prev) => prev.filter((p) => p.workerId !== deletingWorker.id));
      setDeletingWorkerId(null);
      setDetailWorkerId(null);
      showToast(`Worker "${deletingWorker.name}" removed.`, 'info');
    } catch {
      showToast('Could not remove this worker. Please try again.', 'error');
    }
  };

  const handleDeleteIssue = async () => {
    if (!deletingIssueId) return;
    try {
      await deleteGoodsIssueFromDb(deletingIssueId);
      setIssues((prev) => prev.filter((i) => i.id !== deletingIssueId));
      setDeletingIssueId(null);
      showToast('Goods entry removed.', 'info');
    } catch {
      showToast('Could not remove this entry. Please try again.', 'error');
    }
  };

  const handleDeleteReturn = async () => {
    if (!deletingReturnId) return;
    try {
      await deleteGoodsReturnFromDb(deletingReturnId);
      setReturns((prev) => prev.filter((r) => r.id !== deletingReturnId));
      setDeletingReturnId(null);
      showToast('Returned goods entry removed.', 'info');
    } catch {
      showToast('Could not remove this entry. Please try again.', 'error');
    }
  };

  const handleDeletePayment = async () => {
    if (!deletingPaymentId) return;
    try {
      await deleteWorkerPaymentFromDb(deletingPaymentId);
      setPayments((prev) => prev.filter((p) => p.id !== deletingPaymentId));
      setDeletingPaymentId(null);
      showToast('Payment entry removed.', 'info');
    } catch {
      showToast('Could not remove this payment. Please try again.', 'error');
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#F8FAFC] p-6">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="h-8 w-8 animate-spin text-amber-600" />
          <p className="text-base font-medium">Loading workers...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#F8FAFC] p-6">
        <div className="max-w-md w-full bg-white border border-red-200 rounded-xl p-6 shadow-lg text-center space-y-4">
          <Users className="h-10 w-10 text-red-500 mx-auto" />
          <h2 className="text-xl font-bold text-slate-900">Could not load workers</h2>
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
      {/* Filters */}
      <div className="flex flex-col gap-2 sm:gap-3">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex rounded-lg bg-slate-100 p-0.5">
            {(
              [
                { key: 'all' as const, label: 'All workers', shortLabel: 'All' },
                { key: 'Shop' as const, label: 'Shop', shortLabel: 'Shop' },
                { key: 'Job work' as const, label: 'Job work', shortLabel: 'Job work' },
              ]
            ).map(({ key, label, shortLabel }) => (
              <button
                key={key}
                type="button"
                onClick={() => setTypeFilter(key)}
                className={`px-3 py-2 sm:px-4 text-sm rounded-md font-semibold cursor-pointer transition-colors whitespace-nowrap ${
                  typeFilter === key
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <span className="sm:hidden">{shortLabel}</span>
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setIsAddWorkerOpen(true)}
            className="ml-auto shrink-0 flex items-center gap-1.5 px-3 py-2 sm:px-4 sm:py-2.5 bg-[#0F172A] hover:bg-slate-800 text-white rounded-lg text-sm font-bold whitespace-nowrap shadow-xs cursor-pointer transition-all"
          >
            <Plus className="h-4 w-4" />
            Add worker
          </button>
        </div>

        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search worker by name or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 w-full transition-all"
          />
        </div>
      </div>

      {/* Worker cards */}
      <div className="space-y-3 md:grid md:grid-cols-2 xl:grid-cols-3 md:gap-4 md:space-y-0">
        {filteredWorkers.length === 0 ? (
          <div className="md:col-span-2 xl:col-span-3">
            {workers.length === 0 ? (
              <EmptyState onAdd={() => setIsAddWorkerOpen(true)} />
            ) : (
              <div className="p-8 text-center text-slate-400 text-sm bg-white border border-slate-200 rounded-xl">
                No workers match your search or filter.
              </div>
            )}
          </div>
        ) : (
          filteredWorkers.map((worker) => {
            const paid = getPaid(worker.id);
            const isJobWork = worker.type === 'Job work';
            const earned = getEarned(worker.id);
            const jobBalance = earned - paid; // positive: we owe; negative: advance
            const paidThisMonth = getPaidThisMonth(worker.id);
            const monthLeft = Math.max(0, worker.monthlySalary - paidThisMonth);
            const clothLeft = isJobWork ? getClothLeft(worker.id) : 0;
            return (
              <motion.div
                key={worker.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden flex flex-col"
              >
                <button
                  type="button"
                  onClick={() => setDetailWorkerId(worker.id)}
                  className="text-left p-4 flex-1 cursor-pointer hover:bg-slate-50/60 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-base font-bold text-slate-900 truncate">{worker.name}</p>
                      {worker.phone && (
                        <p className="text-sm text-slate-500 mt-0.5 truncate">{worker.phone}</p>
                      )}
                    </div>
                    <TypeBadge type={worker.type} />
                  </div>
                  <div className="mt-3 pt-3 border-t border-slate-100 text-sm">
                    {isJobWork ? (
                      <>
                        <div className="grid grid-cols-3 gap-2">
                          <div className="min-w-0">
                            <p className="text-xs text-slate-500">Earned</p>
                            <p className="font-bold text-slate-900 tabular-nums truncate">
                              {formatMoney(earned)}
                            </p>
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs text-slate-500">Paid</p>
                            <p className="font-bold text-emerald-700 tabular-nums truncate">
                              {formatMoney(paid)}
                            </p>
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs text-slate-500">
                              {jobBalance >= 0 ? 'Left to pay' : 'Advance'}
                            </p>
                            <p
                              className={`font-bold tabular-nums truncate ${
                                jobBalance > 0 ? 'text-red-600' : 'text-slate-900'
                              }`}
                            >
                              {formatMoney(Math.abs(jobBalance))}
                            </p>
                          </div>
                        </div>
                        {clothLeft > 0 && (
                          <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500 min-w-0">
                            <PackageOpen className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">
                              Cloth with worker:{' '}
                              <span className="font-semibold text-slate-700 tabular-nums">
                                {formatQty(clothLeft, 'm')}
                              </span>
                            </span>
                          </p>
                        )}
                      </>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        <div className="min-w-0">
                          <p className="text-xs text-slate-500">Salary</p>
                          <p className="font-bold text-slate-900 tabular-nums truncate">
                            {worker.monthlySalary > 0 ? formatMoney(worker.monthlySalary) : '—'}
                          </p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs text-slate-500">This month</p>
                          <p className="font-bold text-emerald-700 tabular-nums truncate">
                            {formatMoney(paidThisMonth)}
                          </p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs text-slate-500">Left</p>
                          <p
                            className={`font-bold tabular-nums truncate ${
                              monthLeft > 0 ? 'text-red-600' : 'text-slate-900'
                            }`}
                          >
                            {worker.monthlySalary > 0 ? formatMoney(monthLeft) : '—'}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </button>
                <div className="px-4 pb-4 space-y-2">
                  {isJobWork && (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setIssueWorkerId(worker.id)}
                        className="flex items-center justify-center gap-2 px-3 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-sm font-bold cursor-pointer transition-colors"
                      >
                        <PackageOpen className="h-4 w-4" />
                        Give goods
                      </button>
                      <button
                        type="button"
                        onClick={() => setReturnWorkerId(worker.id)}
                        className="flex items-center justify-center gap-2 px-3 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-sm font-bold cursor-pointer transition-colors"
                      >
                        <PackageCheck className="h-4 w-4" />
                        Receive goods
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setPaymentWorkerId(worker.id)}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold cursor-pointer transition-colors"
                  >
                    <Wallet className="h-4 w-4" />
                    Add payment
                  </button>
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      {/* Add / edit worker modal */}
      <WorkerFormModal
        open={isAddWorkerOpen || Boolean(editingWorker)}
        worker={editingWorker}
        onClose={() => {
          setIsAddWorkerOpen(false);
          setEditingWorkerId(null);
        }}
        onSaved={handleWorkerSaved}
      />

      {/* Worker detail modal */}
      <AppModal
        open={Boolean(detailWorker)}
        onClose={() => setDetailWorkerId(null)}
        title={detailWorker?.name ?? ''}
        description={
          detailWorker
            ? detailWorker.type === 'Job work'
              ? 'Job work — stitching and tailoring'
              : 'Shop worker — monthly salary'
            : undefined
        }
        icon={detailWorker?.type === 'Job work' ? <Scissors className="h-5 w-5" /> : <Store className="h-5 w-5" />}
        accent="amber"
      >
        {detailWorker && (
          <WorkerDetail
            worker={detailWorker}
            issues={issues.filter((i) => i.workerId === detailWorker.id)}
            returns={returns.filter((r) => r.workerId === detailWorker.id)}
            payments={payments.filter((p) => p.workerId === detailWorker.id)}
            onGiveGoods={() => setIssueWorkerId(detailWorker.id)}
            onReceiveGoods={() => setReturnWorkerId(detailWorker.id)}
            onAddPayment={() => setPaymentWorkerId(detailWorker.id)}
            onEdit={() => {
              setDetailWorkerId(null);
              setEditingWorkerId(detailWorker.id);
            }}
            onDelete={() => setDeletingWorkerId(detailWorker.id)}
            onDeleteIssue={setDeletingIssueId}
            onDeleteReturn={setDeletingReturnId}
            onDeletePayment={setDeletingPaymentId}
            onViewPhoto={setViewingPhoto}
          />
        )}
      </AppModal>

      {/* Give goods modal */}
      {issueWorker && (
        <GiveGoodsModal
          worker={issueWorker}
          itemSuggestions={itemSuggestions}
          resolveUnit={resolveStockUnit}
          onClose={() => setIssueWorkerId(null)}
          onSaved={handleIssueSaved}
        />
      )}

      {/* Receive goods modal */}
      {returnWorker && (
        <ReceiveGoodsModal
          worker={returnWorker}
          itemSuggestions={returnItemSuggestions}
          onClose={() => setReturnWorkerId(null)}
          onSaved={handleReturnSaved}
        />
      )}

      {/* Add payment modal */}
      {paymentWorker && (
        <AddWorkerPaymentModal
          worker={paymentWorker}
          earned={getEarned(paymentWorker.id)}
          paid={getPaid(paymentWorker.id)}
          paidThisMonth={getPaidThisMonth(paymentWorker.id)}
          onClose={() => setPaymentWorkerId(null)}
          onSaved={handlePaymentSaved}
          showToast={showToast}
        />
      )}

      {/* Delete worker confirmation */}
      <AppModal
        open={Boolean(deletingWorker)}
        onClose={() => setDeletingWorkerId(null)}
        title="Remove this worker?"
        description={
          deletingWorker
            ? `"${deletingWorker.name}" and all their goods entries and payment records will be removed. This cannot be undone.`
            : undefined
        }
        icon={<Trash2 className="h-5 w-5" />}
        accent="red"
      >
        <ModalActions
          onCancel={() => setDeletingWorkerId(null)}
          submitLabel="Remove worker"
          cancelLabel="Keep worker"
          submitType="button"
          onSubmit={handleDeleteWorker}
          submitAccent="red"
        />
      </AppModal>

      {/* Delete goods-given confirmation */}
      <AppModal
        open={Boolean(deletingIssueId)}
        onClose={() => setDeletingIssueId(null)}
        title="Remove this goods entry?"
        description="The record of goods given to the worker will be removed."
        icon={<Trash2 className="h-5 w-5" />}
        accent="red"
      >
        <ModalActions
          onCancel={() => setDeletingIssueId(null)}
          submitLabel="Remove entry"
          cancelLabel="Keep it"
          submitType="button"
          onSubmit={handleDeleteIssue}
          submitAccent="red"
        />
      </AppModal>

      {/* Delete goods-returned confirmation */}
      <AppModal
        open={Boolean(deletingReturnId)}
        onClose={() => setDeletingReturnId(null)}
        title="Remove this returned goods entry?"
        description="Its wage amount will also be removed from what the worker has earned."
        icon={<Trash2 className="h-5 w-5" />}
        accent="red"
      >
        <ModalActions
          onCancel={() => setDeletingReturnId(null)}
          submitLabel="Remove entry"
          cancelLabel="Keep it"
          submitType="button"
          onSubmit={handleDeleteReturn}
          submitAccent="red"
        />
      </AppModal>

      {/* Delete payment confirmation */}
      <AppModal
        open={Boolean(deletingPaymentId)}
        onClose={() => setDeletingPaymentId(null)}
        title="Remove this payment entry?"
        description="The amount will be added back to what is left to pay."
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

function TypeBadge({ type }: { type: WorkerType }) {
  if (type === 'Job work') {
    return (
      <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-full bg-violet-50 text-violet-700 border border-violet-200">
        <Scissors className="h-3 w-3" />
        Job work
      </span>
    );
  }
  return (
    <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-full bg-sky-50 text-sky-700 border border-sky-200">
      <Store className="h-3 w-3" />
      Shop
    </span>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="p-8 sm:p-12 text-center bg-white border border-slate-200 rounded-xl">
      <Users className="h-10 w-10 mx-auto text-slate-300 mb-3" />
      <p className="text-base font-bold text-slate-700">No workers added yet</p>
      <p className="text-sm text-slate-500 mt-1 leading-relaxed">
        Add your shop workers to track their monthly salary, and your job workers to track the
        cloth you give them, the falls they bring back, and every payment.
      </p>
      <button
        type="button"
        onClick={onAdd}
        className="mt-4 inline-flex items-center gap-2 px-5 py-3 bg-[#0F172A] hover:bg-slate-800 text-white rounded-xl text-sm font-bold cursor-pointer transition-colors"
      >
        <Plus className="h-4 w-4" />
        Add your first worker
      </button>
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

// --- Worker detail (inside the detail modal) ---

interface WorkerDetailProps {
  worker: Worker;
  issues: GoodsIssue[];
  returns: GoodsReturn[];
  payments: WorkerPayment[];
  onGiveGoods: () => void;
  onReceiveGoods: () => void;
  onAddPayment: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDeleteIssue: (id: string) => void;
  onDeleteReturn: (id: string) => void;
  onDeletePayment: (id: string) => void;
  onViewPhoto: (photo: PhotoToView) => void;
}

function WorkerDetail({
  worker,
  issues,
  returns,
  payments,
  onGiveGoods,
  onReceiveGoods,
  onAddPayment,
  onEdit,
  onDelete,
  onDeleteIssue,
  onDeleteReturn,
  onDeletePayment,
  onViewPhoto,
}: WorkerDetailProps) {
  const isJobWork = worker.type === 'Job work';
  const paid = payments.reduce((sum, p) => sum + p.amount, 0);
  const earned = returns.reduce((sum, r) => sum + r.amount, 0);
  const jobBalance = earned - paid;

  /**
   * Month-wise salary picture for shop workers: every month that has a
   * payment, plus the running month so the current salary is always visible.
   */
  const salaryMonths = useMemo(() => {
    if (isJobWork) return [];
    const keys = new Set<string>(
      payments.map((p) => monthKey(p.paidOn)).filter((k) => k.length === 7)
    );
    keys.add(monthKey(todayISO()));
    return Array.from(keys)
      .sort()
      .reverse()
      .map((key) => {
        const paidInMonth = payments
          .filter((p) => monthKey(p.paidOn) === key)
          .reduce((sum, p) => sum + p.amount, 0);
        return { key, paidInMonth, left: Math.max(0, worker.monthlySalary - paidInMonth) };
      });
  }, [isJobWork, payments, worker.monthlySalary]);

  /** Per-item totals so it is clear what is still lying with the worker. */
  const goodsSummary = useMemo(() => {
    if (!isJobWork) return { given: [], received: [] };
    const sumByItem = (entries: { item: string; quantity: number; unit: string }[]) => {
      const map = new Map<string, { item: string; quantity: number; unit: string }>();
      for (const entry of entries) {
        const key = `${entry.item.trim().toLowerCase()}|${entry.unit.trim().toLowerCase()}`;
        const existing = map.get(key);
        if (existing) existing.quantity += entry.quantity;
        else map.set(key, { item: entry.item.trim(), quantity: entry.quantity, unit: entry.unit.trim() });
      }
      return Array.from(map.values());
    };
    return {
      given: sumByItem(issues.flatMap((i) => i.items)),
      received: sumByItem(returns.flatMap((r) => r.items)),
    };
  }, [isJobWork, issues, returns]);

  /**
   * The cloth account in meters: what went out, what has been worked on
   * (reported with each return), and what is therefore still with the worker.
   */
  const clothAccount = useMemo(() => {
    if (!isJobWork) return { given: 0, worked: 0, left: 0 };
    const given = issues
      .flatMap((i) => i.items)
      .filter((it) => isMeterUnit(it.unit))
      .reduce((sum, it) => sum + it.quantity, 0);
    const worked = returns.reduce((sum, r) => sum + r.metersUsed, 0);
    return { given, worked, left: given - worked };
  }, [isJobWork, issues, returns]);

  return (
    <div className="space-y-5">
      {/* Amount summary */}
      {isJobWork ? (
        <div className="space-y-2 sm:space-y-0 sm:grid sm:grid-cols-3 sm:gap-2">
          <AmountTile label="Earned from work" value={formatMoney(earned)} />
          <AmountTile label="Paid" value={formatMoney(paid)} tone="emerald" />
          <AmountTile
            label={jobBalance >= 0 ? 'Left to pay' : 'Advance given'}
            value={formatMoney(Math.abs(jobBalance))}
            tone={jobBalance > 0 ? 'red' : 'default'}
          />
        </div>
      ) : (
        <div className="space-y-2 sm:space-y-0 sm:grid sm:grid-cols-3 sm:gap-2">
          <AmountTile
            label="Salary per month"
            value={worker.monthlySalary > 0 ? formatMoney(worker.monthlySalary) : '—'}
          />
          <AmountTile
            label="Paid this month"
            value={formatMoney(salaryMonths[0]?.key === monthKey(todayISO()) ? salaryMonths[0].paidInMonth : 0)}
            tone="emerald"
          />
          <AmountTile
            label="Left this month"
            value={
              worker.monthlySalary > 0
                ? formatMoney(salaryMonths[0]?.key === monthKey(todayISO()) ? salaryMonths[0].left : worker.monthlySalary)
                : '—'
            }
            tone={
              worker.monthlySalary > 0 &&
              (salaryMonths[0]?.key === monthKey(todayISO()) ? salaryMonths[0].left : worker.monthlySalary) > 0
                ? 'red'
                : 'default'
            }
          />
        </div>
      )}

      {/* Worker info */}
      <div className="space-y-2 text-sm">
        {worker.phone && (
          <div className="flex items-start justify-between gap-3">
            <span className="text-slate-500 shrink-0">Phone</span>
            <a
              href={`tel:${worker.phone}`}
              className="font-semibold text-amber-700 text-right break-words min-w-0 inline-flex items-center gap-1.5"
            >
              <Phone className="h-3.5 w-3.5" />
              {worker.phone}
            </a>
          </div>
        )}
        <div className="flex items-start justify-between gap-3">
          <span className="text-slate-500 shrink-0">Added on</span>
          <span className="font-semibold text-slate-900 text-right break-words min-w-0">
            {formatDate(worker.createdAt.slice(0, 10))}
          </span>
        </div>
        {worker.note && (
          <div className="flex items-start justify-between gap-3">
            <span className="text-slate-500 shrink-0">Note</span>
            <span className="font-semibold text-slate-900 text-right break-words min-w-0">
              {worker.note}
            </span>
          </div>
        )}
      </div>

      {/* Month-wise salary (shop workers) */}
      {!isJobWork && worker.monthlySalary > 0 && salaryMonths.length > 0 && (
        <div>
          <h4 className="text-sm font-bold text-slate-800 mb-2">Month by month</h4>
          <div className="border border-slate-200 rounded-xl overflow-hidden text-sm divide-y divide-slate-100">
            {salaryMonths.map(({ key, paidInMonth, left }) => (
              <div key={key} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span className="flex items-center gap-1.5 text-slate-700 font-semibold min-w-0">
                  <CalendarDays className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  <span className="truncate">{monthLabel(key)}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="font-bold tabular-nums text-emerald-700">{formatMoney(paidInMonth)}</span>
                  {left > 0 ? (
                    <span className="ml-2 text-xs font-bold text-red-600 tabular-nums">
                      left {formatMoney(left)}
                    </span>
                  ) : (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs font-bold text-[#166534]">
                      <CheckCircle2 className="h-3 w-3" />
                      full
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cloth account in meters (job workers) */}
      {isJobWork && (clothAccount.given > 0 || clothAccount.worked > 0) && (
        <div>
          <h4 className="text-sm font-bold text-slate-800 mb-2">Cloth account (meters)</h4>
          <div className="space-y-2 sm:space-y-0 sm:grid sm:grid-cols-3 sm:gap-2">
            <AmountTile label="Cloth given" value={formatQty(clothAccount.given, 'm')} />
            <AmountTile label="Worked on" value={formatQty(clothAccount.worked, 'm')} tone="emerald" />
            <AmountTile
              label={clothAccount.left >= 0 ? 'Still with worker' : 'Worked more than given'}
              value={formatQty(Math.abs(clothAccount.left), 'm')}
              tone={clothAccount.left > 0 ? 'red' : 'default'}
            />
          </div>
          {clothAccount.left < 0 && (
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
              More meters were worked than given. Check whether some cloth given was not entered,
              or a returned entry has too many meters.
            </p>
          )}
        </div>
      )}

      {/* Goods totals (job workers) */}
      {isJobWork && (goodsSummary.given.length > 0 || goodsSummary.received.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-3">
            <p className="text-xs font-bold text-slate-500 mb-1.5">Total goods given</p>
            {goodsSummary.given.length === 0 ? (
              <p className="text-sm text-slate-400">Nothing yet</p>
            ) : (
              goodsSummary.given.map((entry) => (
                <p key={`${entry.item}|${entry.unit}`} className="text-sm font-semibold text-slate-800 break-words">
                  {entry.item} — <span className="tabular-nums">{formatQty(entry.quantity, entry.unit)}</span>
                </p>
              ))
            )}
          </div>
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-3">
            <p className="text-xs font-bold text-slate-500 mb-1.5">Total goods received back</p>
            {goodsSummary.received.length === 0 ? (
              <p className="text-sm text-slate-400">Nothing yet</p>
            ) : (
              goodsSummary.received.map((entry) => (
                <p key={`${entry.item}|${entry.unit}`} className="text-sm font-semibold text-slate-800 break-words">
                  {entry.item} — <span className="tabular-nums">{formatQty(entry.quantity, entry.unit)}</span>
                </p>
              ))
            )}
          </div>
        </div>
      )}

      {/* Goods given (job workers) */}
      {isJobWork && (
        <div>
          <div className="flex items-center justify-between gap-3 mb-2">
            <h4 className="text-sm font-bold text-slate-800">Goods given</h4>
            <button
              type="button"
              onClick={onGiveGoods}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg cursor-pointer transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Give goods
            </button>
          </div>
          {issues.length === 0 ? (
            <p className="text-sm text-slate-500 bg-slate-50 border border-slate-100 rounded-xl p-3">
              No cloth or material given yet.
            </p>
          ) : (
            <div className="space-y-2">
              {issues.map((issue) => (
                <div
                  key={issue.id}
                  className="flex items-start justify-between gap-3 bg-slate-50 border border-slate-100 rounded-xl p-3"
                >
                  <div className="min-w-0">
                    {issue.items.map((it, index) => (
                      <p key={index} className="text-sm font-bold text-slate-900 break-words">
                        {it.item}
                        <span className="ml-2 text-xs font-semibold text-slate-500 tabular-nums">
                          {formatQty(it.quantity, it.unit)}
                        </span>
                      </p>
                    ))}
                    <p className="text-xs text-slate-500 mt-0.5 break-words">
                      Given on {formatDate(issue.issuedOn)}
                      {issue.note && ` · ${issue.note}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDeleteIssue(issue.id)}
                    title="Remove this entry"
                    aria-label="Remove this entry"
                    className="flex h-10 w-10 shrink-0 items-center justify-center text-slate-400 hover:text-red-600 bg-white border border-slate-200 rounded-lg cursor-pointer transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Goods received back (job workers) */}
      {isJobWork && (
        <div>
          <div className="flex items-center justify-between gap-3 mb-2">
            <h4 className="text-sm font-bold text-slate-800">Goods received back</h4>
            <button
              type="button"
              onClick={onReceiveGoods}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg cursor-pointer transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Receive goods
            </button>
          </div>
          {returns.length === 0 ? (
            <p className="text-sm text-slate-500 bg-slate-50 border border-slate-100 rounded-xl p-3">
              Nothing received back yet.
            </p>
          ) : (
            <div className="space-y-2">
              {returns.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start justify-between gap-3 bg-slate-50 border border-slate-100 rounded-xl p-3"
                >
                  <div className="min-w-0">
                    {entry.items.map((it, index) => (
                      <p key={index} className="text-sm font-bold text-slate-900 break-words">
                        {it.item}
                        <span className="ml-2 text-xs font-semibold text-slate-500 tabular-nums">
                          {formatQty(it.quantity, it.unit)}
                        </span>
                      </p>
                    ))}
                    <p className="text-xs text-slate-500 mt-0.5 break-words">
                      Received on {formatDate(entry.returnedOn)}
                      {entry.metersUsed > 0 && ` · worked ${formatQty(entry.metersUsed, 'm')}`}
                      {entry.rate > 0 && ` · ${formatMoney(entry.rate)} per meter`}
                      {entry.note && ` · ${entry.note}`}
                    </p>
                    <p className="text-xs font-bold text-slate-700 tabular-nums mt-0.5">
                      Wage: {formatMoney(entry.amount)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDeleteReturn(entry.id)}
                    title="Remove this entry"
                    aria-label="Remove this entry"
                    className="flex h-10 w-10 shrink-0 items-center justify-center text-slate-400 hover:text-red-600 bg-white border border-slate-200 rounded-lg cursor-pointer transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Payments */}
      <div>
        <h4 className="text-sm font-bold text-slate-800 mb-2">Money given</h4>
        {payments.length === 0 ? (
          <p className="text-sm text-slate-500 bg-slate-50 border border-slate-100 rounded-xl p-3">
            No payments recorded yet.
          </p>
        ) : (
          <div className="space-y-2">
            {payments.map((payment) => (
              <div
                key={payment.id}
                className="flex items-start justify-between gap-3 bg-slate-50 border border-slate-100 rounded-xl p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 tabular-nums">
                    {formatMoney(payment.amount)}
                    <span className="ml-2 text-xs font-semibold text-slate-500">{payment.method}</span>
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5 break-words">
                    {formatDate(payment.paidOn)}
                    {payment.reference && ` · Ref: ${payment.reference}`}
                    {payment.bankName && ` · ${payment.bankName}`}
                    {payment.note && ` · ${payment.note}`}
                  </p>
                  {payment.photoUrl && (
                    <button
                      type="button"
                      onClick={() =>
                        onViewPhoto({
                          url: payment.photoUrl as string,
                          title: `${formatMoney(payment.amount)} · ${payment.method}`,
                          subtitle: `${worker.name} · ${formatDate(payment.paidOn)}`,
                          downloadName: `${worker.name} payment ${formatDate(payment.paidOn)}`,
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
                  onClick={() => onDeletePayment(payment.id)}
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

      {/* Actions */}
      <div className="flex flex-col gap-2.5 pt-3 border-t border-slate-100">
        {isJobWork && (
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={onGiveGoods}
              className="flex items-center justify-center gap-2 px-4 py-3 text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl text-sm font-bold cursor-pointer transition-colors"
            >
              <PackageOpen className="h-4 w-4" />
              Give goods
            </button>
            <button
              type="button"
              onClick={onReceiveGoods}
              className="flex items-center justify-center gap-2 px-4 py-3 text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl text-sm font-bold cursor-pointer transition-colors"
            >
              <PackageCheck className="h-4 w-4" />
              Receive goods
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={onAddPayment}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold cursor-pointer transition-colors"
        >
          <Wallet className="h-4 w-4" />
          Add payment
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl text-sm font-bold cursor-pointer transition-colors"
        >
          <Pencil className="h-4 w-4" />
          Edit this worker
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl text-sm font-semibold cursor-pointer transition-colors"
        >
          <Trash2 className="h-4 w-4" />
          Remove this worker
        </button>
      </div>
    </div>
  );
}

// --- Add / edit worker modal ---

interface WorkerFormModalProps {
  open: boolean;
  /** The saved worker being corrected, or null when adding a new one. */
  worker: Worker | null;
  onClose: () => void;
  onSaved: (worker: Worker, wasEdited: boolean) => void;
}

function WorkerFormModal({ open, worker, onClose, onSaved }: WorkerFormModalProps) {
  const isEditing = Boolean(worker);
  const [name, setName] = useState('');
  const [type, setType] = useState<WorkerType>('Shop');
  const [phone, setPhone] = useState('');
  const [monthlySalary, setMonthlySalary] = useState('');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<FormProblem | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const problemRef = useProblemScroll(problem);

  const reset = () => {
    setName('');
    setType('Shop');
    setPhone('');
    setMonthlySalary('');
    setNote('');
    setProblem(null);
    setIsSaving(false);
  };

  useEffect(() => {
    if (!open) return;
    if (worker) {
      setName(worker.name);
      setType(worker.type);
      setPhone(worker.phone);
      setMonthlySalary(worker.monthlySalary ? String(worker.monthlySalary) : '');
      setNote(worker.note);
      setProblem(null);
      setIsSaving(false);
    } else {
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, worker?.id]);

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);

    if (!name.trim()) {
      setProblem(fieldProblem("Please enter the worker's name."));
      return;
    }

    setIsSaving(true);
    const saved: Worker = {
      id: worker?.id ?? `wk-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: name.trim(),
      type,
      phone: phone.trim(),
      monthlySalary: type === 'Shop' ? Math.round(parseNum(monthlySalary) * 100) / 100 : 0,
      note: note.trim(),
      createdAt: worker?.createdAt ?? new Date().toISOString(),
    };

    try {
      if (worker) await updateWorkerInDb(saved);
      else await insertWorker(saved);
      reset();
      onSaved(saved, Boolean(worker));
    } catch (err) {
      console.error('Saving the worker failed:', err);
      setIsSaving(false);
      setProblem(
        saveProblem(err, worker ? 'Your changes could not be saved' : 'The worker could not be saved')
      );
    }
  };

  return (
    <AppModal
      open={open}
      onClose={handleClose}
      title={isEditing ? 'Edit this worker' : 'Add worker'}
      description={
        isEditing
          ? 'Correct anything that is wrong and save again'
          : 'A shop worker gets a monthly salary; a job worker is paid for stitching work'
      }
      icon={<UserRound className="h-5 w-5" />}
      accent="amber"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {problem?.near === 'fields' && (
          <div ref={problemRef}>
            <FormError message={problem.message} />
          </div>
        )}

        <FormInput
          label="Worker name"
          type="text"
          required
          placeholder="e.g. Ramesh"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isSaving}
          accent="amber"
        />

        <div className="space-y-1.5">
          <label className="block text-sm font-semibold text-slate-700">Type of work</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setType('Shop')}
              disabled={isSaving}
              className={`flex items-center justify-center gap-2 px-3 py-3.5 text-sm font-semibold rounded-xl border transition-all cursor-pointer ${
                type === 'Shop'
                  ? 'bg-[#0F172A] text-white border-slate-800 shadow-xs'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}
            >
              <Store className="h-4 w-4" />
              Shop worker
            </button>
            <button
              type="button"
              onClick={() => setType('Job work')}
              disabled={isSaving}
              className={`flex items-center justify-center gap-2 px-3 py-3.5 text-sm font-semibold rounded-xl border transition-all cursor-pointer ${
                type === 'Job work'
                  ? 'bg-[#0F172A] text-white border-slate-800 shadow-xs'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}
            >
              <Scissors className="h-4 w-4" />
              Job work
            </button>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">
            {type === 'Shop'
              ? 'Works in the shop and gets a fixed salary every month.'
              : 'Takes cloth for stitching and is paid for the pieces brought back.'}
          </p>
        </div>

        {type === 'Shop' && (
          <FormInput
            label="Monthly salary ₹"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            placeholder="e.g. 12000"
            value={monthlySalary}
            onChange={(e) => setMonthlySalary(e.target.value)}
            disabled={isSaving}
            accent="amber"
          />
        )}

        <FormInput
          label="Phone number (optional)"
          type="tel"
          placeholder="e.g. 98250 12345"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          disabled={isSaving}
          accent="amber"
        />

        <FormInput
          label="Note (optional)"
          type="text"
          placeholder="e.g. Works only on weekdays"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={isSaving}
          accent="amber"
        />

        {problem?.near === 'save' && (
          <div ref={problemRef}>
            <FormError
              message={`${problem.message} Nothing you typed here is lost — it stays on screen until it saves.`}
              detail={problem.detail}
            />
          </div>
        )}

        <ModalActions
          onCancel={handleClose}
          submitLabel={isEditing ? 'Save changes' : 'Add worker'}
          submitAccent="amber"
          isSubmitting={isSaving}
        />
      </form>
    </AppModal>
  );
}

// --- Give goods modal (job workers) ---

interface GiveGoodsModalProps {
  worker: Worker;
  itemSuggestions: string[];
  /** Unit of a stock item, so picking one fills the unit automatically. */
  resolveUnit?: (item: string) => string | undefined;
  onClose: () => void;
  onSaved: (issue: GoodsIssue, workerName: string) => void;
}

interface GoodsItemRow {
  item: string;
  quantity: string;
  unit: string;
}

/** Turns form rows into clean item lines, dropping rows left fully empty. */
function rowsToItems(rows: GoodsItemRow[]): GoodsItem[] {
  return rows
    .filter((row) => row.item.trim() || parseNum(row.quantity) > 0)
    .map((row) => ({
      item: row.item.trim(),
      quantity: parseNum(row.quantity),
      unit: row.unit.trim(),
    }));
}

interface GoodsItemRowsEditorProps {
  rows: GoodsItemRow[];
  setRows: React.Dispatch<React.SetStateAction<GoodsItemRow[]>>;
  itemSuggestions: string[];
  unitSuggestions: string[];
  itemPlaceholder: string;
  defaultUnit: string;
  disabled: boolean;
  /** Returns the known unit for an item (e.g. from stock), to fill it automatically. */
  resolveUnit?: (item: string) => string | undefined;
}

/** Item + quantity + unit rows with an "add another" button, shared by both goods forms. */
function GoodsItemRowsEditor({
  rows,
  setRows,
  itemSuggestions,
  unitSuggestions,
  itemPlaceholder,
  defaultUnit,
  disabled,
  resolveUnit,
}: GoodsItemRowsEditorProps) {
  const updateRow = (index: number, patch: Partial<GoodsItemRow>) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const updateItem = (index: number, item: string) => {
    const knownUnit = resolveUnit?.(item);
    updateRow(index, knownUnit ? { item, unit: knownUnit } : { item });
  };

  return (
    <div className="space-y-3">
      {rows.map((row, index) => (
        <div key={index} className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2.5">
          <div className="flex items-center gap-2">
            <SuggestInput
              value={row.item}
              onChange={(next) => updateItem(index, next)}
              suggestions={itemSuggestions}
              placeholder={rows.length > 1 ? `Item ${index + 1}, ${itemPlaceholder}` : itemPlaceholder}
              disabled={disabled}
              containerClassName="flex-1 min-w-0"
            />
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                disabled={disabled}
                className="p-2.5 text-slate-400 hover:text-red-600 bg-white border border-slate-200 rounded-lg cursor-pointer shrink-0"
                aria-label="Remove this item"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">How much</label>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                placeholder="0"
                value={row.quantity}
                onChange={(e) => updateRow(index, { quantity: e.target.value })}
                disabled={disabled}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 transition-all tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Unit</label>
              <SuggestInput
                value={row.unit}
                onChange={(next) => updateRow(index, { unit: next })}
                suggestions={unitSuggestions}
                placeholder={`e.g. ${defaultUnit}`}
                disabled={disabled}
              />
            </div>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setRows((prev) => [...prev, { item: '', quantity: '', unit: defaultUnit }])}
        disabled={disabled}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-slate-600 bg-white hover:bg-slate-50 border border-dashed border-slate-300 rounded-xl cursor-pointer transition-colors"
      >
        <Plus className="h-4 w-4" />
        Add another item
      </button>
    </div>
  );
}

function GiveGoodsModal({ worker, itemSuggestions, resolveUnit, onClose, onSaved }: GiveGoodsModalProps) {
  const [issuedOn, setIssuedOn] = useState(todayISO());
  const [rows, setRows] = useState<GoodsItemRow[]>([{ item: '', quantity: '', unit: 'Meter' }]);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<FormProblem | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const problemRef = useProblemScroll(problem);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);

    const items = rowsToItems(rows);
    if (items.length === 0) {
      setProblem(fieldProblem('Please add at least one item you are giving (e.g. Cotton cloth).'));
      return;
    }
    if (items.some((it) => !it.item)) {
      setProblem(fieldProblem('Every item needs a name.'));
      return;
    }
    if (items.some((it) => it.quantity <= 0)) {
      setProblem(fieldProblem('Please enter how much you are giving of every item.'));
      return;
    }

    setIsSaving(true);
    const issue: GoodsIssue = {
      id: `gi-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      workerId: worker.id,
      issuedOn,
      items,
      note: note.trim(),
      createdAt: new Date().toISOString(),
    };

    try {
      await insertGoodsIssue(issue);
      onSaved(issue, worker.name);
    } catch (err) {
      console.error('Saving the goods entry failed:', err);
      setIsSaving(false);
      setProblem(saveProblem(err, 'The entry could not be saved'));
    }
  };

  return (
    <AppModal
      open
      onClose={onClose}
      title="Give goods"
      description={`Cloth or material handed to ${worker.name} for stitching`}
      icon={<PackageOpen className="h-5 w-5" />}
      accent="amber"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {problem?.near === 'fields' && (
          <div ref={problemRef}>
            <FormError message={problem.message} />
          </div>
        )}

        <div className="space-y-1.5">
          <label className="block text-sm font-semibold text-slate-700">What are you giving?</label>
          <GoodsItemRowsEditor
            rows={rows}
            setRows={setRows}
            itemSuggestions={itemSuggestions}
            unitSuggestions={ISSUE_UNIT_SUGGESTIONS}
            itemPlaceholder="e.g. Cotton cloth"
            defaultUnit="Meter"
            disabled={isSaving}
            resolveUnit={resolveUnit}
          />
        </div>

        <DateField
          label="Given on"
          value={issuedOn}
          onChange={setIssuedOn}
          disabled={isSaving}
          accent="amber"
        />

        <FormInput
          label="Note (optional)"
          type="text"
          placeholder="e.g. For saree falls, blue colour"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={isSaving}
          accent="amber"
        />

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
          submitLabel="Save entry"
          submitAccent="amber"
          isSubmitting={isSaving}
        />
      </form>
    </AppModal>
  );
}

// --- Receive goods modal (job workers) ---

interface ReceiveGoodsModalProps {
  worker: Worker;
  itemSuggestions: string[];
  onClose: () => void;
  onSaved: (entry: GoodsReturn, workerName: string) => void;
}

function ReceiveGoodsModal({ worker, itemSuggestions, onClose, onSaved }: ReceiveGoodsModalProps) {
  const [returnedOn, setReturnedOn] = useState(todayISO());
  const [rows, setRows] = useState<GoodsItemRow[]>([{ item: '', quantity: '', unit: 'Dozen' }]);
  const [metersUsed, setMetersUsed] = useState('');
  const [rate, setRate] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<FormProblem | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const problemRef = useProblemScroll(problem);

  // The wage is paid on the cloth worked: meters × rate per meter.
  const updateMetersUsed = (value: string) => {
    setMetersUsed(value);
    const meters = parseNum(value);
    const r = parseNum(rate);
    if (meters > 0 && r > 0) setAmount(String(Math.round(meters * r * 100) / 100));
  };

  const updateRate = (value: string) => {
    setRate(value);
    const meters = parseNum(metersUsed);
    const r = parseNum(value);
    if (meters > 0 && r > 0) setAmount(String(Math.round(meters * r * 100) / 100));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);

    const items = rowsToItems(rows);
    if (items.length === 0) {
      setProblem(fieldProblem('Please add at least one item that came back (e.g. Falls).'));
      return;
    }
    if (items.some((it) => !it.item)) {
      setProblem(fieldProblem('Every item needs a name.'));
      return;
    }
    if (items.some((it) => it.quantity <= 0)) {
      setProblem(fieldProblem('Please enter how much came back of every item (e.g. 40 Dozen).'));
      return;
    }
    if (parseNum(metersUsed) <= 0) {
      setProblem(fieldProblem('Please enter how many meters of cloth were worked on.'));
      return;
    }

    setIsSaving(true);
    const entry: GoodsReturn = {
      id: `gr-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      workerId: worker.id,
      returnedOn,
      items,
      metersUsed: Math.round(parseNum(metersUsed) * 100) / 100,
      rate: Math.round(parseNum(rate) * 100) / 100,
      amount: Math.round(parseNum(amount) * 100) / 100,
      note: note.trim(),
      createdAt: new Date().toISOString(),
    };

    try {
      await insertGoodsReturn(entry);
      onSaved(entry, worker.name);
    } catch (err) {
      console.error('Saving the returned goods failed:', err);
      setIsSaving(false);
      setProblem(saveProblem(err, 'The entry could not be saved'));
    }
  };

  return (
    <AppModal
      open
      onClose={onClose}
      title="Receive goods"
      description={`Falls brought back by ${worker.name} — the wage is paid on the meters worked`}
      icon={<PackageCheck className="h-5 w-5" />}
      accent="amber"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {problem?.near === 'fields' && (
          <div ref={problemRef}>
            <FormError message={problem.message} />
          </div>
        )}

        <div className="space-y-1.5">
          <label className="block text-sm font-semibold text-slate-700">What came back?</label>
          <GoodsItemRowsEditor
            rows={rows}
            setRows={setRows}
            itemSuggestions={itemSuggestions}
            unitSuggestions={RETURN_UNIT_SUGGESTIONS}
            itemPlaceholder="e.g. Falls"
            defaultUnit="Dozen"
            disabled={isSaving}
          />
        </div>

        {/* Wage is on the cloth worked, not on the pieces */}
        <div className="bg-amber-50/60 border border-amber-100 rounded-xl p-3 space-y-3">
          <p className="text-xs font-bold text-amber-800">
            Wage — paid on the meters of cloth worked
          </p>
          <div className="grid grid-cols-2 gap-3">
            <FormInput
              label="Cloth worked (meters)"
              type="number"
              inputMode="decimal"
              required
              min={0}
              step="any"
              placeholder="e.g. 120"
              value={metersUsed}
              onChange={(e) => updateMetersUsed(e.target.value)}
              disabled={isSaving}
              accent="amber"
            />
            <FormInput
              label="Rate ₹ per meter"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              placeholder="e.g. 4"
              value={rate}
              onChange={(e) => updateRate(e.target.value)}
              disabled={isSaving}
              accent="amber"
            />
          </div>
          <FormInput
            label="Wage for this work ₹"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            placeholder="Meters × rate (or type it yourself)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={isSaving}
            accent="amber"
          />
        </div>

        <DateField
          label="Received on"
          value={returnedOn}
          onChange={setReturnedOn}
          disabled={isSaving}
          accent="amber"
        />

        <FormInput
          label="Note (optional)"
          type="text"
          placeholder="e.g. 2 dozen rejected"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={isSaving}
          accent="amber"
        />

        {/* Wage summary */}
        <div className="bg-[#0F172A] text-white rounded-xl p-4">
          <div className="flex items-center justify-between text-base font-bold">
            <span>Wage earned</span>
            <span className="tabular-nums text-amber-400">{formatMoney(parseNum(amount))}</span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            {parseNum(metersUsed) > 0 && parseNum(rate) > 0
              ? `${parseNum(metersUsed).toLocaleString('en-IN')} m × ${formatMoney(parseNum(rate))} per meter. `
              : ''}
            This is added to what the worker has earned. Payments are recorded separately.
          </p>
        </div>

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
          submitLabel="Save entry"
          submitAccent="amber"
          isSubmitting={isSaving}
        />
      </form>
    </AppModal>
  );
}

// --- Add payment modal ---

interface AddWorkerPaymentModalProps {
  worker: Worker;
  earned: number;
  paid: number;
  paidThisMonth: number;
  onClose: () => void;
  onSaved: (payment: WorkerPayment, workerName: string) => void;
  showToast: WorkersSectionProps['showToast'];
}

function AddWorkerPaymentModal({
  worker,
  earned,
  paid,
  paidThisMonth,
  onClose,
  onSaved,
  showToast,
}: AddWorkerPaymentModalProps) {
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(todayISO());
  const [method, setMethod] = useState<PaymentMethod>('Cash');
  const [reference, setReference] = useState('');
  const [bankName, setBankName] = useState('');
  const [note, setNote] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<FormProblem | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const problemRef = useProblemScroll(problem);

  const isJobWork = worker.type === 'Job work';
  const jobLeft = Math.max(0, earned - paid);
  const monthLeft = Math.max(0, worker.monthlySalary - paidThisMonth);
  const suggested = isJobWork ? jobLeft : monthLeft;

  const description = isJobWork
    ? `To ${worker.name} · Left to pay for work done: ${formatMoney(jobLeft)}`
    : worker.monthlySalary > 0
      ? `To ${worker.name} · Left from this month's salary: ${formatMoney(monthLeft)}`
      : `To ${worker.name}`;

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
      setProblem(fieldProblem('Please enter the amount you gave.'));
      return;
    }

    setIsSaving(true);
    let photoUrl: string | null = null;
    if (photoFile) {
      photoUrl = await uploadBillPhoto(photoFile, 'worker-payments');
      if (!photoUrl) {
        showToast('The screenshot could not be uploaded, but the payment will still be saved.', 'info');
      }
    }

    const payment: WorkerPayment = {
      id: `wpay-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      workerId: worker.id,
      paidOn,
      amount: amountNum,
      method,
      reference: reference.trim(),
      bankName: bankName.trim(),
      photoUrl,
      note: note.trim(),
      createdAt: new Date().toISOString(),
    };

    try {
      await insertWorkerPayment(payment);
      onSaved(payment, worker.name);
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
      description={description}
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
          inputId="worker-payment-photo-input"
        />

        <div>
          <FormInput
            label="Amount given ₹"
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
          {suggested > 0 && (
            <button
              type="button"
              onClick={() => setAmount(String(suggested))}
              disabled={isSaving}
              className="mt-2 px-3 py-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-full cursor-pointer transition-colors"
            >
              {isJobWork
                ? `Full amount — ${formatMoney(suggested)}`
                : `Rest of this month — ${formatMoney(suggested)}`}
            </button>
          )}
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

        <FormInput
          label="Note (optional)"
          type="text"
          placeholder="e.g. Advance for Diwali"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={isSaving}
          accent="emerald"
        />

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
