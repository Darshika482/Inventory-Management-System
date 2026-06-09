import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShieldCheck, LogOut, CheckCircle, AlertOctagon, X, Menu } from 'lucide-react';
import { User, Category, WithdrawalLog } from './types';
import { Login } from './components/Login';
import { Sidebar } from './components/Sidebar';
import { AdminDashboard } from './components/AdminDashboard';
import { WorkerDashboard } from './components/WorkerDashboard';

const DATA_VERSION = '3';

const SEED_USERS = [
  { username: 'admin', role: 'Admin' as const, passwordHash: 'admin123' },
  { username: 'worker01', role: 'Worker' as const, passwordHash: 'pass123' },
  { username: 'worker02', role: 'Worker' as const, passwordHash: 'pass123' },
  { username: 'worker03', role: 'Worker' as const, passwordHash: 'pass123' },
];

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

export default function App() {
  // --- Persistent States ---
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const stored = localStorage.getItem('ims_current_user');
    return stored ? JSON.parse(stored) : null;
  });

  const [categories, setCategories] = useState<Category[]>(() => {
    const storedVersion = localStorage.getItem('ims_data_version');
    const stored = localStorage.getItem('ims_categories');
    let parsed: Category[] = stored ? JSON.parse(stored) : [];

    if (storedVersion !== DATA_VERSION) {
      if (storedVersion === '2' || storedVersion === null) {
        parsed = parsed.map((cat) => ({
          ...cat,
          initialStock: Math.max(cat.initialStock, cat.currentQuantity),
        }));
      }
      localStorage.setItem('ims_data_version', DATA_VERSION);
      localStorage.setItem('ims_categories', JSON.stringify(parsed));
    }

    return parsed;
  });

  const [logs, setLogs] = useState<WithdrawalLog[]>(() => {
    const stored = localStorage.getItem('ims_logs');
    return stored ? JSON.parse(stored) : [];
  });

  // --- UI Layout Navigation State ---
  const [activeSection, setActiveSection] = useState<string>(() => {
    if (currentUser?.role === 'Admin') return 'overview';
    return 'withdraw';
  });

  // --- Live Toast Notifications ---
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Sync state to local storage on changes
  useEffect(() => {
    localStorage.setItem('ims_categories', JSON.stringify(categories));
  }, [categories]);

  useEffect(() => {
    localStorage.setItem('ims_logs', JSON.stringify(logs));
  }, [logs]);

  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('ims_current_user', JSON.stringify(currentUser));
      setActiveSection(currentUser.role === 'Admin' ? 'overview' : 'withdraw');
    } else {
      localStorage.removeItem('ims_current_user');
    }
  }, [currentUser]);

  // Helper to append a Toast warning
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = Date.now().toString() + Math.random().toString();
    setToasts((prev) => [...prev, { id, message, type }]);
    
    // Auto remove after 5 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Helper date formatter: e.g. "Jun 9, 2026 at 3:42 PM"
  const getFormattedTimestamp = () => {
    const now = new Date();
    const datePart = now.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
    const timePart = now.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    return `${datePart} at ${timePart}`;
  };

  // --- Auth Handlers ---
  const handleLogin = (user: User) => {
    setCurrentUser(user);
    showToast(`Access Authorized. Logged in as ${user.username}`, 'success');
  };

  const handleLogout = () => {
    setCurrentUser(null);
    showToast('Session terminated successfully.', 'info');
  };

  // --- Category Modification (Admin) ---
  const handleAddNewCategory = (name: string, unit: string, initialStock: number) => {
    const newCategory: Category = {
      id: name.toLowerCase().replace(/\s+/g, '-'),
      name,
      unit,
      initialStock,
      currentQuantity: initialStock,
    };

    setCategories((prev) => [...prev, newCategory]);
    showToast(`Category "${name}" provisioned with supply of ${initialStock} ${unit}.`, 'success');
  };

  const handleAddStock = (categoryId: string, quantity: number) => {
    setCategories((prev) =>
      prev.map((cat) => {
        if (cat.id === categoryId) {
          showToast(
            `Injected ${quantity} ${cat.unit} into "${cat.name}". Total stock is now ${cat.initialStock + quantity}.`,
            'success'
          );
          return {
            ...cat,
            initialStock: cat.initialStock + quantity,
            currentQuantity: cat.currentQuantity + quantity,
          };
        }
        return cat;
      })
    );
  };

  const handleUpdateCategory = (
    categoryId: string,
    updates: { name: string; unit: string; initialStock: number; currentQuantity: number }
  ) => {
    setCategories((prev) =>
      prev.map((cat) => (cat.id === categoryId ? { ...cat, ...updates } : cat))
    );
    setLogs((prev) =>
      prev.map((log) =>
        log.categoryId === categoryId ? { ...log, categoryName: updates.name } : log
      )
    );
    showToast(`Category "${updates.name}" updated successfully.`, 'success');
  };

  const handleDeleteCategory = (categoryId: string) => {
    const category = categories.find((c) => c.id === categoryId);
    if (!category) return;

    setCategories((prev) => prev.filter((cat) => cat.id !== categoryId));
    showToast(`Category "${category.name}" removed from inventory.`, 'info');
  };

  // --- Withdrawal Event Handler (Worker) ---
  const handleWithdraw = (categoryId: string, quantity: number): { success: boolean; message: string } => {
    const category = categories.find((c) => c.id === categoryId);

    if (!category) {
      return { success: false, message: 'Resource not found in storage index.' };
    }

    if (category.currentQuantity < quantity) {
      const errorMsg = `Declined: Quantity requested (${quantity} ${category.unit}) exceeds current inventory level (${category.currentQuantity} remaining).`;
      showToast(errorMsg, 'error');
      return { success: false, message: errorMsg };
    }

    // Process deduction
    setCategories((prev) =>
      prev.map((cat) => {
        if (cat.id === categoryId) {
          return {
            ...cat,
            currentQuantity: cat.currentQuantity - quantity,
          };
        }
        return cat;
      })
    );

    // Write audit log
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

    setLogs((prev) => [newLogEntry, ...prev]);
    showToast(`Allocated ${quantity} ${category.unit} of "${category.name}". Warehouse updated.`, 'success');

    return { 
      success: true, 
      message: `Transaction approved: Allocated ${quantity} ${category.unit} of "${category.name}".` 
    };
  };

  // --- Toggle Log Status (Admin - approve/reject log and revert appropriate stock) ---
  const handleToggleLogStatus = (logId: string) => {
    const log = logs.find((l) => l.id === logId);
    if (!log) return;

    if (log.status === 'Approved') {
      // Toggle to REJECTED. Under rules, restore the stock!
      setCategories((prev) =>
        prev.map((cat) => {
          if (cat.id === log.categoryId) {
            showToast(`Requisition rejected. Restored ${log.quantity} ${cat.unit} to "${cat.name}".`, 'info');
            return {
              ...cat,
              currentQuantity: cat.currentQuantity + log.quantity,
            };
          }
          return cat;
        })
      );

      setLogs((prev) =>
        prev.map((l) => (l.id === logId ? { ...l, status: 'Rejected' as const } : l))
      );
    } else {
      // Toggle to APPROVED. Deduct stock if possible.
      const category = categories.find((c) => c.id === log.categoryId);
      if (!category) {
        showToast('Restore failed: Connected category does not exist anymore.', 'error');
        return;
      }

      if (category.currentQuantity < log.quantity) {
        showToast(`Cannot re-approve: Insufficient stock in "${category.name}" (${category.currentQuantity} remaining).`, 'error');
        return;
      }

      setCategories((prev) =>
        prev.map((cat) => {
          if (cat.id === log.categoryId) {
            showToast(`Requisition re-approved. Deducted ${log.quantity} ${cat.unit} from "${cat.name}".`, 'success');
            return {
              ...cat,
              currentQuantity: cat.currentQuantity - log.quantity,
            };
          }
          return cat;
        })
      );

      setLogs((prev) =>
        prev.map((l) => (l.id === logId ? { ...l, status: 'Approved' as const } : l))
      );
    }
  };

  // If there's no active logged-in user, display the access portal
  if (!currentUser) {
    return (
      <>
        <Login onLogin={handleLogin} users={SEED_USERS} />
        {/* Render Toasts tray on absolute screen position */}
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
            <p className="text-white font-bold text-sm uppercase tracking-tight truncate">STK_MASTER</p>
            <p className="text-[10px] text-slate-400 truncate">{currentUser.username} · {currentUser.role}</p>
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

      {/* Toast Notification Tray */}
      <ToastTray toasts={toasts} onRemove={removeToast} />

    </div>
  );
}

// Helper Tray Component for absolute Overlay rendering
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
            className={`p-4 rounded-lg shadow-xl border text-xs flex items-start gap-3 relative ${
              toast.type === 'success'
                ? 'bg-[#DCFCE7] border-[#BBF7D0] text-[#166534]'
                : toast.type === 'error'
                ? 'bg-[#FEE2E2] border-[#FECACA] text-[#991B1B]'
                : 'bg-white border-slate-200 text-slate-700'
            }`}
          >
            {toast.type === 'success' && <CheckCircle className="h-4 w-4 text-[#166534] shrink-0 mt-0.5" />}
            {toast.type === 'error' && <AlertOctagon className="h-4 w-4 text-[#991B1B] shrink-0 mt-0.5" />}
            {toast.type === 'info' && <ShieldCheck className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />}

            <div className="flex-1 pr-6 leading-relaxed font-semibold">
              {toast.message}
            </div>

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
