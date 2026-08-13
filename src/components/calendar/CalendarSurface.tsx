import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { useBackDismiss } from '../../lib/backGuard';

/** Phones get a bottom sheet, everything else gets an anchored popover. */
export function useIsCompact() {
  const [isCompact, setIsCompact] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 640
  );

  useEffect(() => {
    const query = window.matchMedia('(max-width: 639px)');
    const sync = () => setIsCompact(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return isCompact;
}

type PopoverLayout = { left: number; width: number; top?: number; bottom?: number };

interface CalendarSurfaceProps {
  open: boolean;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLElement | null>;
  title: string;
  subtitle?: string;
  desktopWidth: number;
  children: React.ReactNode;
}

export function CalendarSurface({
  open,
  onClose,
  triggerRef,
  title,
  subtitle,
  desktopWidth,
  children,
}: CalendarSurfaceProps) {
  const isCompact = useIsCompact();
  const [layout, setLayout] = useState<PopoverLayout | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Device / browser Back closes the calendar instead of leaving the app.
  useBackDismiss(open, onClose);

  const updateLayout = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const gap = 8;
    const margin = 12;
    const width = Math.min(desktopWidth, window.innerWidth - margin * 2);
    const left = Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin);
    const spaceBelow = window.innerHeight - rect.bottom;
    const openBelow = spaceBelow >= 440 || spaceBelow >= rect.top;

    setLayout({
      left,
      width,
      ...(openBelow ? { top: rect.bottom + gap } : { bottom: window.innerHeight - rect.top + gap }),
    });
  }, [desktopWidth, triggerRef]);

  useEffect(() => {
    if (!open || isCompact) return;

    updateLayout();
    window.addEventListener('resize', updateLayout);
    window.addEventListener('scroll', updateLayout, true);

    return () => {
      window.removeEventListener('resize', updateLayout);
      window.removeEventListener('scroll', updateLayout, true);
    };
  }, [open, isCompact, updateLayout]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose, triggerRef]);

  useEffect(() => {
    if (!open || !isCompact) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open, isCompact]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open &&
        (isCompact ? (
          <div className="fixed inset-0 z-[10050] flex items-end justify-center">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            />
            <motion.div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 32, stiffness: 340 }}
              className="relative z-10 max-h-[92vh] w-full overflow-y-auto overscroll-contain rounded-t-3xl border-t border-slate-200 bg-white px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl shadow-slate-900/25"
            >
              <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200" />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-base font-bold text-slate-900">{title}</p>
                  {subtitle && <p className="text-xs font-medium text-slate-400">{subtitle}</p>}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close calendar"
                  className="-mr-1 -mt-1 rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              {children}
            </motion.div>
          </div>
        ) : (
          layout && (
            <motion.div
              ref={panelRef}
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              style={{
                position: 'fixed',
                left: layout.left,
                width: layout.width,
                top: layout.top,
                bottom: layout.bottom,
                zIndex: 10050,
              }}
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/15"
            >
              {children}
            </motion.div>
          )
        ))}
    </AnimatePresence>,
    document.body
  );
}
