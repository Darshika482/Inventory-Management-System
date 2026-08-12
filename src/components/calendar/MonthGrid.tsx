import { useMemo } from 'react';
import { WEEKDAYS, buildMonthCells, isSameDay } from '../../lib/calendarDates';

export type CalendarAccent = 'amber' | 'emerald';

export const calendarAccents: Record<
  CalendarAccent,
  { selected: string; band: string; bandText: string; bandHover: string; dot: string; ring: string; softBg: string; softText: string; softBorder: string }
> = {
  amber: {
    selected: 'bg-[#0F172A] text-white shadow-sm shadow-slate-900/25',
    band: 'bg-amber-100/70',
    bandText: 'text-amber-900',
    bandHover: 'hover:bg-amber-200/60',
    dot: 'bg-amber-500',
    ring: 'border-amber-500 ring-amber-500/15',
    softBg: 'bg-amber-50',
    softText: 'text-amber-700',
    softBorder: 'border-amber-200',
  },
  emerald: {
    selected: 'bg-emerald-600 text-white shadow-sm shadow-emerald-700/25',
    band: 'bg-emerald-100/70',
    bandText: 'text-emerald-900',
    bandHover: 'hover:bg-emerald-200/60',
    dot: 'bg-emerald-500',
    ring: 'border-emerald-500 ring-emerald-500/15',
    softBg: 'bg-emerald-50',
    softText: 'text-emerald-700',
    softBorder: 'border-emerald-200',
  },
};

interface MonthGridProps {
  month: Date;
  start: Date | null;
  end?: Date | null;
  /** Hovered day, used to preview a range before the end is committed. */
  preview?: Date | null;
  today: Date;
  minDate?: Date | null;
  maxDate?: Date | null;
  accent: CalendarAccent;
  onSelect: (date: Date) => void;
  onPreview?: (date: Date | null) => void;
}

export function MonthGrid({
  month,
  start,
  end = null,
  preview = null,
  today,
  minDate = null,
  maxDate = null,
  accent,
  onSelect,
  onPreview,
}: MonthGridProps) {
  const styles = calendarAccents[accent];
  const cells = useMemo(() => buildMonthCells(month), [month]);
  const rangeEnd = end ?? (start && preview && preview > start ? preview : null);

  return (
    <div className="select-none">
      <div className="grid grid-cols-7">
        {WEEKDAYS.map((weekday) => (
          <span
            key={weekday}
            className="py-1.5 text-center text-[0.65rem] font-bold uppercase tracking-widest text-slate-400"
          >
            {weekday}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map(({ date, inMonth }) => {
          const disabled = (maxDate && date > maxDate) || (minDate && date < minDate) || false;
          const isStart = start ? isSameDay(date, start) : false;
          const isEnd = rangeEnd ? isSameDay(date, rangeEnd) : false;
          const isEdge = isStart || isEnd;
          const inRange = start && rangeEnd ? date > start && date < rangeEnd : false;
          const hasBand = Boolean(start && rangeEnd) && !(isStart && isEnd) && (inRange || isEdge);
          const isToday = isSameDay(date, today);

          return (
            <div key={date.getTime()} className="relative h-11">
              {hasBand && (
                <span
                  aria-hidden
                  className={`absolute inset-y-1 ${styles.band}`}
                  style={{ left: isStart ? '50%' : 0, right: isEnd ? '50%' : 0 }}
                />
              )}

              <button
                type="button"
                disabled={disabled}
                onClick={() => onSelect(date)}
                onMouseEnter={() => onPreview?.(date)}
                onMouseLeave={() => onPreview?.(null)}
                className={`relative flex h-11 w-full items-center justify-center rounded-xl text-[0.9rem] font-semibold transition-colors ${
                  disabled ? 'cursor-not-allowed text-slate-200' : 'cursor-pointer'
                } ${
                  isEdge
                    ? styles.selected
                    : inRange
                      ? `${styles.bandText} ${styles.bandHover}`
                      : inMonth
                        ? 'text-slate-700 hover:bg-slate-100'
                        : 'text-slate-300 hover:bg-slate-50'
                }`}
              >
                {date.getDate()}
                {isToday && !isEdge && (
                  <span className={`absolute bottom-1 h-1 w-1 rounded-full ${styles.dot}`} />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
