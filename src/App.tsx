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
import { User, Category, WithdrawalLog, Floor } from './types';
import { Login } from './components/Login';
import { Sidebar } from './components/Sidebar';
import { AdminDashboard } from './components/AdminDashboard';
import { WorkerDashboard } from './components/WorkerDashboard';
import {
  authenticateUser,
  deleteCategoryFromDb,
  fetchCategories,
  fetchWithdrawalLogs,
  insertCategory,
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
      const [categoriesData, logsData] = await Promise.all([
        fetchCategories(),
        fetchWithdrawalLogs(),
      ]);
      setCategories(categoriesData);
      setLogs(logsData);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to connect to Supabase backend.';
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
      showToast(`Access Authorized. Logged in as ${user.username}`, 'success');
      return true;
    } catch {
      showToast('Unable to reach authentication service.', 'error');
      return false;
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    showToast('Session terminated successfully.', 'info');
  };

  const handleAddNewCategory = async (
    name: string,
    unit: string,
    initialStock: number,
    floor: Floor
  ) => {
    const newCategory: Category = {
      id: createCategoryId(name, floor),
      name,
      unit,
      floor,
      initialStock,
      currentQuantity: initialStock,
    };

    try {
      await insertCategory(newCategory);
      setCategories((prev) => [...prev, newCategory]);
      showToast(`Category "${name}" provisioned on ${floor} with supply of ${initialStock} ${unit}.`, 'success');
    } catch {
      showToast('Failed to save category to database.', 'error');
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

    try {
      await updateCategoryInDb(updated);
      setCategories((prev) => prev.map((cat) => (cat.id === categoryId ? updated : cat)));
      showToast(
        `Injected ${quantity} ${category.unit} into "${category.name}". Total stock is now ${updated.initialStock}.`,
        'success'
      );
    } catch {
      showToast('Failed to update stock in database.', 'error');
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
      showToast(`Category "${updates.name}" updated successfully.`, 'success');
    } catch {
      showToast('Failed to update category in database.', 'error');
    }
  };

  const handleDeleteCategory = async (categoryId: string) => {
    const category = categories.find((c) => c.id === categoryId);
    if (!category) return;

    try {
      await deleteCategoryFromDb(categoryId);
      setCategories((prev) => prev.filter((cat) => cat.id !== categoryId));
      showToast(`Category "${category.name}" removed from inventory.`, 'info');
    } catch {
      showToast('Failed to delete category from database.', 'error');
    }
  };

  const handleWithdraw = async (
    categoryId: string,
    quantity: number
  ): Promise<{ success: boolean; message: string }> => {
    const category = categories.find((c) => c.id === categoryId);

    if (!category) {
      return { success: false, message: 'Resource not found in storage index.' };
    }

    if (category.currentQuantity < quantity) {
      const errorMsg = `Declined: Quantity requested (${quantity} ${category.unit}) exceeds current inventory level (${category.currentQuantity} remaining).`;
      showToast(errorMsg, 'error');
      return { success: false, message: errorMsg };
    }

    const updatedCategory: Category = {
      ...category,
      currentQuantity: category.currentQuantity - quantity,
    };

    const timestamp = getFormattedTimestamp();
    const newLogEntry: WithdrawalLog = {
      id: `trx-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      workerId: currentUser?.username || 'unknown',
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
      showToast(
        `Allocated ${quantity} ${category.unit} of "${category.name}". Warehouse updated.`,
        'success'
      );
      return {
        success: true,
        message: `Transaction approved: Allocated ${quantity} ${category.unit} of "${category.name}".`,
      };
    } catch {
      showToast('Failed to record withdrawal in database.', 'error');
      return { success: false, message: 'Database error while processing withdrawal.' };
    }
  };

  const handleToggleLogStatus = async (logId: string) => {
    const log = logs.find((l) => l.id === logId);
    if (!log) return;

    if (log.status === 'Approved') {
      const category = categories.find((c) => c.id === log.categoryId);
      if (!category) {
        showToast('Restore failed: Connected category does not exist anymore.', 'error');
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
          `Requisition rejected. Restored ${log.quantity} ${category.unit} to "${category.name}".`,
          'info'
        );
      } catch {
        showToast('Failed to reject withdrawal in database.', 'error');
      }
    } else {
      const category = categories.find((c) => c.id === log.categoryId);
      if (!category) {
        showToast('Restore failed: Connected category does not exist anymore.', 'error');
        return;
      }

      if (category.currentQuantity < log.quantity) {
        showToast(
          `Cannot re-approve: Insufficient stock in "${category.name}" (${category.currentQuantity} remaining).`,
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
          `Requisition re-approved. Deducted ${log.quantity} ${category.unit} from "${category.name}".`,
          'success'
        );
      } catch {
        showToast('Failed to approve withdrawal in database.', 'error');
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
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">
              Inventory Portal
            </p>
          </div>

          <p className="text-sm font-medium text-slate-500">
            Loading your stock dashboard...
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
          <h2 className="text-lg font-bold text-slate-900">Backend Connection Failed</h2>
          <p className="text-sm text-slate-600">{loadError}</p>
          <p className="text-xs text-slate-500 leading-relaxed">
            Run <code className="bg-slate-100 px-1 rounded">supabase/schema.sql</code> in your
            Supabase SQL Editor, then retry.
          </p>
          <button
            type="button"
            onClick={loadData}
            className="px-4 py-2 bg-[#0F172A] text-white rounded-md text-xs font-semibold uppercase tracking-wider cursor-pointer"
          >
            Retry Connection
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
            <p className="text-white font-bold text-sm uppercase tracking-tight truncate">
              Akshay Traders
            </p>
            <p className="text-[10px] text-slate-400 truncate">
              {currentUser.username} · {currentUser.role === 'Worker' ? 'Staff' : currentUser.role}
            </p>
          </div>
        </header>

        {currentUser.role === 'Admin' ? (
          <AdminDashboard
            categories={categories}
            logs={logs}
            onAddStock={handleAddStock}
            onAddNewCategory={handleAddNewCategory}
            onUpdateCategory={handleUpdateCategory}
            onDeleteCategory={handleDeleteCategory}
            onToggleLogStatus={handleToggleLogStatus}
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
            className={`p-4 rounded-lg shadow-xl border text-xs flex items-start gap-3 relative ${toast.type === 'success'
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
