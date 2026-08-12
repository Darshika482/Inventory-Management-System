import { useMemo, useRef, useState } from 'react';
import { CalendarDays, X } from 'lucide-react';
import {
  addDays,
  addMonths,
  formatLong,
  formatWeekday,
  isSameDay,
  parseISODate,
  startOfToday,
  toISODate,
} from '../lib/calendarDates';
import { MonthGrid, calendarAccents, type CalendarAccent } from './calendar/MonthGrid';
import { MonthNav, MonthYearPicker } from './calendar/MonthNav';
import { CalendarSurface, useIsCompact } from './calendar/CalendarSurface';
import { SwipeableMonth } from './calendar/SwipeableMonth';

interface DateFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  accent?: CalendarAccent;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  disableFuture?: boolean;
  placeholder?: string;
  hint?: string;
}

export function DateField({
  label,
  value,
  onChange,
  accent = 'amber',
  disabled = false,
  required = false,
  name,
  disableFuture = false,
  placeholder = 'Pick a date',
  hint,
}: DateFieldProps) {
  const today = useMemo(startOfToday, []);
  const maxDate = disableFuture ? today : null;
  const styles = calendarAccents[accent];
  const selected = parseISODate(value);

  const isCompact = useIsCompact();
  const [open, setOpen] = useState(false);
  const [pickingMonth, setPickingMonth] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => addMonths(selected ?? today, 0));
  const [direction, setDirection] = useState(1);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const shortcuts = useMemo(
    () => [
      { label: 'Today', date: today },
      { label: 'Yesterday', date: addDays(today, -1) },
    ],
    [today]
  );

  const openPicker = () => {
    if (disabled) return;
    setPickingMonth(false);
    setViewMonth(addMonths(selected ?? today, 0));
    setOpen(true);
  };

  const shiftMonth = (delta: number) => {
    setDirection(delta);
    setViewMonth((current) => addMonths(current, delta));
  };

  const commit = (date: Date) => {
    onChange(toISODate(date));
    setOpen(false);
  };

  const monthKey = `${viewMonth.getFullYear()}-${viewMonth.getMonth()}`;

  const grid = (
    <MonthGrid
      month={viewMonth}
      start={selected}
      today={today}
      maxDate={maxDate}
      accent={accent}
      onSelect={commit}
    />
  );

  const body = (
    <div className="flex flex-col gap-3 pt-3 sm:p-3.5">
      <div className="flex items-center gap-2">
        {shortcuts.map((shortcut) => {
          const isActive = selected ? isSameDay(selected, shortcut.date) : false;
          const isBlocked = maxDate ? shortcut.date > maxDate : false;
          return (
            <button
              key={shortcut.label}
              type="button"
              disabled={isBlocked}
              onClick={() => commit(shortcut.date)}
              className={`rounded-full border px-3.5 py-2 text-[0.8rem] font-semibold transition-colors cursor-pointer disabled:opacity-50 ${
                isActive
                  ? `${styles.softBorder} ${styles.softBg} ${styles.softText}`
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
              }`}
            >
              {shortcut.label}
            </button>
          );
        })}

        {selected && (
          <button
            type="button"
            onClick={() => {
              onChange('');
              setOpen(false);
            }}
            className="ml-auto rounded-full px-3 py-2 text-[0.8rem] font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
          >
            Clear
          </button>
        )}
      </div>

      <MonthNav
        viewMonth={viewMonth}
        pickingMonth={pickingMonth}
        onTogglePicking={() => setPickingMonth((prev) => !prev)}
        onShift={shiftMonth}
      />

      {pickingMonth ? (
        <MonthYearPicker
          viewMonth={viewMonth}
          onChange={setViewMonth}
          onPicked={() => setPickingMonth(false)}
        />
      ) : isCompact ? (
        <SwipeableMonth monthKey={monthKey} direction={direction} onSwipe={shiftMonth}>
          {grid}
        </SwipeableMonth>
      ) : (
        grid
      )}
    </div>
  );

  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-semibold text-slate-700">{label}</label>

      {required && name && (
        <input type="hidden" name={name} value={value} required readOnly />
      )}

      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          onClick={openPicker}
          className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3.5 text-left text-base transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
            open
              ? `bg-white ring-4 ${styles.ring}`
              : 'bg-slate-50 border-slate-200 hover:border-slate-300'
          }`}
        >
          <CalendarDays className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="min-w-0 flex-1">
            <span
              className={`block truncate font-semibold ${selected ? 'text-slate-900' : 'text-slate-400'}`}
            >
              {selected ? formatLong(selected) : placeholder}
            </span>
          </span>
          {selected && (
            <span className="hidden shrink-0 text-xs font-semibold text-slate-400 sm:block">
              {isSameDay(selected, today) ? 'Today' : formatWeekday(selected)}
            </span>
          )}
        </button>

        {selected && !disabled && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label={`Clear ${label.toLowerCase()}`}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-200/70 hover:text-slate-700 cursor-pointer sm:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {hint && <p className="text-xs font-medium text-slate-400">{hint}</p>}

      <CalendarSurface
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        title={label}
        subtitle={selected ? formatWeekday(selected) : 'Tap a day to choose'}
        desktopWidth={360}
      >
        {body}
      </CalendarSurface>
    </div>
  );
}
