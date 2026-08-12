import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldCheck,
  LogOut,
  CheckCircle,
  AlertOctagon,
  X,
  Menu,
  Loader2,
  Warehouse,
} from 'lucide-react';
import { User, Category, WithdrawalLog, StockAddition, Floor } from './types';
import { Login } from './components/Login';
import { Sidebar } from './components/Sidebar';
import { AdminDashboard } from './components/AdminDashboard';
import { BillsSection } from './components/BillsSection';
import { WorkerDashboard } from './components/WorkerDashboard';
import {
  authenticateUser,
  deleteCategoryFromDb,
  fetchCategories,
  fetchWithdrawalLogs,
  fetchStaffUsers,
  fetchStockAdditions,
  insertCategory,
  insertStockAddition,
  insertWithdrawalLog,
  updateCategoryInDb,
  updateCategoryNameInLogs,
  updateWithdrawalLogStatus,
} from './lib/database';
import { createCategoryId } from './lib/floors';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const stored = localStorage.getItem('ims_current_user');
    return stored ? JSON.parse(stored) : null;
  });

  const [categories, setCategories] = useState<Category[]>([]);
  const [logs, setLogs] = useState<WithdrawalLog[]>([]);
  const [stockAdditions, setStockAdditions] = useState<StockAddition[]>([]);
  const [staffMembers, setStaffMembers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeSection, setActiveSection] = useState<string>(() => {
    if (currentUser?.role === 'Admin') return 'overview';
    return 'withdraw';
  });

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [categoriesData, logsData, stockAdditionsData, staffData] = await Promise.all([
        fetchCategories(),
        fetchWithdrawalLogs(),
        fetchStockAdditions(),
        fetchStaffUsers(),
      ]);
      setCategories(categoriesData);
      setLogs(logsData);
      setStockAdditions(stockAdditionsData);
      setStaffMembers(staffData);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not load your stock. Please try again.';
      setLoadError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('ims_current_user', JSON.stringify(currentUser));
      setActiveSection(currentUser.role === 'Admin' ? 'overview' : 'withdraw');
    } else {
      localStorage.removeItem('ims_current_user');
    }
  }, [currentUser]);

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

  const handleLogin = async (username: string, password: string): Promise<boolean> => {
    try {
      const user = await authenticateUser(username, password);
      if (!user) return false;
      setCurrentUser(user);
      showToast(`Welcome back, ${user.username}!`, 'success');
      return true;
    } catch {
      showToast('Could not sign in right now. Please try again.', 'error');
      return false;
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    showToast('You have signed out.', 'info');
  };

  const handleAddNewCategory = async (
    name: string,
    unit: string,
    initialStock: number,
    floor: Floor
  ) => {
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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-5 text-center">
          <div className="relative">
            <div className="h-20 w-20 rounded-2xl bg-[#0F172A] shadow-xl flex items-center justify-center">
              <div className="h-11 w-11 rounded-xl bg-amber-500 flex items-center justify-center text-[#0F172A]">
                <Warehouse className="h-6 w-6" />
              </div>
            </div>
            <Loader2 className="absolute -right-2 -bottom-2 h-7 w-7 animate-spin rounded-full bg-white p-1 text-amber-600 shadow-md" />
          </div>

          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Akshay Traders
            </h1>
            <p className="text-sm text-slate-500">
              Stock manager
            </p>
          </div>

          <p className="text-base font-medium text-slate-500">
            Loading your stock...
          </p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white border border-red-200 rounded-xl p-6 shadow-lg text-center space-y-4">
          <AlertOctagon className="h-10 w-10 text-red-500 mx-auto" />
          <h2 className="text-xl font-bold text-slate-900">Could not load your stock</h2>
          <p className="text-base text-slate-600">{loadError}</p>
          <p className="text-sm text-slate-500 leading-relaxed">
            Check your internet connection and try again. If the problem continues, contact your manager.
          </p>
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
          className="fixed inset-0 z-40 bg-slate-900/50 md:hidden"
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
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-[#0F172A] border-b border-slate-800 shrink-0 z-30">
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
        </header>

        {currentUser.role === 'Admin' && activeSection === 'bills' ? (
          <BillsSection showToast={showToast} />
        ) : currentUser.role === 'Admin' ? (
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
        ) : (
          <WorkerDashboard
            currentUser={currentUser}
            categories={categories}
            logs={logs}
            onWithdraw={handleWithdraw}
          />
        )}
      </div>

      <ToastTray toasts={toasts} onRemove={removeToast} />
    </div>
  );
}

interface ToastTrayProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

function ToastTray({ toasts, onRemove }: ToastTrayProps) {
  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-5 sm:bottom-5 z-50 flex flex-col gap-3 sm:max-w-sm w-auto sm:w-full font-sans">
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
