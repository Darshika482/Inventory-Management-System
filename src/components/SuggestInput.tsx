import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

/**
 * A text input with a styled suggestion menu. Unlike a <select>, anything can
 * be typed; unlike a native <datalist>, the menu matches the app's design.
 */
interface SuggestInputProps {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  /** Styles the wrapper, e.g. `flex-1 min-w-0` inside a row. */
  containerClassName?: string;
}

type MenuLayout = {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
};

export function SuggestInput({
  value,
  onChange,
  suggestions,
  placeholder,
  disabled = false,
  required = false,
  containerClassName = '',
}: SuggestInputProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [layout, setLayout] = useState<MenuLayout | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return suggestions;
    // Names starting with the typed text first, then names containing it.
    const starts: string[] = [];
    const contains: string[] = [];
    for (const s of suggestions) {
      const lower = s.toLowerCase();
      if (lower.startsWith(q)) starts.push(s);
      else if (lower.includes(q)) contains.push(s);
    }
    return [...starts, ...contains];
  }, [suggestions, value]);

  const updateLayout = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;

    const rect = input.getBoundingClientRect();
    const gap = 6;
    const padding = 12;
    const spaceBelow = window.innerHeight - rect.bottom - padding;
    const spaceAbove = rect.top - padding;
    const openBelow = spaceBelow >= 160 || spaceBelow >= spaceAbove;
    const maxHeight = Math.min(280, Math.max(140, openBelow ? spaceBelow - gap : spaceAbove - gap));

    setLayout({
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

    updateLayout();
    window.addEventListener('resize', updateLayout);
    window.addEventListener('scroll', updateLayout, true);

    return () => {
      window.removeEventListener('resize', updateLayout);
      window.removeEventListener('scroll', updateLayout, true);
    };
  }, [open, updateLayout]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, []);

  const openMenu = () => {
    if (disabled || suggestions.length === 0) return;
    updateLayout();
    setActiveIndex(-1);
    setOpen(true);
  };

  const handleSelect = (next: string) => {
    onChange(next);
    setOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || filtered.length === 0) {
      if (e.key === 'ArrowDown') openMenu();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev <= 0 ? filtered.length - 1 : prev - 1));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      handleSelect(filtered[activeIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const menu =
    open &&
    layout &&
    filtered.length > 0 &&
    createPortal(
      <AnimatePresence>
        <motion.div
          ref={menuRef}
          initial={{ opacity: 0, y: layout.top !== undefined ? -4 : 4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: layout.top !== undefined ? -4 : 4, scale: 0.98 }}
          transition={{ duration: 0.12 }}
          style={{
            position: 'fixed',
            left: layout.left,
            width: layout.width,
            top: layout.top,
            bottom: layout.bottom,
            maxHeight: layout.maxHeight,
            zIndex: 10050,
          }}
          className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/15 flex flex-col"
        >
          <ul className="overflow-y-auto overscroll-contain py-1.5 min-h-0 flex-1">
            {filtered.map((option, index) => {
              const isSelected = option === value;
              const isActive = index === activeIndex;
              return (
                <li key={option}>
                  <button
                    type="button"
                    // mousedown fires before the input's blur, so the click lands
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelect(option);
                    }}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-amber-50 text-amber-900'
                        : isActive
                          ? 'bg-slate-50 text-slate-900'
                          : 'text-slate-900'
                    }`}
                  >
                    <span className="text-sm font-semibold truncate flex-1 min-w-0">{option}</span>
                    {isSelected && <Check className="h-4 w-4 shrink-0 text-amber-600" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </motion.div>
      </AnimatePresence>,
      document.body
    );

  return (
    <div ref={rootRef} className={`relative ${containerClassName}`}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          if (!open) openMenu();
          else setActiveIndex(-1);
        }}
        onFocus={openMenu}
        onKeyDown={handleKeyDown}
        className="w-full bg-white border border-slate-200 rounded-lg pl-3 pr-9 py-2.5 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 transition-all"
      />
      {suggestions.length > 0 && (
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onMouseDown={(e) => {
            e.preventDefault();
            if (open) setOpen(false);
            else {
              inputRef.current?.focus();
              openMenu();
            }
          }}
          aria-label="Show suggestions"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600 cursor-pointer"
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </button>
      )}
      {menu}
    </div>
  );
}
