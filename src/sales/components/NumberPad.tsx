/**
 * The shop's own number keypad for making a bill.
 *
 * The phone's keyboard covers half the screen, often hides the box being typed
 * in, and selecting a number pops up Cut / Copy / Paste / Select all. On the
 * bill, number boxes are buttons instead (`NumberBox`): tapping one opens this
 * keypad, which shows what is being changed in big letters right above the
 * keys. A computer keyboard works too while it is open.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Delete } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useBackDismiss } from '../../lib/backGuard';
import { useT } from '../i18n';
import { applyPadKey, groupDigits, isBlank, tidyValue, type PadKey } from '../numpad';

export interface PadField {
  id: string;
  label: string;
  value: string;
  /** Digits allowed after the point: 3 for quantity, 2 for rupees. */
  decimals: number;
  prefix?: string;
  suffix?: string;
  /** Shown faintly while the box is empty, e.g. the bill total for "received". */
  placeholder?: string;
  /** Left empty, the box gets back what it held when the keypad opened (quantity, rate). */
  required?: boolean;
  invalid?: boolean;
}

/** What the keypad is changing right now. */
export interface PadView {
  /** Who is being changed, e.g. "line:<key>". A new target starts with the value highlighted. */
  target: string;
  title: string;
  subtitle?: string;
  fields: PadField[];
  activeId: string;
  onActiveChange?: (id: string) => void;
  onChange: (id: string, value: string) => void;
  /** Beside the boxes, e.g. the % / ₹ switch for discount. */
  extra?: React.ReactNode;
  /** Under the boxes: what the change does (line amount, balance, ...). */
  summary?: React.ReactNode;
}

const NO_FIELDS: PadField[] = [];
const ignoreChange = () => {};

type KeyName = PadKey | 'done';
const KEYS: KeyName[] = ['1', '2', '3', 'back', '4', '5', '6', 'clear', '7', '8', '9', 'done', '.', '0', '00'];

const isTextField = (el: EventTarget | null) =>
  el instanceof HTMLTextAreaElement ||
  (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit'].includes(el.type));

/** A short tick on each key, like the phone's own keyboard. */
function buzz() {
  try {
    navigator.vibrate?.(8);
  } catch {
    // No vibration on this device.
  }
}

/** Big while it fits; smaller for long numbers or two boxes side by side. */
function sizeFor(length: number, twoUp: boolean): string {
  if (twoUp) return length <= 6 ? 'text-3xl' : length <= 9 ? 'text-2xl' : 'text-xl';
  return length <= 9 ? 'text-4xl' : 'text-3xl';
}

/** `view` null keeps the keypad closed. */
export function NumberPad({ view, onClose }: { view: PadView | null; onClose: () => void }) {
  const { t } = useT();
  const reduceMotion = useReducedMotion();
  const open = view !== null;
  const target = view?.target ?? null;
  const fields = view?.fields ?? NO_FIELDS;
  const activeId = view?.activeId ?? '';
  const onChange = view?.onChange ?? ignoreChange;
  const onActiveChange = view?.onActiveChange;
  const panelRef = useRef<HTMLDivElement>(null);
  // Highlighted value: the first digit types over it, like selected text.
  const [fresh, setFresh] = useState(true);
  // What each box held when the keypad opened, to put back into an emptied box.
  const startValues = useRef<Record<string, string>>({});

  // Key and click handlers are set up once per opening; they read the newest props here.
  const latest = useRef({ fields, activeId, fresh, onChange, onActiveChange, onClose });
  latest.current = { fields, activeId, fresh, onChange, onActiveChange, onClose };

  useEffect(() => {
    if (!open) return;
    startValues.current = Object.fromEntries(fields.map((f) => [f.id, f.value]));
    // Closes the phone keyboard if a search box had it open.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    // Only a new target resets this, not each typed digit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  useEffect(() => setFresh(true), [target, activeId]);

  const setFreshNow = (value: boolean) => {
    latest.current.fresh = value;
    setFresh(value);
  };

  /** Sends a new value, and remembers it at once so a key pressed before the next render builds on it. */
  const change = (id: string, value: string) => {
    latest.current.fields = latest.current.fields.map((f) => (f.id === id ? { ...f, value } : f));
    latest.current.onChange(id, value);
  };

  /** Tidies a box being left; an emptied quantity or rate gets its old value back. */
  const leave = (id: string) => {
    const field = latest.current.fields.find((f) => f.id === id);
    if (!field) return;
    let next = tidyValue(field.value);
    if (field.required && isBlank(next)) next = startValues.current[id] ?? next;
    if (next !== field.value) change(id, next);
  };

  const close = () => {
    latest.current.fields.forEach((f) => leave(f.id));
    latest.current.onClose();
  };

  const switchTo = (id: string) => {
    if (id === latest.current.activeId) {
      // Tapping the box again highlights it again, ready to type over.
      setFreshNow(true);
      return;
    }
    leave(latest.current.activeId);
    latest.current.activeId = id;
    setFreshNow(true);
    latest.current.onActiveChange?.(id);
  };

  const press = (key: PadKey) => {
    const { fields: current, activeId: id, fresh: replace } = latest.current;
    const field = current.find((f) => f.id === id);
    if (!field) return;
    const next = applyPadKey(field.value, key, field.decimals, replace);
    setFreshNow(false);
    if (next !== field.value) change(field.id, next);
  };

  const cycle = (step: number) => {
    const { fields: current, activeId: id } = latest.current;
    if (current.length < 2) return;
    const index = current.findIndex((f) => f.id === id);
    switchTo(current[(index + step + current.length) % current.length].id);
  };

  // Device / browser Back closes the keypad first, before any sheet under it.
  useBackDismiss(open, close);

  // A computer keyboard types into the keypad too.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTextField(e.target)) return;
      const k = e.key;
      if (/^\d$/.test(k)) press(k as PadKey);
      else if (k === '.' || k === ',' || k === 'Decimal') press('.');
      else if (k === 'Backspace') press('back');
      else if (k === 'Delete') press('clear');
      else if (k === 'Enter' || k === 'Escape') close();
      else if (k === 'Tab' || k === 'ArrowRight' || k === 'ArrowLeft') cycle(k === 'ArrowLeft' || e.shiftKey ? -1 : 1);
      else return;
      // Handled here: the sheet underneath must not also close on Escape.
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Tapping elsewhere (not another number box) or into a text box closes the keypad.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      if (!el || panelRef.current?.contains(el) || el.closest('[data-numpad-box]')) return;
      close();
    };
    const onFocusIn = (e: FocusEvent) => {
      if (isTextField(e.target)) close();
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('focusin', onFocusIn);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Pages leave this much room at the bottom (NumberPadSpacer) so a box can scroll above the keypad.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty('--numpad-h', `${panel.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(panel);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--numpad-h');
    };
  }, [open]);

  if (typeof document === 'undefined') return null;
  const twoUp = fields.length > 1 || Boolean(view?.extra);
  const activeField = fields.find((f) => f.id === activeId);

  const keyLabel = (key: KeyName): React.ReactNode => {
    if (key === 'back') return <Delete className="h-7 w-7" />;
    if (key === 'clear') return <span className="text-base">{t('padClear')}</span>;
    if (key === 'done')
      return (
        <span className="flex flex-col items-center gap-1 text-lg">
          <Check className="h-7 w-7" strokeWidth={3} />
          {t('done')}
        </span>
      );
    return key;
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="numpad"
          ref={panelRef}
          role="dialog"
          aria-label={view.title}
          data-testid="numpad"
          initial={reduceMotion ? { opacity: 0 } : { y: '100%' }}
          animate={reduceMotion ? { opacity: 1 } : { y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { y: '100%' }}
          transition={reduceMotion ? { duration: 0.12 } : { type: 'spring', stiffness: 500, damping: 40 }}
          onContextMenu={(e) => e.preventDefault()}
          className="fixed inset-x-0 bottom-0 z-[60] mx-auto w-full sm:max-w-md bg-white rounded-t-3xl border-t border-slate-200 shadow-[0_-12px_32px_-8px_rgba(15,23,42,0.35)] select-none [-webkit-touch-callout:none]"
        >
          {/* What is being changed */}
          <div className="px-4 pt-3">
            <p className="text-lg font-bold text-slate-900 leading-tight truncate">{view.title}</p>
            {view.subtitle && <p className="text-sm text-slate-500 truncate">{view.subtitle}</p>}
          </div>

          {/* The boxes, big. Tap one to type in it. */}
          <div className="flex items-stretch gap-2 px-4 pt-2">
            {fields.map((field) => {
              const active = field.id === activeId;
              const shown = groupDigits(field.value);
              const highlighted = active && fresh && shown !== '';
              return (
                <button
                  key={field.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => switchTo(field.id)}
                  data-testid={`numpad-field-${field.id}`}
                  className={`min-w-0 flex-1 rounded-2xl border-2 px-3 py-2 text-left cursor-pointer transition-colors ${
                    active
                      ? 'border-amber-500 bg-amber-50'
                      : field.invalid
                        ? 'border-red-300 bg-red-50'
                        : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <span className="block text-xs font-bold uppercase tracking-wide text-slate-500">{field.label}</span>
                  <span
                    className={`flex items-center gap-1 h-11 font-extrabold tabular-nums text-slate-900 ${sizeFor(
                      shown.length + (field.prefix?.length ?? 0),
                      twoUp
                    )}`}
                  >
                    {field.prefix && <span className="text-[0.6em] font-bold text-slate-400">{field.prefix}</span>}
                    {shown && (
                      <span className={`truncate ${highlighted ? 'rounded-md bg-amber-300/70 px-1 -mx-0.5' : ''}`}>{shown}</span>
                    )}
                    {active && !highlighted && (
                      <span className="h-[0.9em] w-[3px] shrink-0 rounded-full bg-amber-500 animate-pulse" aria-hidden="true" />
                    )}
                    {!shown && (
                      <span className="truncate text-slate-300">{field.placeholder ? groupDigits(field.placeholder) : '0'}</span>
                    )}
                    {field.suffix && (
                      <span className="ml-0.5 shrink-0 text-[0.45em] font-bold text-slate-500">{field.suffix}</span>
                    )}
                  </span>
                </button>
              );
            })}
            {view.extra}
          </div>

          {view.summary && <div className="px-4 pt-2">{view.summary}</div>}

          {/* Keys: the phone's number layout, 1 2 3 on top */}
          <div className="mt-3 grid grid-cols-4 gap-2 bg-slate-100 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] touch-manipulation">
            {KEYS.map((key) => {
              const isDone = key === 'done';
              const isEdit = key === 'back' || key === 'clear';
              return (
                <button
                  key={key}
                  type="button"
                  disabled={key === '.' && activeField?.decimals === 0}
                  aria-label={key === 'back' ? t('padBackspace') : key === 'clear' ? t('padClear') : isDone ? t('done') : undefined}
                  data-testid={`numpad-key-${key}`}
                  onClick={() => {
                    buzz();
                    if (isDone) close();
                    else press(key);
                  }}
                  className={`flex items-center justify-center rounded-xl font-bold cursor-pointer transition-colors shadow-[0_1px_0_0_rgb(203,213,225)] disabled:opacity-40 ${
                    isDone
                      ? 'row-span-2 bg-emerald-600 text-white active:bg-emerald-700'
                      : isEdit
                        ? 'h-14 bg-slate-200 text-slate-700 active:bg-slate-300'
                        : 'h-14 bg-white text-2xl text-slate-900 active:bg-slate-200'
                  }`}
                >
                  {keyLabel(key)}
                </button>
              );
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

/** One or two figures under the keypad's boxes, e.g. "Amount ₹600" and "Total ₹2,340". */
export function PadSummary({
  items,
}: {
  items: { label: string; value: string; tone?: 'strong' | 'red' | 'green' | 'muted' }[];
}) {
  const tones = {
    strong: 'text-slate-900 text-lg',
    red: 'text-red-700 text-lg',
    green: 'text-[#166534] text-lg',
    muted: 'text-slate-500 text-sm',
  };
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-xl bg-slate-50 px-3 py-1.5">
      {items.map((item) => (
        <p key={item.label} className="min-w-0 flex items-baseline gap-1.5 last:text-right">
          <span className="text-sm font-semibold text-slate-500 truncate">{item.label}</span>
          <span className={`font-extrabold tabular-nums ${tones[item.tone ?? 'strong']}`}>{item.value}</span>
        </p>
      ))}
    </div>
  );
}

/** In place of the summary when the typed number cannot be used, e.g. received more than the bill. */
export function PadWarning({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-xl bg-red-50 border border-red-200 px-3 py-1.5 text-sm font-semibold text-red-700 leading-snug">
      {message}
    </p>
  );
}

interface NumberBoxProps {
  value: string;
  /** Read out by screen readers, e.g. "Qty". */
  label: string;
  prefix?: string;
  placeholder?: string;
  /** The keypad is open for this box. */
  active: boolean;
  invalid?: boolean;
  /** Amber, e.g. a rate that differs from the saved one. */
  changed?: boolean;
  center?: boolean;
  /** No border or colour of its own: it sits inside a styled field. */
  bare?: boolean;
  onOpen: () => void;
  className?: string;
  'data-testid'?: string;
}

/**
 * Looks like a number input, but tapping it opens the shop's keypad instead of
 * the phone keyboard, so nothing gets selected and no Cut / Copy menu appears.
 */
export function NumberBox({
  value,
  label,
  prefix,
  placeholder,
  active,
  invalid = false,
  changed = false,
  center = false,
  bare = false,
  onOpen,
  className = '',
  'data-testid': testId,
}: NumberBoxProps) {
  const ref = useRef<HTMLButtonElement>(null);

  // Keep the box in sight above the keypad.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);

  const tone = bare
    ? ''
    : active
      ? 'border border-amber-500 bg-amber-50 ring-2 ring-amber-300'
      : invalid
        ? 'border border-red-300 bg-red-50'
        : changed
          ? 'border border-amber-400 bg-amber-50'
          : 'border border-slate-200 bg-white';

  return (
    <button
      ref={ref}
      type="button"
      data-numpad-box
      data-testid={testId}
      aria-label={label}
      aria-expanded={active}
      onClick={onOpen}
      style={{ scrollMarginTop: 12, scrollMarginBottom: 'calc(var(--numpad-h, 0px) + 12px)' }}
      className={`flex items-center gap-0.5 rounded-lg px-2 font-bold text-slate-900 tabular-nums cursor-pointer transition-colors select-none touch-manipulation ${tone} ${className}`}
    >
      {prefix && <span className="text-xs font-semibold text-slate-400">{prefix}</span>}
      <span className={`min-w-0 flex-1 truncate ${center ? 'text-center' : 'text-left'}`}>
        {value || <span className="font-semibold text-slate-400">{placeholder}</span>}
      </span>
    </button>
  );
}

/** Room at the end of a scrolling page, so its last boxes can scroll above the keypad. */
export function NumberPadSpacer() {
  return <div aria-hidden="true" className="shrink-0" style={{ height: 'var(--numpad-h, 0px)' }} />;
}
