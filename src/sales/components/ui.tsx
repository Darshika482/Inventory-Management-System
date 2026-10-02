/**
 * Small building blocks for the shop sales screens, in the app's existing
 * look (navy #0F172A, amber accent, rounded-xl cards). Everything tappable is
 * at least 48px tall and carries an icon plus a label.
 */
import React, { useMemo, useState } from 'react';
import { AlertOctagon, Check, ChevronDown, Languages, Loader2, Search, Trash2, X } from 'lucide-react';
import { AppModal } from '../../components/AppModal';
import type { FriendlyError } from '../../lib/dbErrors';
import { setLanguage, useT } from '../i18n';

// --- Page frame ---

/**
 * `fill`: the page is a column that always reaches the bottom of the screen and
 * has no bottom padding, so a last `mt-auto` bar (New Sale's Save bar) sits on
 * the bottom edge instead of floating above empty space.
 */
export function PageShell({ children, fill = false }: { children: React.ReactNode; fill?: boolean }) {
  return (
    <div
      className={`@container flex-1 overflow-y-auto bg-[#F8FAFC] space-y-4 sm:space-y-5 font-sans text-slate-900 selection:bg-amber-500 selection:text-white ${
        fill
          ? 'flex flex-col px-3 pt-3 sm:px-6 sm:pt-6 md:px-8 md:pt-8'
          : 'p-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:p-6 md:p-8'
      }`}
    >
      {children}
    </div>
  );
}

interface PageHeaderProps {
  title: string;
  icon: React.ReactNode;
  /** Buttons shown on the right, after the language switch. */
  actions?: React.ReactNode;
  /** Leave out the Hindi/English switch (e.g. on the busy New Sale screen). */
  hideLanguage?: boolean;
}

export function PageHeader({ title, icon, actions, hideLanguage = false }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 @md:gap-2 @xl:gap-3">
      <div className="flex items-center gap-2 min-w-0 mr-auto">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border bg-amber-50 text-amber-600 border-amber-100">
          {icon}
        </span>
        <h1 className="text-xl @xl:text-2xl font-bold tracking-tight text-slate-900 truncate">{title}</h1>
      </div>
      {!hideLanguage && <LanguageToggle />}
      {actions}
    </div>
  );
}

export function LanguageToggle() {
  const { language, t } = useT();
  return (
    <button
      type="button"
      onClick={() => setLanguage(language === 'hi' ? 'en' : 'hi')}
      className="min-h-12 flex items-center gap-1.5 px-3 @md:px-3.5 bg-white border border-slate-200 hover:border-amber-300 text-slate-700 rounded-xl text-sm font-bold cursor-pointer transition-colors shrink-0"
      aria-label={t('switchLanguage')}
    >
      <Languages className="h-5 w-5 text-amber-600" />
      <span className="@md:hidden">{language === 'hi' ? 'EN' : 'हिं'}</span>
      <span className="hidden @md:inline">{t('switchLanguage')}</span>
    </button>
  );
}

export function LoadingState() {
  const { t } = useT();
  return (
    <div className="flex-1 flex items-center justify-center bg-[#F8FAFC] p-6">
      <div className="flex flex-col items-center gap-3 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-amber-600" />
        <p className="text-base font-medium">{t('loading')}</p>
      </div>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: FriendlyError; onRetry: () => void }) {
  const { t } = useT();
  return (
    <div className="flex-1 flex items-center justify-center bg-[#F8FAFC] p-6">
      <div className="max-w-md w-full bg-white border border-red-200 rounded-xl p-6 shadow-lg text-center space-y-4">
        <AlertOctagon className="h-10 w-10 text-red-500 mx-auto" />
        <h2 className="text-xl font-bold text-slate-900">{t('loadFailed')}</h2>
        <p className="text-sm text-slate-600 leading-relaxed">{error.message}</p>
        {error.detail && <p className="text-xs text-slate-400 leading-relaxed break-words">{error.detail}</p>}
        <button
          type="button"
          onClick={onRetry}
          className="min-h-12 px-5 bg-[#0F172A] text-white rounded-xl text-base font-semibold cursor-pointer"
        >
          {t('tryAgain')}
        </button>
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="p-8 @xl:p-12 text-center bg-white border border-slate-200 rounded-xl">
      <div className="mx-auto mb-3 flex justify-center text-slate-300">{icon}</div>
      <p className="text-base font-bold text-slate-700">{title}</p>
      {hint && <p className="text-sm text-slate-500 mt-1 leading-relaxed max-w-md mx-auto">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

// --- Buttons ---

type ButtonTone = 'primary' | 'success' | 'secondary' | 'danger' | 'amber';

const buttonTones: Record<ButtonTone, string> = {
  primary: 'bg-[#0F172A] hover:bg-slate-800 text-white',
  success: 'bg-emerald-600 hover:bg-emerald-700 text-white',
  secondary: 'bg-white hover:bg-slate-50 text-slate-800 border border-slate-200',
  danger: 'bg-red-600 hover:bg-red-700 text-white',
  amber: 'bg-amber-500 hover:bg-amber-400 text-[#0F172A]',
};

interface ActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  label: string;
  tone?: ButtonTone;
  size?: 'md' | 'lg';
  busy?: boolean;
}

export function ActionButton({
  icon,
  label,
  tone = 'primary',
  size = 'md',
  busy = false,
  className = '',
  disabled,
  type = 'button',
  ...props
}: ActionButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      className={`flex items-center justify-center gap-2 rounded-xl font-bold cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
        size === 'lg' ? 'min-h-14 px-5 text-lg' : 'min-h-12 px-4 text-base'
      } ${buttonTones[tone]} ${className}`}
      {...props}
    >
      {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

// --- Choices ---

interface SegmentedProps<T extends string | number> {
  label?: string;
  value: T;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  onChange: (value: T) => void;
  columns?: number;
}

/** A row of big buttons where exactly one is chosen. */
export function Segmented<T extends string | number>({ label, value, options, onChange, columns }: SegmentedProps<T>) {
  return (
    <div className="space-y-1.5">
      {label && <p className="block text-sm font-semibold text-slate-700">{label}</p>}
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0, 1fr))` }}
        role="radiogroup"
        aria-label={label}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={String(option.value)}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.value)}
              className={`min-h-12 px-2 flex items-center justify-center gap-1.5 rounded-xl border text-sm font-bold cursor-pointer transition-colors ${
                selected
                  ? 'bg-[#0F172A] border-[#0F172A] text-white shadow-sm'
                  : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
              }`}
            >
              {option.icon}
              <span className="truncate">{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface ToggleRowProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** A whole-row switch: tapping anywhere on the row flips it. */
export function ToggleRow({ label, hint, checked, onChange }: ToggleRowProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="w-full min-h-12 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left cursor-pointer hover:border-slate-300 transition-colors"
    >
      <span className="min-w-0">
        <span className="block text-base font-semibold text-slate-900">{label}</span>
        {hint && <span className="block text-sm text-slate-500 mt-0.5 leading-snug">{hint}</span>}
      </span>
      <span
        className={`relative inline-flex h-8 w-14 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-emerald-600' : 'bg-slate-300'
        }`}
      >
        <span
          className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-7' : 'translate-x-1'
          }`}
        />
      </span>
    </button>
  );
}

export interface PickerOption {
  value: string;
  label: string;
  description?: string;
}

interface PickerFieldProps {
  label: string;
  title: string;
  icon: React.ReactNode;
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  searchable?: boolean;
}

/**
 * A field that opens a list in the app's bottom sheet. Used instead of a
 * dropdown so every choice is a big, easy-to-tap row.
 */
export function PickerField({
  label,
  title,
  icon,
  value,
  options,
  onChange,
  placeholder,
  searchable = false,
}: PickerFieldProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.description ?? '').toLowerCase().includes(q)
    );
  }, [options, query]);

  return (
    <div className="space-y-1.5">
      <p className="block text-sm font-semibold text-slate-700">{label}</p>
      <button
        type="button"
        onClick={() => {
          setQuery('');
          setOpen(true);
        }}
        className="w-full min-h-12 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left cursor-pointer hover:border-slate-300 transition-colors"
      >
        <span className="min-w-0 flex-1">
          {selected ? (
            <span className="block text-base font-semibold text-slate-900 truncate">{selected.label}</span>
          ) : (
            <span className="block text-base text-slate-400 truncate">{placeholder ?? title}</span>
          )}
        </span>
        <ChevronDown className="h-5 w-5 shrink-0 text-slate-400" />
      </button>

      <AppModal open={open} onClose={() => setOpen(false)} title={title} icon={icon} accent="slate">
        <div className="space-y-3">
          {searchable && (
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 pointer-events-none" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('search')}
                className="w-full min-h-12 rounded-xl border border-slate-200 bg-slate-50 pl-11 pr-3 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-amber-500"
              />
            </div>
          )}
          <ul className="space-y-1.5">
            {filtered.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-slate-500">{t('noMatch')}</li>
            )}
            {filtered.map((option) => {
              const isSelected = option.value === value;
              return (
                <li key={option.value}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    className={`w-full min-h-12 flex items-center gap-3 rounded-xl border px-4 py-2.5 text-left cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-amber-50 border-amber-300 text-amber-900'
                        : 'bg-white border-slate-200 hover:border-slate-300 text-slate-900'
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-semibold truncate">{option.label}</span>
                      {option.description && (
                        <span className="block text-sm text-slate-500 truncate">{option.description}</span>
                      )}
                    </span>
                    {isSelected && <Check className="h-5 w-5 shrink-0 text-amber-600" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </AppModal>
    </div>
  );
}

// --- Read-only rows ---

export function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className="font-semibold text-slate-900 text-right break-words min-w-0">{value}</span>
    </div>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative w-full">
      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 pointer-events-none" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full min-h-12 bg-white border border-slate-200 rounded-xl pl-11 pr-3 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 transition-all"
      />
    </div>
  );
}

// --- Delete with a plain-words confirmation ---

interface DeleteZoneProps {
  label: string;
  confirmText: string;
  /** Throws to keep the confirmation open (the caller shows the error). */
  onConfirm: () => Promise<void>;
}

/** A red "Delete" button that asks once more, in plain words, before deleting. */
export function DeleteZone({ label, confirmText, onConfirm }: DeleteZoneProps) {
  const { t } = useT();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="w-full min-h-12 flex items-center justify-center gap-2 rounded-xl text-sm font-bold text-red-600 hover:bg-red-50 cursor-pointer transition-colors"
      >
        <Trash2 className="h-5 w-5" />
        {label}
      </button>
    );
  }
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-3 space-y-3" role="alertdialog">
      <p className="text-sm font-semibold text-red-800 leading-relaxed">{confirmText}</p>
      <div className="grid grid-cols-2 gap-2">
        <ActionButton tone="secondary" icon={<X className="h-5 w-5" />} label={t('cancel')} onClick={() => setAsking(false)} />
        <ActionButton
          tone="danger"
          icon={<Trash2 className="h-5 w-5" />}
          label={t('deleteYes')}
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } catch {
              // The caller has shown what went wrong.
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
    </div>
  );
}
