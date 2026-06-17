import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

type ModalAccent = 'amber' | 'emerald' | 'red' | 'slate';

interface AppModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  icon: React.ReactNode;
  accent?: ModalAccent;
  children: React.ReactNode;
}

const accentMap: Record<
  ModalAccent,
  { bar: string; iconWrap: string }
> = {
  amber: {
    bar: 'bg-amber-500',
    iconWrap: 'bg-amber-50 text-amber-600 border-amber-100',
  },
  emerald: {
    bar: 'bg-emerald-500',
    iconWrap: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  },
  red: {
    bar: 'bg-red-500',
    iconWrap: 'bg-red-50 text-red-600 border-red-100',
  },
  slate: {
    bar: 'bg-[#0F172A]',
    iconWrap: 'bg-slate-50 text-slate-700 border-slate-200',
  },
};

export function AppModal({
  open,
  onClose,
  title,
  description,
  icon,
  accent = 'amber',
  children,
}: AppModalProps) {
  const styles = accentMap[accent];

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
          <motion.button
            type="button"
            aria-label="Close dialog"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm cursor-default"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-modal-title"
            initial={{ opacity: 0, y: 32, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 32, scale: 0.98 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="relative z-10 w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl shadow-slate-900/20 border border-slate-200/80 max-h-[min(92vh,760px)] flex flex-col"
          >
            <div className={`h-1.5 shrink-0 rounded-t-3xl sm:rounded-t-2xl ${styles.bar}`} />

            <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 sm:px-6 sm:pt-6 border-b border-slate-100 shrink-0">
              <div className="flex items-start gap-3 min-w-0">
                <span
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${styles.iconWrap}`}
                >
                  {icon}
                </span>
                <div className="min-w-0 pt-0.5">
                  <h2 id="app-modal-title" className="text-xl font-bold text-slate-900 leading-tight">
                    {title}
                  </h2>
                  {description && (
                    <p className="text-sm text-slate-500 mt-1 leading-relaxed">{description}</p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-2 -mr-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer shrink-0"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6 sm:py-6">
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
