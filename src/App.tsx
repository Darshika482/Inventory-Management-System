import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldCheck,
  CheckCircle,
  AlertOctagon,
  X,
  Menu,
} from 'lucide-react';
import { User, Category, WithdrawalLog, StockAddition, Floor } from './types';
import { getAppSession } from './lib/supabase';
import { Login } from './components/Login';
import { Sidebar } from './components/Sidebar';
import { PageFrame, PageLoading } from './components/PageFrame';
import { lazyPage, preloadInBackground } from './lib/lazyPage';
import { clearLocalCopies, loadLocalFirst, localCopy } from './lib/localFirst';
import {
  authenticateUser,
  deleteCategoryFromDb,
  fetchCategories,
  fetchWithdrawalLogs,
  fetchStaffUsers,
  fetchStockAdditions,
  logoutUser,
  insertCategory,
  insertStockAddition,
  insertWithdrawalLog,
  updateCategoryInDb,
  updateCategoryNameInLogs,
  updateWithdrawalLogStatus,
} from './lib/database';
import { createCategoryId } from './lib/floors';
import { useBackDismiss } from './lib/backGuard';
import { isShopSection, NewSaleShortcut, preloadShopPages, ShopSection } from './sales/ShopModule';

// Each page's code is downloaded when it is first opened (and in the
// background once the app is idle), so the app itself starts small and fast.
const AdminDashboard = lazyPage(() => import('./components/AdminDashboard'), (m) => m.AdminDashboard);
const BillsSection = lazyPage(() => import('./components/BillsSection'), (m) => m.BillsSection);
const PaymentsSection = lazyPage(() => import('./components/PaymentsSection'), (m) => m.PaymentsSection);
const AnalysisSection = lazyPage(() => import('./components/AnalysisSection'), (m) => m.AnalysisSection);
const TransportSection = lazyPage(() => import('./components/TransportSection'), (m) => m.TransportSection);
const WorkersSection = lazyPage(() => import('./components/WorkersSection'), (m) => m.WorkersSection);
const OWNER_PAGES = [AdminDashboard, BillsSection, PaymentsSection, AnalysisSection, TransportSection, WorkersSection];

/** Owner pages with their own data; every other owner page is the godown stock dashboard. */
const OWN_DATA_PAGES = ['bills', 'payments', 'analysis', 'transport', 'workers'];

/** The godown stock lists, kept on this phone so the dashboard opens at once. */
interface GodownData {
  categories: Category[];
  logs: WithdrawalLog[];
  stockAdditions: StockAddition[];
  staffMembers: User[];
}

const godownCopy = localCopy<GodownData>('godown');

async function fetchGodownData(): Promise<GodownData> {
  const [categories, logs, stockAdditions, staffMembers] = await Promise.all([
    fetchCategories(),
    fetchWithdrawalLogs(),
    fetchStockAdditions(),
    fetchStaffUsers().catch(() => [] as User[]),
  ]);
  return { categories, logs, stockAdditions, staffMembers };
}

/**
 * 'copy': only the copy saved on this phone could be shown (no internet).
 * Stock changes wait for 'fresh': they write whole quantities, so they must
 * start from the latest numbers.
 */
type GodownStatus = 'idle' | 'loading' | 'copy' | 'fresh';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

const ACTIVE_SECTION_KEY = 'ims_active_section';

function homeSectionFor(role?: User['role']): string {
  return role === 'Admin' ? 'overview' : 'shop-new-sale';
}

// Reopen on the page the user last had. Admins can land on any of their pages
// (whatever was stored came from a real menu click), while workers only have
// the shop sales pages open to staff. Falls back to the home page when nothing
// is stored.
function readInitialSection(user: User | null): string {
  const home = homeSectionFor(user?.role);
  const stored = localStorage.getItem(ACTIVE_SECTION_KEY);
  if (user?.role !== 'Admin') return stored && isShopSection(stored, user?.role ?? 'Worker') ? stored : home;
  return stored || home;
}

function readStoredUser(): User | null {
  try {
    const stored = localStorage.getItem('ims_current_user');
    if (!stored) return null;
    // Signed in before session tokens existed: the database would hide all
    // shop data from this sign-in, so ask for a fresh one.
    if (!getAppSession()) {
      localStorage.removeItem('ims_current_user');
      return null;
    }
    return JSON.parse(stored) as User;
  } catch {
    return null;
  }
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(() => readStoredUser());

  const [categories, setCategories] = useState<Category[]>([]);
  const [logs, setLogs] = useState<WithdrawalLog[]>([]);
  const [stockAdditions, setStockAdditions] = useState<StockAddition[]>([]);
  const [staffMembers, setStaffMembers] = useState<User[]>([]);
  const [godownShown, setGodownShown] = useState(false);
  const [godownStatus, setGodownStatus] = useState<GodownStatus>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeSection, setActiveSection] = useState<string>(() =>
    readInitialSection(currentUser)
  );

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const homeSection = homeSectionFor(currentUser?.role);

  // Device / browser Back closes the mobile menu instead of leaving the app.
  useBackDismiss(mobileNavOpen, () => setMobileNavOpen(false));

  // Back from a sub-page returns to the home page rather than closing the app.
  useBackDismiss(!!currentUser && activeSection !== homeSection, () =>
    setActiveSection(homeSection)
  );

  // The godown stock is only for the owner's pages: shop staff never wait for
  // it, and the owner sees the copy saved on this phone while it refreshes.
  // Bumped on sign-out, so a download still running then is thrown away.
  const godownSession = useRef(0);

  const loadGodown = useCallback(async () => {
    const session = godownSession.current;
    const current = () => session === godownSession.current;
    setGodownStatus('loading');
    setLoadError(null);
    try {
      const store = {
        read: godownCopy.read,
        write: (data: GodownData) => {
          if (current()) godownCopy.write(data);
        },
      };
      const result = await loadLocalFirst(store, fetchGodownData, (data) => {
        if (!current()) return;
        setCategories(data.categories);
        setLogs(data.logs);
        setStockAdditions(data.stockAdditions);
        setStaffMembers(data.staffMembers);
        setGodownShown(true);
      });
      if (!current()) return;
      setGodownStatus(result);
      if (result === 'copy') {
        showToast('No internet. Showing the stock saved on this phone.', 'info');
      }
    } catch (err) {
      if (!current()) return;
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Could not load your stock. Please try again.';
      setLoadError(message);
      setGodownStatus('idle');
    }
  }, []);

  const isOwner = currentUser?.role === 'Admin';
  // The stock dashboard's pages; the others never wait on its downloads.
  const onGodownPage =
    isOwner && !isShopSection(activeSection, 'Admin') && !OWN_DATA_PAGES.includes(activeSection);

  // Each time the stock pages are opened: the copy at once, then the latest.
  useEffect(() => {
    if (onGodownPage) void loadGodown();
  }, [onGodownPage, loadGodown]);

  // Back online after showing the saved copy: fetch the latest stock.
  useEffect(() => {
    if (!onGodownPage || godownStatus === 'fresh' || godownStatus === 'loading') return;
    const onOnline = () => void loadGodown();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [onGodownPage, godownStatus, loadGodown]);

  // Stock changes made here go into the saved copy too, so the next open shows them.
  useEffect(() => {
    if (godownStatus === 'fresh') {
      godownCopy.write({ categories, logs, stockAdditions, staffMembers });
    }
  }, [godownStatus, categories, logs, stockAdditions, staffMembers]);

  // Once the first page is up, fetch the other pages' code while the phone is idle.
  useEffect(() => {
    if (!currentUser) return;
    preloadShopPages(currentUser.role);
    if (currentUser.role === 'Admin') preloadInBackground(OWNER_PAGES);
  }, [currentUser?.role]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('ims_current_user', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('ims_current_user');
      localStorage.removeItem(ACTIVE_SECTION_KEY);
    }
  }, [currentUser]);

  // Remember the open page so a refresh reopens it instead of the home page.
  useEffect(() => {
    if (currentUser) {
      localStorage.setItem(ACTIVE_SECTION_KEY, activeSection);
    }
  }, [currentUser, activeSection]);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = Date.now().toString() + Math.random().toString();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const getFormattedTimestamp = () => {
    const now = new Date();
    const datePart = now.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const timePart = now.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    return `${datePart} at ${timePart}`;
  };

  // Returns false for a wrong name or password; a technical failure is thrown
  // so the sign-in screen can show what actually went wrong.
  const handleLogin = async (username: string, password: string): Promise<boolean> => {
    const user = await authenticateUser(username, password);
    if (!user) return false;
    setCurrentUser(user);
    setActiveSection(homeSectionFor(user.role));
    showToast(`Welcome back, ${user.username}!`, 'success');
    return true;
  };

  const handleLogout = () => {
    void logoutUser();
    // The next person on this phone must not see the owner's lists.
    godownSession.current++;
    clearLocalCopies();
    setCategories([]);
    setLogs([]);
    setStockAdditions([]);
    setStaffMembers([]);
    setGodownShown(false);
    setGodownStatus('idle');
    setCurrentUser(null);
    showToast('You have signed out.', 'info');
  };

  /**
   * Stock changes write whole quantities, so they wait until the latest stock
   * has arrived (a moment after opening, or once the internet is back).
   */
  const stockIsFresh = (): boolean => {
    if (godownStatus === 'fresh') return true;
    if (godownStatus === 'loading') {
      showToast('Getting the latest stock first. Please try again in a moment.', 'info');
    } else {
      void loadGodown();
      showToast('No internet: this is the stock saved on this phone. Changes need the internet, so please try again once connected.', 'error');
    }
    return false;
  };

  const handleAddNewCategory = async (
    name: string,
    unit: string,
    initialStock: number,
    floor: Floor
  ) => {
    if (!stockIsFresh()) return;
    const newCategory: Category = {
      id: createCategoryId(name, floor, unit),
      name,
      unit,
      floor,
      initialStock,
      currentQuantity: initialStock,
      createdAt: new Date().toISOString(),
    };

    const additionLog: StockAddition = {
      id: `sa-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      categoryId: newCategory.id,
      categoryName: name,
      quantity: initialStock,
      floor,
      unit,
      type: 'new',
      timestamp: getFormattedTimestamp(),
      createdAt: new Date().toISOString(),
    };

    try {
      await insertCategory(newCategory);
      await insertStockAddition(additionLog);
      setCategories((prev) => [...prev, newCategory]);
      setStockAdditions((prev) => [additionLog, ...prev]);
      showToast(`Added "${name}" on ${floor} with ${initialStock} ${unit} in stock.`, 'success');
    } catch {
      showToast('Could not save this item. Please try again.', 'error');
    }
  };

  const handleAddStock = async (categoryId: string, quantity: number) => {
    if (!stockIsFresh()) return;
    const category = categories.find((c) => c.id === categoryId);
    if (!category) return;

    const updated: Category = {
      ...category,
      initialStock: category.initialStock + quantity,
      currentQuantity: category.currentQuantity + quantity,
    };

    const additionLog: StockAddition = {
      id: `sa-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      categoryId,
      categoryName: category.name,
      quantity,
      floor: category.floor,
      unit: category.unit,
      type: 'restock',
      timestamp: getFormattedTimestamp(),
      createdAt: new Date().toISOString(),
    };

    try {
      await updateCategoryInDb(updated);
      await insertStockAddition(additionLog);
      setCategories((prev) => prev.map((cat) => (cat.id === categoryId ? updated : cat)));
      setStockAdditions((prev) => [additionLog, ...prev]);
      showToast(
        `Added ${quantity} ${category.unit} to "${category.name}". Total stock is now ${updated.initialStock}.`,
        'success'
      );
    } catch {
      showToast('Could not update stock. Please try again.', 'error');
    }
  };

  const handleUpdateCategory = async (
    categoryId: string,
    updates: { name: string; unit: string; floor: Floor; initialStock: number; currentQuantity: number }
  ) => {
    if (!stockIsFresh()) return;
    const category = categories.find((c) => c.id === categoryId);
    if (!category) return;

    const updated: Category = { ...category, ...updates };

    try {
      await updateCategoryInDb(updated);
      await updateCategoryNameInLogs(categoryId, updates.name);
      setCategories((prev) => prev.map((cat) => (cat.id === categoryId ? updated : cat)));
      setLogs((prev) =>
        prev.map((log) =>
          log.categoryId === categoryId ? { ...log, categoryName: updates.name } : log
        )
      );
      showToast(`"${updates.name}" updated successfully.`, 'success');
    } catch {
      showToast('Could not save changes. Please try again.', 'error');
    }
  };

  const handleDeleteCategory = async (categoryId: string) => {
    if (!stockIsFresh()) return;
    const category = categories.find((c) => c.id === categoryId);
    if (!category) return;

    try {
      await deleteCategoryFromDb(categoryId);
      setCategories((prev) => prev.filter((cat) => cat.id !== categoryId));
      showToast(`"${category.name}" removed from your stock list.`, 'info');
    } catch {
      showToast('Could not remove this item. Please try again.', 'error');
    }
  };

  const handleWithdraw = async (
    categoryId: string,
    quantity: number,
    staffUsername?: string
  ): Promise<{ success: boolean; message: string }> => {
    if (!stockIsFresh()) {
      return { success: false, message: 'Getting the latest stock first. Please try again in a moment.' };
    }
    const category = categories.find((c) => c.id === categoryId);

    if (!category) {
      return { success: false, message: 'That item was not found.' };
    }

    if (category.currentQuantity < quantity) {
      const errorMsg = `Not enough stock. You asked for ${quantity} ${category.unit}, but only ${category.currentQuantity} are left.`;
      showToast(errorMsg, 'error');
      return { success: false, message: errorMsg };
    }

    const assignee = staffUsername?.trim() || currentUser?.username || 'unknown';
    const recordedByAdmin =
      currentUser?.role === 'Admin' && staffUsername && staffUsername !== currentUser.username;

    const updatedCategory: Category = {
      ...category,
      currentQuantity: category.currentQuantity - quantity,
    };

    const timestamp = getFormattedTimestamp();
    const newLogEntry: WithdrawalLog = {
      id: `trx-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      workerId: assignee,
      categoryId,
      categoryName: category.name,
      quantity,
      timestamp,
      status: 'Approved',
    };

    try {
      await updateCategoryInDb(updatedCategory);
      await insertWithdrawalLog(newLogEntry);
      setCategories((prev) =>
        prev.map((cat) => (cat.id === categoryId ? updatedCategory : cat))
      );
      setLogs((prev) => [newLogEntry, ...prev]);
      const toastMsg = recordedByAdmin
        ? `Recorded: ${assignee} took ${quantity} ${category.unit} of "${category.name}".`
        : `Recorded: ${quantity} ${category.unit} of "${category.name}" taken.`;
      showToast(toastMsg, 'success');
      return {
        success: true,
        message: recordedByAdmin
          ? `Recorded for ${assignee}: ${quantity} ${category.unit} of "${category.name}".`
          : `Done! You took ${quantity} ${category.unit} of "${category.name}".`,
      };
    } catch {
      showToast('Could not save this. Please try again.', 'error');
      return { success: false, message: 'Something went wrong. Please try again.' };
    }
  };

  const handleToggleLogStatus = async (logId: string) => {
    if (!stockIsFresh()) return;
    const log = logs.find((l) => l.id === logId);
    if (!log) return;

    if (log.status === 'Approved') {
      const category = categories.find((c) => c.id === log.categoryId);
      if (!category) {
        showToast('This item no longer exists, so stock cannot be restored.', 'error');
        return;
      }

      const updatedCategory: Category = {
        ...category,
        currentQuantity: category.currentQuantity + log.quantity,
      };

      try {
        await updateCategoryInDb(updatedCategory);
        await updateWithdrawalLogStatus(logId, 'Rejected');
        setCategories((prev) =>
          prev.map((cat) => (cat.id === log.categoryId ? updatedCategory : cat))
        );
        setLogs((prev) =>
          prev.map((l) => (l.id === logId ? { ...l, status: 'Rejected' as const } : l))
        );
        showToast(
          `Undone. Put back ${log.quantity} ${category.unit} of "${category.name}".`,
          'info'
        );
      } catch {
        showToast('Could not undo this. Please try again.', 'error');
      }
    } else {
      const category = categories.find((c) => c.id === log.categoryId);
      if (!category) {
        showToast('This item no longer exists, so stock cannot be restored.', 'error');
        return;
      }

      if (category.currentQuantity < log.quantity) {
        showToast(
          `Not enough stock in "${category.name}" — only ${category.currentQuantity} left.`,
          'error'
        );
        return;
      }

      const updatedCategory: Category = {
        ...category,
        currentQuantity: category.currentQuantity - log.quantity,
      };

      try {
        await updateCategoryInDb(updatedCategory);
        await updateWithdrawalLogStatus(logId, 'Approved');
        setCategories((prev) =>
          prev.map((cat) => (cat.id === log.categoryId ? updatedCategory : cat))
        );
        setLogs((prev) =>
          prev.map((l) => (l.id === logId ? { ...l, status: 'Approved' as const } : l))
        );
        showToast(
          `Confirmed again. Took ${log.quantity} ${category.unit} from "${category.name}".`,
          'success'
        );
      } catch {
        showToast('Could not confirm this. Please try again.', 'error');
      }
    }
  };

  if (!currentUser) {
    return (
      <>
        <Login onLogin={handleLogin} />
        <ToastTray toasts={toasts} onRemove={removeToast} />
      </>
    );
  }

  return (
    <div className="flex h-screen bg-[#F8FAFC] font-sans text-slate-900 overflow-hidden relative">
      {mobileNavOpen && (
        <button
          type="button"
          aria-label="Close navigation menu"
          onClick={() => setMobileNavOpen(false)}
          className="fixed inset-0 z-40 bg-slate-900/50 docked:hidden"
        />
      )}

      <Sidebar
        currentUser={currentUser}
        onLogout={handleLogout}
        activeSection={activeSection}
        setActiveSection={setActiveSection}
        userRole={currentUser.role}
        isMobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />

      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <header className="docked:hidden flex items-center gap-3 px-4 py-3 bg-[#0F172A] border-b border-slate-800 shrink-0 z-30">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="p-2 -ml-2 text-slate-300 hover:text-white transition-colors cursor-pointer"
            aria-label="Open navigation menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <p className="text-white font-bold text-base truncate">
              Akshay Traders
            </p>
            <p className="text-sm text-slate-400 truncate">
              {currentUser.username} · {currentUser.role === 'Worker' ? 'Staff' : currentUser.role}
            </p>
          </div>
          <NewSaleShortcut activeSection={activeSection} onNavigate={setActiveSection} />
        </header>

        {isShopSection(activeSection, currentUser.role) ? (
          <ShopSection
            key={activeSection}
            section={activeSection}
            currentUser={currentUser}
            onNavigate={setActiveSection}
            showToast={showToast}
          />
        ) : currentUser.role === 'Admin' ? (
          // The stock dashboard's pages share one frame, so its filters survive a page switch.
          <PageFrame key={OWN_DATA_PAGES.includes(activeSection) ? activeSection : 'godown'}>
            {activeSection === 'bills' ? (
              <BillsSection showToast={showToast} />
            ) : activeSection === 'payments' ? (
              <PaymentsSection showToast={showToast} />
            ) : activeSection === 'analysis' ? (
              <AnalysisSection showToast={showToast} />
            ) : activeSection === 'transport' ? (
              <TransportSection showToast={showToast} />
            ) : activeSection === 'workers' ? (
              <WorkersSection showToast={showToast} />
            ) : !godownShown && loadError ? (
              <GodownLoadError message={loadError} onRetry={loadGodown} />
            ) : !godownShown ? (
              <PageLoading label="Loading your stock..." />
            ) : (
              <AdminDashboard
                categories={categories}
                logs={logs}
                stockAdditions={stockAdditions}
                staffMembers={staffMembers}
                onAddStock={handleAddStock}
                onAddNewCategory={handleAddNewCategory}
                onUpdateCategory={handleUpdateCategory}
                onDeleteCategory={handleDeleteCategory}
                onToggleLogStatus={handleToggleLogStatus}
                onRecordWithdrawal={(categoryId, quantity, staffUsername) =>
                  handleWithdraw(categoryId, quantity, staffUsername)
                }
                activeSection={activeSection}
              />
            )}
          </PageFrame>
        ) : (
          <ShopSection
            key="shop-new-sale"
            section="shop-new-sale"
            currentUser={currentUser}
            onNavigate={setActiveSection}
            showToast={showToast}
          />
        )}
      </div>

      <ToastTray toasts={toasts} onRemove={removeToast} />
    </div>
  );
}

function GodownLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center bg-[#F8FAFC] p-4">
      <div className="max-w-md w-full bg-white border border-red-200 rounded-xl p-6 shadow-lg text-center space-y-4">
        <AlertOctagon className="h-10 w-10 text-red-500 mx-auto" />
        <h2 className="text-xl font-bold text-slate-900">Could not load your stock</h2>
        <p className="text-base text-slate-600">{message}</p>
        <p className="text-sm text-slate-500 leading-relaxed">
          Check your internet connection and try again. If the problem continues, contact your manager.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="px-5 py-3 bg-[#0F172A] text-white rounded-xl text-base font-semibold cursor-pointer"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

interface ToastTrayProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

function ToastTray({ toasts, onRemove }: ToastTrayProps) {
  return (
    // Above the modals (z-50), which are portalled later into <body> and would
    // otherwise paint straight over every toast raised from inside a form.
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-5 sm:bottom-5 z-[60] flex flex-col gap-3 sm:max-w-sm w-auto sm:w-full font-sans">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 30, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 50, scale: 0.9 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
            className={`p-5 rounded-xl shadow-xl border text-base flex items-start gap-3 relative ${toast.type === 'success'
                ? 'bg-[#DCFCE7] border-[#BBF7D0] text-[#166534]'
                : toast.type === 'error'
                  ? 'bg-[#FEE2E2] border-[#FECACA] text-[#991B1B]'
                  : 'bg-white border-slate-200 text-slate-700'
              }`}
          >
            {toast.type === 'success' && (
              <CheckCircle className="h-4 w-4 text-[#166534] shrink-0 mt-0.5" />
            )}
            {toast.type === 'error' && (
              <AlertOctagon className="h-4 w-4 text-[#991B1B] shrink-0 mt-0.5" />
            )}
            {toast.type === 'info' && (
              <ShieldCheck className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            )}

            <div className="flex-1 pr-6 leading-relaxed font-semibold">{toast.message}</div>

            <button
              onClick={() => onRemove(toast.id)}
              className="absolute top-2.5 right-2.5 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
