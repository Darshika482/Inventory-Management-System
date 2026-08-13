import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check, Search, Package, User as UserIcon, Building2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { PremiumSelectOption } from '../lib/selectOptions';
import { useBackDismiss } from '../lib/backGuard';

export type { PremiumSelectOption };

type Accent = 'emerald' | 'amber' | 'slate';

interface PremiumSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: PremiumSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  searchable?: boolean;
  accent?: Accent;
  required?: boolean;
  name?: string;
  searchPlaceholder?: string;
}

type MenuLayout = {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
};

const accentStyles: Record<
  Accent,
  { ring: string; border: string; selected: string; check: string; searchFocus: string }
> = {
  emerald: {
    ring: 'ring-emerald-500/20',
    border: 'border-emerald-500',
    selected: 'bg-emerald-50 text-emerald-900',
    check: 'text-emerald-600',
    searchFocus: 'focus:border-emerald-500',
  },
  amber: {
    ring: 'ring-amber-500/20',
    border: 'border-amber-500',
    selected: 'bg-amber-50 text-amber-900',
    check: 'text-amber-600',
    searchFocus: 'focus:border-amber-500',
  },
  slate: {
    ring: 'ring-slate-900/10',
    border: 'border-[#0F172A]',
    selected: 'bg-slate-100 text-slate-900',
    check: 'text-slate-800',
    searchFocus: 'focus:border-[#0F172A]',
  },
};

export function PremiumSelect({
  label,
  value,
  onChange,
  options,
  placeholder = 'Choose an option...',
  disabled = false,
  searchable = false,
  accent = 'slate',
  required = false,
  name,
  searchPlaceholder = 'Search...',
}: PremiumSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [menuLayout, setMenuLayout] = useState<MenuLayout | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const styles = accentStyles[accent];

  // Device / browser Back closes the dropdown instead of leaving the app.
  useBackDismiss(open, () => {
    setOpen(false);
    setQuery('');
  });

  const selected = options.find((option) => option.value === value);

  const filteredOptions = useMemo(() => {
    if (!searchable || !query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(q) ||
        option.description?.toLowerCase().includes(q) ||
        option.hint?.toLowerCase().includes(q)
    );
  }, [options, query, searchable]);

  const updateMenuLayout = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const gap = 8;
    const padding = 12;
    const spaceBelow = window.innerHeight - rect.bottom - padding;
    const spaceAbove = rect.top - padding;
    const openBelow = spaceBelow >= 180 || spaceBelow >= spaceAbove;
    const maxHeight = Math.min(360, Math.max(160, openBelow ? spaceBelow - gap : spaceAbove - gap));

    setMenuLayout({
      left: rect.left,
      width: rect.width,
      maxHeight,
      ...(openBelow
        ? { top: rect.bottom + gap }
        : { bottom: window.innerHeight - rect.top + gap }),
    });
  }, []);

  useEffect(() => {
    if (!open) return;

    updateMenuLayout();
    window.addEventListener('resize', updateMenuLayout);
    window.addEventListener('scroll', updateMenuLayout, true);

    return () => {
      window.removeEventListener('resize', updateMenuLayout);
      window.removeEventListener('scroll', updateMenuLayout, true);
    };
  }, [open, updateMenuLayout]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
      setQuery('');
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
    setQuery('');
  };

  const renderIcon = (icon?: PremiumSelectOption['icon']) => {
    if (icon === 'user') {
      return (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
          <UserIcon className="h-4 w-4" />
        </span>
      );
    }
    if (icon === 'item') {
      return (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 border border-amber-100">
          <Package className="h-4 w-4" />
        </span>
      );
    }
    if (icon === 'floor') {
      return (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100">
          <Building2 className="h-4 w-4" />
        </span>
      );
    }
    return null;
  };

  const dropdownMenu =
    open &&
    menuLayout &&
    createPortal(
      <AnimatePresence>
        <motion.div
          ref={menuRef}
          initial={{ opacity: 0, y: menuLayout.top !== undefined ? -4 : 4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: menuLayout.top !== undefined ? -4 : 4, scale: 0.98 }}
          transition={{ duration: 0.15 }}
          style={{
            position: 'fixed',
            left: menuLayout.left,
            width: menuLayout.width,
            top: menuLayout.top,
            bottom: menuLayout.bottom,
            maxHeight: menuLayout.maxHeight,
            zIndex: 10050,
          }}
          className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/15 flex flex-col"
        >
          {searchable && (
            <div className="p-2.5 border-b border-slate-100 bg-slate-50/80 shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={searchPlaceholder}
                  className={`w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none ${styles.searchFocus}`}
                  autoFocus
                />
              </div>
            </div>
          )}

          <ul className="overflow-y-auto overscroll-contain py-1.5 min-h-0 flex-1">
            {filteredOptions.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-slate-500">No matches found</li>
            ) : (
              filteredOptions.map((option) => {
                const isSelected = option.value === value;
                return (
                  <li key={option.value}>
                    <button
                      type="button"
                      onClick={() => handleSelect(option.value)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors cursor-pointer ${
                        isSelected ? styles.selected : 'hover:bg-slate-50 text-slate-900'
                      }`}
                    >
                      {renderIcon(option.icon)}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate">{option.label}</p>
                        {(option.description || option.hint) && (
                          <p className="text-xs text-slate-500 truncate mt-0.5">
                            {[option.description, option.hint].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </div>
                      {isSelected && <Check className={`h-4 w-4 shrink-0 ${styles.check}`} />}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </motion.div>
      </AnimatePresence>,
      document.body
    );

  return (
    <div ref={rootRef} className="space-y-1.5">
      <label className="block text-sm font-semibold text-slate-600">{label}</label>

      {required && name && (
        <input type="hidden" name={name} value={value} required={required} readOnly />
      )}

      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            if (!open) updateMenuLayout();
            setOpen((prev) => !prev);
          }
        }}
        className={`w-full flex items-center gap-3 rounded-xl border bg-white px-3.5 py-3 text-left transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
          open
            ? `${styles.border} ring-4 ${styles.ring} shadow-sm`
            : 'border-slate-200 hover:border-slate-300 shadow-xs'
        }`}
      >
        {selected ? (
          <>
            {renderIcon(selected.icon)}
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-slate-900 truncate">{selected.label}</p>
              {(selected.description || selected.hint) && (
                <p className="text-sm text-slate-500 truncate mt-0.5">
                  {[selected.description, selected.hint].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="min-w-0 flex-1">
            <p className="text-base text-slate-400">{placeholder}</p>
          </div>
        )}
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-slate-400 transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {dropdownMenu}
    </div>
  );
}
