import { useMemo, useRef, useState } from 'react';
import { CalendarRange, Check, X } from 'lucide-react';
import {
  addDays,
  addMonths,
  countDays,
  formatLong,
  formatWeekday,
  isSameDay,
  parseISODate,
  startOfMonth,
  startOfToday,
  toISODate,
} from '../lib/calendarDates';
import { MonthGrid, type CalendarAccent } from './calendar/MonthGrid';
import { MonthNav, MonthYearPicker } from './calendar/MonthNav';
import { CalendarSurface, useIsCompact } from './calendar/CalendarSurface';
import { SwipeableMonth } from './calendar/SwipeableMonth';

export interface DateRangeValue {
  from: string;
  to: string;
}

interface DateRangePickerProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  accent?: CalendarAccent;
  disableFuture?: boolean;
  placeholder?: string;
}

type Step = 'start' | 'end';

export function DateRangePicker({
  value,
  onChange,
  accent = 'amber',
  disableFuture = false,
  placeholder = 'Select a date range',
}: DateRangePickerProps) {
  const today = useMemo(startOfToday, []);
  const maxDate = disableFuture ? today : null;

  const committedStart = parseISODate(value.from);
  const committedEnd = parseISODate(value.to);

  const isCompact = useIsCompact();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<Date | null>(committedStart);
  const [end, setEnd] = useState<Date | null>(committedEnd);
  const [step, setStep] = useState<Step>('start');
  const [preview, setPreview] = useState<Date | null>(null);
  const [viewMonth, setViewMonth] = useState(() => addMonths(committedStart ?? today, 0));
  const [direction, setDirection] = useState(1);
  const [pickingMonth, setPickingMonth] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const presets = useMemo(() => {
    const monthStart = startOfMonth(today);
    return [
      { label: 'Today', start: today, end: today },
      { label: 'Yesterday', start: addDays(today, -1), end: addDays(today, -1) },
      { label: 'Last 7 days', start: addDays(today, -6), end: today },
      { label: 'Last 30 days', start: addDays(today, -29), end: today },
      { label: 'This month', start: monthStart, end: today },
      { label: 'Last month', start: addMonths(monthStart, -1), end: addDays(monthStart, -1) },
    ];
  }, [today]);

  const activePreset = presets.find(
    (preset) => start && end && isSameDay(preset.start, start) && isSameDay(preset.end, end)
  );

  const draftDays = start && end ? countDays(start, end) : start ? 1 : 0;

  const openPicker = () => {
    setStart(committedStart);
    setEnd(committedEnd);
    setStep(committedStart && !committedEnd ? 'end' : 'start');
    setPreview(null);
    setPickingMonth(false);
    setViewMonth(addMonths(committedStart ?? today, 0));
    setOpen(true);
  };

  const shiftMonth = (delta: number) => {
    setDirection(delta);
    setViewMonth((current) => addMonths(current, delta));
  };

  const handleSelect = (date: Date) => {
    if (step === 'start') {
      setStart(date);
      if (end && date > end) setEnd(null);
      setStep('end');
      return;
    }
    if (!start || date < start) {
      setStart(date);
      setEnd(null);
      setStep('end');
      return;
    }
    setEnd(date);
    setStep('start');
  };

  const applyPreset = (nextStart: Date, nextEnd: Date) => {
    setStart(nextStart);
    setEnd(nextEnd);
    setStep('start');
    setViewMonth(addMonths(nextStart, 0));
  };

  const commit = () => {
    if (!start) onChange({ from: '', to: '' });
    else onChange({ from: toISODate(start), to: toISODate(end ?? start) });
    setOpen(false);
  };

  const gridProps = {
    start,
    end,
    preview,
    today,
    maxDate,
    accent,
    onSelect: handleSelect,
    onPreview: setPreview,
  };

  const endpointCard = (which: Step) => {
    const date = which === 'start' ? start : end;
    const isActive = step === which;
    return (
      <button
        type="button"
        onClick={() => setStep(which)}
        className={`min-w-0 flex-1 rounded-xl border px-3 py-2 text-left transition-all cursor-pointer ${
          isActive
            ? accent === 'emerald'
              ? 'border-emerald-500 bg-emerald-50/60 ring-4 ring-emerald-500/15'
              : 'border-amber-500 bg-amber-50/60 ring-4 ring-amber-500/15'
            : 'border-slate-200 bg-white hover:border-slate-300'
        }`}
      >
        <span className="block text-[0.65rem] font-bold uppercase tracking-widest text-slate-400">
          {which === 'start' ? 'Start' : 'End'}
        </span>
        <span className={`block truncate text-sm font-bold ${date ? 'text-slate-900' : 'text-slate-400'}`}>
          {date ? formatLong(date) : 'Pick a day'}
        </span>
        <span className="block truncate text-[0.7rem] font-medium text-slate-400">
          {date ? formatWeekday(date) : isActive ? 'Waiting for a tap' : '—'}
        </span>
      </button>
    );
  };

  const monthKey = `${viewMonth.getFullYear()}-${viewMonth.getMonth()}`;

  const panel = (
    <div className="flex flex-col sm:flex-row">
      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] sm:hidden [&::-webkit-scrollbar]:hidden">
        {presets.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => applyPreset(preset.start, preset.end)}
            className={`shrink-0 rounded-full border px-3.5 py-2 text-[0.8rem] font-semibold transition-colors cursor-pointer ${
              activePreset?.label === preset.label
                ? 'border-slate-800 bg-[#0F172A] text-white'
                : 'border-slate-200 bg-white text-slate-600'
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="hidden sm:flex sm:w-44 sm:shrink-0 sm:flex-col sm:gap-1 sm:border-r sm:border-slate-100 sm:p-3">
        <span className="px-2 pb-1 text-[0.65rem] font-bold uppercase tracking-widest text-slate-400">
          Shortcuts
        </span>
        {presets.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => applyPreset(preset.start, preset.end)}
            className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-semibold transition-colors cursor-pointer ${
              activePreset?.label === preset.label
                ? 'bg-amber-50 text-amber-900'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            {preset.label}
            {activePreset?.label === preset.label && (
              <Check className="h-3.5 w-3.5 shrink-0 text-amber-600" />
            )}
          </button>
        ))}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3 pt-3 sm:p-4">
        <div className="flex items-stretch gap-2">
          {endpointCard('start')}
          {endpointCard('end')}
        </div>

        <MonthNav
          viewMonth={viewMonth}
          monthsShown={isCompact ? 1 : 2}
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
            <MonthGrid month={viewMonth} {...gridProps} />
          </SwipeableMonth>
        ) : (
          <div className="grid grid-cols-2 gap-5">
            <MonthGrid month={viewMonth} {...gridProps} />
            <MonthGrid month={addMonths(viewMonth, 1)} {...gridProps} />
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={() => {
              setStart(null);
              setEnd(null);
              setStep('start');
              setPreview(null);
            }}
            className="rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
          >
            Reset
          </button>

          <div className="flex items-center gap-3">
            <span className="hidden text-xs font-semibold text-slate-400 tabular-nums sm:block">
              {draftDays > 0
                ? `${draftDays} ${draftDays === 1 ? 'day' : 'days'} selected`
                : 'No range yet'}
            </span>
            <button
              type="button"
              onClick={commit}
              className="rounded-xl bg-[#0F172A] px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-slate-800 cursor-pointer"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const hasValue = Boolean(committedStart || committedEnd);
  const committedDays =
    committedStart && committedEnd ? countDays(committedStart, committedEnd) : 0;

  return (
    <div className="min-w-0">
      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          onClick={openPicker}
          className={`flex w-full items-center gap-3 rounded-xl border bg-white px-3.5 py-3 text-left transition-all cursor-pointer ${
            open
              ? 'border-amber-500 ring-4 ring-amber-500/15'
              : 'border-slate-200 shadow-xs hover:border-slate-300'
          } ${hasValue ? 'pr-11' : ''}`}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-100 bg-amber-50 text-amber-600">
            <CalendarRange className="h-4 w-4" />
          </span>

          <span className="min-w-0 flex-1">
            <span className="block text-[0.65rem] font-bold uppercase tracking-widest text-slate-400">
              Date range
            </span>
            <span
              className={`block truncate text-sm font-bold ${hasValue ? 'text-slate-900' : 'text-slate-400'}`}
            >
              {committedStart && committedEnd
                ? isSameDay(committedStart, committedEnd)
                  ? formatLong(committedStart)
                  : `${formatLong(committedStart)} – ${formatLong(committedEnd)}`
                : committedStart
                  ? `${formatLong(committedStart)} – now`
                  : placeholder}
            </span>
          </span>

          {committedDays > 0 && (
            <span className="hidden shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[0.7rem] font-bold text-amber-700 tabular-nums sm:block">
              {committedDays} {committedDays === 1 ? 'day' : 'days'}
            </span>
          )}
        </button>

        {hasValue && (
          <button
            type="button"
            onClick={() => onChange({ from: '', to: '' })}
            aria-label="Clear date range"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <CalendarSurface
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        title="Date range"
        subtitle={
          draftDays > 0
            ? `${draftDays} ${draftDays === 1 ? 'day' : 'days'} selected`
            : step === 'start'
              ? 'Tap a day to set the start'
              : 'Tap a day to set the end'
        }
        desktopWidth={700}
      >
        {panel}
      </CalendarSurface>
    </div>
  );
}
