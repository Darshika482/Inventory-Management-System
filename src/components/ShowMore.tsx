import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

/** Rows drawn at first, and added each time the end of the list comes into view. */
export const LIST_PAGE_SIZE = 100;

/**
 * Long lists draw only their first rows, so a page with thousands of entries
 * still opens at once. `resetKey` (the search and filters) starts the list
 * from the top again when it changes. Totals should still use the full list.
 */
export function useShowMore<T>(list: T[], resetKey: string, pageSize = LIST_PAGE_SIZE) {
  const [limit, setLimit] = useState(pageSize);
  const [shownKey, setShownKey] = useState(resetKey);
  if (shownKey !== resetKey) {
    setShownKey(resetKey);
    setLimit(pageSize);
  }
  return {
    visible: list.length > limit ? list.slice(0, limit) : list,
    hidden: Math.max(0, list.length - limit),
    showMore: () => setLimit((current) => current + pageSize),
  };
}

/**
 * Sits under a shortened list: draws the next rows by itself when scrolled
 * into view, and can be tapped too.
 */
export function ShowMoreButton({
  hidden,
  onMore,
  label,
  className = '',
}: {
  hidden: number;
  onMore: () => void;
  /** Defaults to "Show more (N left)". */
  label?: string;
  className?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const latestOnMore = useRef(onMore);
  latestOnMore.current = onMore;

  useEffect(() => {
    const button = ref.current;
    if (!button || hidden <= 0 || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) latestOnMore.current();
      },
      { rootMargin: '400px 0px' }
    );
    observer.observe(button);
    return () => observer.disconnect();
  }, [hidden]);

  if (hidden <= 0) return null;
  return (
    <button
      ref={ref}
      type="button"
      onClick={onMore}
      className={`w-full min-h-12 flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer ${className}`}
    >
      <ChevronDown className="h-4 w-4" />
      {label ?? `Show more (${hidden} left)`}
    </button>
  );
}
