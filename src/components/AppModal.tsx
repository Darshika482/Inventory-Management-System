import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion, type Transition } from 'motion/react';
import { useBackDismiss } from '../lib/backGuard';

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

// Matches the `sm` breakpoint, below which the modal is a bottom sheet.
const SHEET_QUERY = '(max-width: 639px)';

const sheetIn: Transition = { type: 'spring', stiffness: 400, damping: 36, mass: 0.9 };
const dialogIn: Transition = { type: 'spring', stiffness: 460, damping: 34, mass: 0.8 };
const sheetOut: Transition = { duration: 0.22, ease: [0.4, 0, 1, 1] };
const dialogOut: Transition = { duration: 0.16, ease: [0.4, 0, 1, 1] };

// Counted, because one modal can be opened from another (e.g. detail -> edit)
// and the first one closing must not unlock the page behind the second.
let openModalCount = 0;
let overflowBeforeLock = '';

function lockPageScroll() {
  openModalCount += 1;
  if (openModalCount === 1) {
    overflowBeforeLock = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  return () => {
    openModalCount = Math.max(0, openModalCount - 1);
    if (openModalCount === 0) document.body.style.overflow = overflowBeforeLock;
  };
}

function useIsSheet() {
  const [isSheet, setIsSheet] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(SHEET_QUERY).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(SHEET_QUERY);
    const onChange = (event: MediaQueryListEvent) => setIsSheet(event.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isSheet;
}

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
  const isSheet = useIsSheet();
  const reduceMotion = useReducedMotion();

  // Device / browser Back closes the modal instead of leaving the app.
  useBackDismiss(open, onClose);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);

    // Locking the page keeps the sheet from fighting background scroll on touch.
    const unlock = lockPageScroll();

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      unlock();
    };
  }, [open, onClose]);

  const panelMotion = reduceMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1, transition: { duration: 0.15 } },
        exit: { opacity: 0, transition: { duration: 0.12 } },
      }
    : isSheet
    ? {
        initial: { y: '100%' },
        animate: { y: 0, transition: sheetIn },
        exit: { y: '100%', transition: sheetOut },
      }
    : {
        initial: { opacity: 0, y: 12, scale: 0.96 },
        animate: { opacity: 1, y: 0, scale: 1, transition: dialogIn },
        exit: { opacity: 0, y: 8, scale: 0.98, transition: dialogOut },
      };

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
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm cursor-default"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-modal-title"
            initial={panelMotion.initial}
            animate={panelMotion.animate}
            exit={panelMotion.exit}
            style={{ willChange: 'transform, opacity' }}
            className="relative z-10 w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl overflow-hidden shadow-2xl shadow-slate-900/20 border border-slate-200/80 max-h-[92dvh] sm:max-h-[min(92vh,760px)] flex flex-col"
          >
            <div className={`h-1.5 shrink-0 rounded-t-3xl sm:rounded-t-2xl ${styles.bar}`} />

            <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-4 sm:px-6 sm:pt-6 border-b border-slate-100 shrink-0">
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

            <div className="min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-6">
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
