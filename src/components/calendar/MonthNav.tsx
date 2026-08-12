import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { MONTHS, MONTHS_SHORT, addMonths } from '../../lib/calendarDates';

const arrowClass =
  'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-900 cursor-pointer';

interface MonthNavProps {
  viewMonth: Date;
  /** 2 renders a second, static label for the side-by-side desktop layout. */
  monthsShown?: number;
  pickingMonth: boolean;
  onTogglePicking: () => void;
  onShift: (delta: number) => void;
}

export function MonthNav({
  viewMonth,
  monthsShown = 1,
  pickingMonth,
  onTogglePicking,
  onShift,
}: MonthNavProps) {
  const secondMonth = addMonths(viewMonth, 1);

  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => onShift(-1)} aria-label="Previous month" className={arrowClass}>
        <ChevronLeft className="h-4 w-4" />
      </button>

      <div className="flex flex-1 items-center justify-around gap-2">
        <button
          type="button"
          onClick={onTogglePicking}
          className="flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-[0.95rem] font-bold text-slate-900 transition-colors hover:bg-slate-100 cursor-pointer"
        >
          {MONTHS[viewMonth.getMonth()]} {viewMonth.getFullYear()}
          <ChevronDown
            className={`h-4 w-4 text-slate-400 transition-transform ${pickingMonth ? 'rotate-180' : ''}`}
          />
        </button>

        {monthsShown > 1 && !pickingMonth && (
          <span className="px-2.5 py-2 text-[0.95rem] font-bold text-slate-900">
            {MONTHS[secondMonth.getMonth()]} {secondMonth.getFullYear()}
          </span>
        )}
      </div>

      <button type="button" onClick={() => onShift(1)} aria-label="Next month" className={arrowClass}>
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

interface MonthYearPickerProps {
  viewMonth: Date;
  onChange: (month: Date) => void;
  onPicked: () => void;
}

export function MonthYearPicker({ viewMonth, onChange, onPicked }: MonthYearPickerProps) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onChange(new Date(viewMonth.getFullYear() - 1, viewMonth.getMonth(), 1))}
          aria-label="Previous year"
          className={arrowClass}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-[0.95rem] font-bold text-slate-900 tabular-nums">
          {viewMonth.getFullYear()}
        </span>
        <button
          type="button"
          onClick={() => onChange(new Date(viewMonth.getFullYear() + 1, viewMonth.getMonth(), 1))}
          aria-label="Next year"
          className={arrowClass}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {MONTHS_SHORT.map((month, index) => {
          const isActive = viewMonth.getMonth() === index;
          return (
            <button
              key={month}
              type="button"
              onClick={() => {
                onChange(new Date(viewMonth.getFullYear(), index, 1));
                onPicked();
              }}
              className={`h-11 rounded-xl text-sm font-semibold transition-colors cursor-pointer ${
                isActive
                  ? 'bg-[#0F172A] text-white'
                  : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
              }`}
            >
              {month}
            </button>
          );
        })}
      </div>
    </div>
  );
}
