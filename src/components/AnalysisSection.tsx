import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowDownWideNarrow,
  BadgeIndianRupee,
  BarChart3,
  Building2,
  Check,
  Combine,
  Layers,
  Loader2,
  Minus,
  Scale,
  Search,
  ShoppingBasket,
  Trash2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { motion } from 'motion/react';
import { ItemGroup, PurchaseBill } from '../types';
import {
  deleteItemGroupFromDb,
  fetchItemGroups,
  fetchPurchaseBills,
  insertItemGroup,
} from '../lib/database';
import { describeDbError, FriendlyError } from '../lib/dbErrors';
import { AppModal } from './AppModal';
import { DateRangePicker, DateRangeValue } from './DateRangePicker';

interface AnalysisSectionProps {
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

/** One purchased line, tied back to the bill it came from. */
interface PurchaseEntry {
  party: string;
  itemName: string;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
  billDate: string;
  billNo: string;
}

interface PartyStat {
  party: string;
  purchases: number;
  quantity: number;
  spend: number;
  /** Quantity-weighted average rate — what this party effectively charged. */
  avgRate: number;
  minRate: number;
  maxRate: number;
  lastRate: number;
  lastDate: string;
}

interface ItemStat {
  key: string;
  name: string;
  /** Set when this item is a user-made combination of several bill names. */
  groupId: string | null;
  /** Distinct bill spellings folded into this item. */
  memberNames: string[];
  units: string[];
  quantity: number;
  spend: number;
  purchases: number;
  /** Sorted cheapest first (by weighted average rate). */
  parties: PartyStat[];
  /** Newest purchase with a usable rate. */
  latest: PurchaseEntry | null;
  /** Rate on the purchase before the latest one, if any. */
  prevRate: number | null;
  /** % change of the latest rate vs the previous purchase. Null on first buys. */
  trendPct: number | null;
  entries: PurchaseEntry[];
}

/** A bill item name available for combining. */
interface NameCandidate {
  key: string;
  name: string;
  purchases: number;
}

type PartyScope = 'all' | 'multi';
type SortMode = 'change' | 'recent' | 'spend' | 'name';

function formatMoney(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function formatQty(qty: number): string {
  return qty.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function formatDate(isoDate: string): string {
  if (!isoDate) return '—';
  const date = new Date(isoDate + 'T00:00:00');
  if (isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "steel  Rod" and "Steel rod" are the same item on different bills. */
function itemKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Spelling variants that mean the same unit on different bills. */
const UNIT_ALIASES: Record<string, string> = {
  meter: 'Meter',
  meters: 'Meter',
  metre: 'Meter',
  metres: 'Meter',
  mtr: 'Meter',
  mtrs: 'Meter',
  pc: 'Piece',
  pcs: 'Piece',
  piece: 'Piece',
  pieces: 'Piece',
  kg: 'Kg',
  kgs: 'Kg',
  kilo: 'Kg',
  kilos: 'Kg',
  kilogram: 'Kg',
  kilograms: 'Kg',
  box: 'Box',
  boxes: 'Box',
  doz: 'Dozen',
  dz: 'Dozen',
  dozen: 'Dozen',
  dozens: 'Dozen',
  roll: 'Roll',
  rolls: 'Roll',
  set: 'Set',
  sets: 'Set',
  bundle: 'Bundle',
  bundles: 'Bundle',
};

function canonicalUnit(raw: string): string {
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  if (!cleaned) return '';
  return UNIT_ALIASES[cleaned.toLowerCase().replace(/\.+$/, '')] ?? cleaned;
}

function flattenBills(bills: PurchaseBill[], range: DateRangeValue): PurchaseEntry[] {
  const entries: PurchaseEntry[] = [];
  for (const bill of bills) {
    if (range.from && bill.billDate && bill.billDate < range.from) continue;
    if (range.to && bill.billDate && bill.billDate > range.to) continue;
    const party = bill.firmName.trim();
    for (const line of bill.items) {
      const name = line.name.trim().replace(/\s+/g, ' ');
      if (!name) continue;
      const rate = line.rate > 0 ? line.rate : line.quantity > 0 ? line.amount / line.quantity : 0;
      entries.push({
        party,
        itemName: name,
        quantity: line.quantity,
        unit: canonicalUnit(line.unit),
        rate,
        amount: line.amount > 0 ? line.amount : line.quantity * rate,
        billDate: bill.billDate,
        billNo: bill.billNo,
      });
    }
  }
  return entries;
}

function buildItemStats(entries: PurchaseEntry[], groups: ItemGroup[]): ItemStat[] {
  const aliasToGroup = new Map<string, ItemGroup>();
  for (const group of groups) {
    for (const member of group.members) aliasToGroup.set(member, group);
  }

  const grouped = new Map<string, { group: ItemGroup | null; lines: PurchaseEntry[] }>();
  for (const entry of entries) {
    const rawKey = itemKey(entry.itemName);
    const group = aliasToGroup.get(rawKey) ?? null;
    const key = group ? `grp-${group.id}` : rawKey;
    const bucket = grouped.get(key);
    if (bucket) bucket.lines.push(entry);
    else grouped.set(key, { group, lines: [entry] });
  }

  const items: ItemStat[] = [];
  for (const [key, { group: itemGroup, lines: group }] of grouped) {
    // Newest first.
    group.sort((a, b) => (a.billDate < b.billDate ? 1 : a.billDate > b.billDate ? -1 : 0));

    const byParty = new Map<string, PurchaseEntry[]>();
    for (const entry of group) {
      const list = byParty.get(entry.party);
      if (list) list.push(entry);
      else byParty.set(entry.party, [entry]);
    }

    const parties: PartyStat[] = [];
    for (const [party, lines] of byParty) {
      const priced = lines.filter((l) => l.rate > 0);
      const quantity = lines.reduce((sum, l) => sum + l.quantity, 0);
      const spend = lines.reduce((sum, l) => sum + l.amount, 0);
      const weightQty = priced.reduce((sum, l) => sum + l.quantity, 0);
      const avgRate =
        weightQty > 0
          ? priced.reduce((sum, l) => sum + l.rate * l.quantity, 0) / weightQty
          : priced.length > 0
            ? priced.reduce((sum, l) => sum + l.rate, 0) / priced.length
            : 0;
      const rates = priced.map((l) => l.rate);
      const latest = priced[0] ?? lines[0];
      parties.push({
        party,
        purchases: lines.length,
        quantity,
        spend,
        avgRate,
        minRate: rates.length ? Math.min(...rates) : 0,
        maxRate: rates.length ? Math.max(...rates) : 0,
        lastRate: latest?.rate ?? 0,
        lastDate: latest?.billDate ?? '',
      });
    }
    parties.sort((a, b) => a.avgRate - b.avgRate);

    // Case-insensitive so leftover spelling variants don't count as "mixed units".
    const unitVariants = new Map<string, string>();
    for (const line of group) {
      const lower = line.unit.toLowerCase();
      if (line.unit && !unitVariants.has(lower)) unitVariants.set(lower, line.unit);
    }

    const nameVariants = new Map<string, string>();
    for (const line of group) {
      const lower = line.itemName.toLowerCase();
      if (!nameVariants.has(lower)) nameVariants.set(lower, line.itemName);
    }

    const priced = group.filter((l) => l.rate > 0);
    const latest = priced[0] ?? null;
    const prevRate = priced.length > 1 ? priced[1].rate : null;
    const trendPct =
      latest && prevRate && prevRate > 0 ? ((latest.rate - prevRate) / prevRate) * 100 : null;

    items.push({
      key,
      // A combined item shows its chosen name; otherwise the newest spelling wins.
      name: itemGroup ? itemGroup.name : group[0].itemName,
      groupId: itemGroup?.id ?? null,
      memberNames: Array.from(nameVariants.values()),
      units: Array.from(unitVariants.values()),
      quantity: group.reduce((sum, l) => sum + l.quantity, 0),
      spend: group.reduce((sum, l) => sum + l.amount, 0),
      purchases: group.length,
      parties,
      latest,
      prevRate,
      trendPct,
      entries: group,
    });
  }
  return items;
}

export function AnalysisSection({ showToast }: AnalysisSectionProps) {
  const [bills, setBills] = useState<PurchaseBill[]>([]);
  const [groups, setGroups] = useState<ItemGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<FriendlyError | null>(null);

  const [search, setSearch] = useState('');
  const [range, setRange] = useState<DateRangeValue>({ from: '', to: '' });
  const [scope, setScope] = useState<PartyScope>('all');
  const [sortMode, setSortMode] = useState<SortMode>('change');
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [isCombineOpen, setIsCombineOpen] = useState(false);

  const loadData = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [billsData, groupsData] = await Promise.all([
        fetchPurchaseBills(),
        fetchItemGroups(),
      ]);
      setBills(billsData);
      setGroups(groupsData);
    } catch (err) {
      console.error('Loading bills for analysis failed:', err);
      setLoadError(describeDbError(err, 'The rate analysis could not be loaded'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = useMemo(
    () => buildItemStats(flattenBills(bills, range), groups),
    [bills, range, groups]
  );

  /** Every distinct bill item name (all time), for the combine picker. */
  const allNames = useMemo(() => {
    const map = new Map<string, NameCandidate>();
    for (const bill of bills) {
      for (const line of bill.items) {
        const name = line.name.trim().replace(/\s+/g, ' ');
        if (!name) continue;
        const key = itemKey(name);
        const current = map.get(key);
        if (current) current.purchases += 1;
        else map.set(key, { key, name, purchases: 1 });
      }
    }
    return map;
  }, [bills]);

  const totals = useMemo(() => {
    const parties = new Set<string>();
    let spend = 0;
    let increased = 0;
    for (const item of items) {
      spend += item.spend;
      if (item.trendPct !== null && item.trendPct > 0.05) increased += 1;
      for (const p of item.parties) parties.add(p.party);
    }
    return { itemCount: items.length, partyCount: parties.size, spend, increased };
  }, [items]);

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = items.filter((item) => {
      if (scope === 'multi' && item.parties.length < 2) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.memberNames.some((n) => n.toLowerCase().includes(q)) ||
        item.parties.some((p) => p.party.toLowerCase().includes(q))
      );
    });

    const sorted = [...filtered];
    if (sortMode === 'change') {
      // Rate rises first, then drops, then items without a comparison.
      sorted.sort(
        (a, b) => (b.trendPct ?? -Infinity) - (a.trendPct ?? -Infinity) || b.spend - a.spend
      );
    } else if (sortMode === 'recent') {
      sorted.sort(
        (a, b) =>
          (b.latest?.billDate ?? '').localeCompare(a.latest?.billDate ?? '') || b.spend - a.spend
      );
    } else if (sortMode === 'spend') {
      sorted.sort((a, b) => b.spend - a.spend);
    } else {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    }
    return sorted;
  }, [items, search, scope, sortMode]);

  const detailItem = detailKey ? items.find((i) => i.key === detailKey) ?? null : null;

  const handleCreateGroup = async (name: string, memberKeys: string[]): Promise<boolean> => {
    const group: ItemGroup = {
      id: `grp-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: name.trim(),
      members: memberKeys,
      createdAt: new Date().toISOString(),
    };
    try {
      await insertItemGroup(group);
      setGroups((prev) => [group, ...prev]);
      showToast(`Combined ${memberKeys.length} names into "${group.name}".`, 'success');
      return true;
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      showToast(
        code === '42P01'
          ? 'The item_groups table is missing. Run supabase/add-item-groups.sql in the Supabase SQL editor, then try again.'
          : describeDbError(err, 'The combination could not be saved').message,
        'error'
      );
      return false;
    }
  };

  const handleDeleteGroup = async (group: ItemGroup) => {
    try {
      await deleteItemGroupFromDb(group.id);
      setGroups((prev) => prev.filter((g) => g.id !== group.id));
      showToast(`"${group.name}" split back into separate names.`, 'info');
    } catch (err) {
      showToast(describeDbError(err, 'The combination could not be removed').message, 'error');
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#F8FAFC] p-6">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="h-8 w-8 animate-spin text-amber-600" />
          <p className="text-base font-medium">Preparing the rate analysis...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#F8FAFC] p-6">
        <div className="max-w-md w-full bg-white border border-red-200 rounded-xl p-6 shadow-lg text-center space-y-4">
          <BarChart3 className="h-10 w-10 text-red-500 mx-auto" />
          <h2 className="text-xl font-bold text-slate-900">Could not load the analysis</h2>
          <p className="text-sm text-slate-600 leading-relaxed">{loadError.message}</p>
          {loadError.detail && (
            <p className="text-xs text-slate-400 leading-relaxed break-words">{loadError.detail}</p>
          )}
          <button
            type="button"
            onClick={loadData}
            className="px-5 py-3 bg-[#0F172A] text-white rounded-xl text-base font-semibold cursor-pointer"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#F8FAFC] p-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:p-6 md:p-8 space-y-4 sm:space-y-5 font-sans text-slate-900 selection:bg-amber-500 selection:text-white">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900">Rate analysis</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Track how each item's rate is moving from bill to bill, and who charges what.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsCombineOpen(true)}
          className="shrink-0 flex items-center gap-1.5 px-3 py-2 sm:px-4 sm:py-2.5 bg-[#0F172A] hover:bg-slate-800 text-white rounded-lg text-sm font-bold whitespace-nowrap shadow-xs cursor-pointer transition-all"
        >
          <Combine className="h-4 w-4" />
          <span className="hidden sm:inline">Combine names</span>
          <span className="sm:hidden">Combine</span>
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <SummaryCard
          icon={<ShoppingBasket className="h-4 w-4" />}
          label="Items bought"
          value={String(totals.itemCount)}
          hint="in this period"
        />
        <SummaryCard
          icon={<Building2 className="h-4 w-4" />}
          label="Parties"
          value={String(totals.partyCount)}
          hint="in this period"
        />
        <SummaryCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Rates gone up"
          value={String(totals.increased)}
          hint="vs the previous purchase"
          tone={totals.increased > 0 ? 'red' : 'amber'}
        />
        <SummaryCard
          icon={<BadgeIndianRupee className="h-4 w-4" />}
          label="Total purchase"
          value={formatMoney(totals.spend)}
          hint="item lines only"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
        <div className="relative w-full sm:max-w-56">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search item or party..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 w-full transition-all"
          />
        </div>

        <div className="w-full sm:w-72">
          <DateRangePicker value={range} onChange={setRange} disableFuture placeholder="All time" />
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-slate-50 p-0.5 border border-slate-200">
            {(
              [
                { key: 'all' as const, label: 'All items' },
                { key: 'multi' as const, label: '2+ parties' },
              ]
            ).map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setScope(key)}
                className={`px-2.5 py-2 sm:px-3 text-xs sm:text-sm rounded-md font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                  scope === key
                    ? 'bg-[#0F172A] text-white font-bold shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 ml-auto sm:ml-0">
            <ArrowDownWideNarrow className="h-4 w-4 text-slate-400 shrink-0" />
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="bg-white border border-slate-200 rounded-lg px-2 py-2 text-sm font-semibold text-slate-700 focus:outline-none focus:border-amber-500 cursor-pointer"
              aria-label="Sort items"
            >
              <option value="change">Rate change</option>
              <option value="recent">Recently bought</option>
              <option value="spend">Highest purchase</option>
              <option value="name">Item name (A–Z)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Item list */}
      {visibleItems.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2">
          <Scale className="h-10 w-10 text-slate-300 mx-auto" />
          <p className="text-base font-semibold text-slate-700">
            {items.length === 0
              ? 'No purchase data to analyse yet'
              : 'Nothing matches these filters'}
          </p>
          <p className="text-sm text-slate-500">
            {items.length === 0
              ? 'Add bills with item lines in the Party bills page and they will show up here.'
              : 'Try a wider date range or clear the search.'}
          </p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl shadow-xs divide-y divide-slate-100 overflow-hidden">
          {visibleItems.map((item) => (
            <ItemRow key={item.key} item={item} onOpen={() => setDetailKey(item.key)} />
          ))}
        </div>
      )}

      <p className="text-xs text-slate-400">
        Rate change compares the latest purchase with the one before it (bill line rates, before
        bill-level GST and discounts). Tap an item for its full rate history. Use "Combine names"
        when the same item is spelt differently on different bills.
      </p>

      {/* Item detail */}
      <AppModal
        open={!!detailItem}
        onClose={() => setDetailKey(null)}
        title={detailItem?.name ?? ''}
        description={
          detailItem
            ? `${detailItem.parties.length} ${detailItem.parties.length === 1 ? 'party' : 'parties'} · ${formatQty(detailItem.quantity)} ${detailItem.units[0] ?? ''} bought · ${formatMoney(detailItem.spend)}`
            : undefined
        }
        icon={<Scale className="h-5 w-5" />}
        accent="amber"
      >
        {detailItem && <ItemDetail item={detailItem} />}
      </AppModal>

      {/* Combine names manager */}
      <CombineModal
        open={isCombineOpen}
        onClose={() => setIsCombineOpen(false)}
        groups={groups}
        allNames={allNames}
        onCreate={handleCreateGroup}
        onDelete={handleDeleteGroup}
      />
    </div>
  );
}

function rateLabel(rate: number, unit?: string): string {
  return `${formatMoney(rate)}${unit ? ` / ${unit}` : ''}`;
}

function TrendBadge({ pct, className = '' }: { pct: number | null; className?: string }) {
  if (pct === null) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[0.7rem] font-semibold text-slate-500 ${className}`}
      >
        First purchase
      </span>
    );
  }
  const flat = Math.abs(pct) <= 0.05;
  if (flat) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[0.7rem] font-bold text-slate-600 tabular-nums ${className}`}
      >
        <Minus className="h-3 w-3" />
        Same rate
      </span>
    );
  }
  const up = pct > 0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.7rem] font-bold tabular-nums ${
        up
          ? 'border-red-200 bg-red-50 text-red-700'
          : 'border-emerald-200 bg-emerald-50 text-emerald-700'
      } ${className}`}
    >
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? '+' : ''}
      {pct.toFixed(1)}%
    </span>
  );
}

function ItemRow({ item, onOpen }: { item: ItemStat; onOpen: () => void }) {
  const unit = item.units[0] ?? '';
  const latest = item.latest;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full flex items-center gap-3 px-3 py-3 sm:px-4 text-left cursor-pointer hover:bg-amber-50/40 transition-colors"
    >
      <div className="min-w-0 flex-1">
        <p className="font-bold text-slate-900 leading-tight truncate">{item.name}</p>
        <p className="text-xs text-slate-500 mt-1 truncate">
          {latest ? (
            <>
              {latest.party} · {formatDate(latest.billDate)}
            </>
          ) : (
            'No rate on the bills'
          )}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
          <TrendBadge pct={item.trendPct} />
          {item.parties.length >= 2 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[0.7rem] font-bold text-amber-700">
              <Building2 className="h-3 w-3" />
              {item.parties.length} parties
            </span>
          )}
          {item.groupId && (
            <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[0.7rem] font-bold text-sky-700">
              <Layers className="h-3 w-3" />
              {item.memberNames.length} names
            </span>
          )}
          {item.units.length > 1 && (
            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[0.7rem] font-semibold text-amber-700">
              Mixed units
            </span>
          )}
        </div>
      </div>

      <div className="text-right shrink-0">
        <p className="text-base font-bold tabular-nums text-slate-900 whitespace-nowrap">
          {latest ? rateLabel(latest.rate, unit) : '—'}
        </p>
        {item.prevRate !== null && (
          <p className="text-xs text-slate-400 tabular-nums whitespace-nowrap">
            was {formatMoney(item.prevRate)}
          </p>
        )}
        <p className="text-xs text-slate-500 tabular-nums whitespace-nowrap mt-0.5">
          {formatQty(item.quantity)} {unit} · {formatMoney(item.spend)}
        </p>
      </div>
    </button>
  );
}

interface SummaryCardProps {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
  tone?: 'amber' | 'red' | 'emerald';
}

function SummaryCard({ icon, label, value, hint, tone = 'amber' }: SummaryCardProps) {
  const iconTone =
    tone === 'red'
      ? 'bg-red-50 text-red-600 border-red-100'
      : tone === 'emerald'
        ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
        : 'bg-amber-50 text-amber-600 border-amber-100';
  const valueTone =
    tone === 'red' ? 'text-red-700' : tone === 'emerald' ? 'text-emerald-700' : 'text-slate-900';
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-xs p-3 sm:p-4 min-w-0">
      <div className="flex items-center gap-2 text-slate-500">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${iconTone}`}
        >
          {icon}
        </span>
        <p className="text-xs font-semibold uppercase tracking-wider truncate">{label}</p>
      </div>
      <p className={`mt-2 text-lg sm:text-xl font-bold tabular-nums truncate ${valueTone}`}>
        {value}
      </p>
      <p className="text-[0.7rem] text-slate-400 font-medium truncate">{hint}</p>
    </div>
  );
}

function ItemDetail({ item }: { item: ItemStat }) {
  const unit = item.units[0] ?? '';
  const priced = item.entries.filter((e) => e.rate > 0);
  const maxRate = priced.length ? Math.max(...priced.map((e) => e.rate)) : 0;
  const timeline = item.entries.slice(0, 20);

  const rated = item.parties.filter((p) => p.avgRate > 0);
  const minAvg = rated.length ? rated[0].avgRate : 0;
  const maxAvg = rated.length ? Math.max(...rated.map((p) => p.avgRate)) : 0;

  return (
    <div className="space-y-6">
      {item.groupId && item.memberNames.length > 1 && (
        <p className="text-xs font-semibold text-sky-800 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
          Combined from {item.memberNames.length} bill names: {item.memberNames.join(' · ')}
        </p>
      )}

      {/* Party comparison — only when there is something to compare */}
      {item.parties.length >= 2 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">
            Party-wise rate
          </p>
          <div className="space-y-3">
            {item.parties.map((party) => {
              const isCheapest =
                rated.length >= 2 && party.avgRate === minAvg && party.avgRate > 0;
              const isCostliest =
                rated.length >= 2 && party.avgRate === maxAvg && maxAvg > minAvg;
              const width = maxAvg > 0 ? Math.max(6, (party.avgRate / maxAvg) * 100) : 0;
              return (
                <div key={party.party} className="min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-bold text-slate-900 truncate">
                      {party.party}
                      {isCheapest && (
                        <span className="ml-2 text-[0.65rem] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                          Lowest
                        </span>
                      )}
                      {isCostliest && (
                        <span className="ml-2 text-[0.65rem] font-bold uppercase tracking-wider text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
                          Highest
                        </span>
                      )}
                    </p>
                    <p className="text-sm font-bold tabular-nums text-slate-900 shrink-0">
                      {rateLabel(party.avgRate, unit)}
                    </p>
                  </div>
                  <div className="mt-1.5 h-2.5 rounded-full bg-slate-100 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${width}%` }}
                      transition={{ duration: 0.4, ease: 'easeOut' }}
                      className={`h-full rounded-full ${
                        isCheapest ? 'bg-emerald-500' : isCostliest ? 'bg-red-400' : 'bg-amber-400'
                      }`}
                    />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatQty(party.quantity)} {unit} in {party.purchases}{' '}
                    {party.purchases === 1 ? 'purchase' : 'purchases'} · {formatMoney(party.spend)}
                    {party.lastDate && (
                      <>
                        {' '}
                        · last {formatMoney(party.lastRate)} on {formatDate(party.lastDate)}
                      </>
                    )}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Rate timeline — newest purchase first */}
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">
          Rate history
        </p>
        <div className="space-y-3">
          {timeline.map((entry, index) => {
            const prev = timeline.slice(index + 1).find((e) => e.rate > 0);
            const pct =
              entry.rate > 0 && prev && prev.rate > 0
                ? ((entry.rate - prev.rate) / prev.rate) * 100
                : null;
            const width =
              maxRate > 0 && entry.rate > 0 ? Math.max(6, (entry.rate / maxRate) * 100) : 0;
            const isLatest = index === 0;
            return (
              <div key={`${entry.billNo}-${index}`} className="min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-500 truncate">
                    {formatDate(entry.billDate)}
                    <span className="text-slate-400 font-medium"> · {entry.party}</span>
                    {entry.billNo && (
                      <span className="text-slate-400 font-medium"> · Bill {entry.billNo}</span>
                    )}
                  </p>
                  <p
                    className={`text-sm font-bold tabular-nums shrink-0 ${
                      isLatest ? 'text-slate-900' : 'text-slate-600'
                    }`}
                  >
                    {entry.rate > 0 ? rateLabel(entry.rate, entry.unit || unit) : '—'}
                  </p>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-2.5 flex-1 rounded-full bg-slate-100 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${width}%` }}
                      transition={{ duration: 0.4, ease: 'easeOut' }}
                      className={`h-full rounded-full ${isLatest ? 'bg-amber-500' : 'bg-slate-300'}`}
                    />
                  </div>
                  {pct !== null && Math.abs(pct) > 0.05 && (
                    <span
                      className={`shrink-0 text-[0.7rem] font-bold tabular-nums ${
                        pct > 0 ? 'text-red-600' : 'text-emerald-600'
                      }`}
                    >
                      {pct > 0 ? '+' : ''}
                      {pct.toFixed(1)}%
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-slate-400 tabular-nums">
                  {formatQty(entry.quantity)} {entry.unit || unit} = {formatMoney(entry.amount)}
                </p>
              </div>
            );
          })}
        </div>
        {item.entries.length > timeline.length && (
          <p className="mt-2 text-xs text-slate-400 font-medium">
            Showing the latest {timeline.length} of {item.entries.length} purchases.
          </p>
        )}
        {item.units.length > 1 && (
          <p className="mt-3 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            This item was billed in different units ({item.units.join(', ')}), so the rates above
            may not be directly comparable.
          </p>
        )}
      </div>
    </div>
  );
}

interface CombineModalProps {
  open: boolean;
  onClose: () => void;
  groups: ItemGroup[];
  allNames: Map<string, NameCandidate>;
  onCreate: (name: string, memberKeys: string[]) => Promise<boolean>;
  onDelete: (group: ItemGroup) => void;
}

function CombineModal({ open, onClose, groups, allNames, onCreate, onDelete }: CombineModalProps) {
  const [groupName, setGroupName] = useState('');
  const [pickSearch, setPickSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setGroupName('');
      setPickSearch('');
      setSelected(new Set());
    }
  }, [open]);

  const takenKeys = useMemo(() => {
    const set = new Set<string>();
    for (const group of groups) for (const member of group.members) set.add(member);
    return set;
  }, [groups]);

  const candidates = useMemo(() => {
    const q = pickSearch.trim().toLowerCase();
    return Array.from(allNames.values())
      .filter((c) => !takenKeys.has(c.key))
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allNames, takenKeys, pickSearch]);

  const toggle = (candidate: NameCandidate) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(candidate.key)) next.delete(candidate.key);
      else next.add(candidate.key);
      return next;
    });
    setGroupName((current) => (current.trim() ? current : candidate.name));
  };

  const canSave = groupName.trim().length > 0 && selected.size >= 2 && !isSaving;

  const handleSave = async () => {
    if (!canSave) return;
    setIsSaving(true);
    const ok = await onCreate(groupName, Array.from(selected));
    setIsSaving(false);
    if (ok) {
      setGroupName('');
      setPickSearch('');
      setSelected(new Set());
    }
  };

  const displayName = (key: string) => allNames.get(key)?.name ?? key;

  return (
    <AppModal
      open={open}
      onClose={onClose}
      title="Combine item names"
      description="Pick the bill names that are actually the same item. They will be analysed as one."
      icon={<Combine className="h-5 w-5" />}
      accent="slate"
    >
      <div className="space-y-6">
        {/* New combination */}
        <div className="space-y-3">
          <div>
            <label
              htmlFor="combine-name"
              className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1.5"
            >
              Combined item name
            </label>
            <input
              id="combine-name"
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="e.g. Dyed Cloth Titan"
              className="bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 w-full transition-all"
            />
          </div>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search names to combine..."
              value={pickSearch}
              onChange={(e) => setPickSearch(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 w-full transition-all"
            />
          </div>

          <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-64 overflow-y-auto">
            {candidates.length === 0 ? (
              <p className="px-3 py-4 text-sm text-slate-500 text-center">
                {allNames.size === 0
                  ? 'No item names found on the bills yet.'
                  : 'No names match this search (already-combined names are hidden).'}
              </p>
            ) : (
              candidates.map((candidate) => {
                const isPicked = selected.has(candidate.key);
                return (
                  <button
                    key={candidate.key}
                    type="button"
                    onClick={() => toggle(candidate)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left cursor-pointer transition-colors ${
                      isPicked ? 'bg-amber-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                        isPicked
                          ? 'bg-amber-500 border-amber-500 text-white'
                          : 'border-slate-300 bg-white text-transparent'
                      }`}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-slate-900 truncate">
                        {candidate.name}
                      </span>
                      <span className="block text-xs text-slate-400">
                        {candidate.purchases} {candidate.purchases === 1 ? 'purchase' : 'purchases'}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-base font-bold transition-all ${
              canSave
                ? 'bg-[#0F172A] hover:bg-slate-800 text-white cursor-pointer'
                : 'bg-slate-100 text-slate-400 cursor-not-allowed'
            }`}
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Combine className="h-4 w-4" />
            )}
            {selected.size < 2
              ? 'Pick at least 2 names'
              : `Combine ${selected.size} names`}
          </button>
        </div>

        {/* Existing combinations */}
        {groups.length > 0 && (
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">
              Existing combinations
            </p>
            <div className="space-y-2">
              {groups.map((group) => (
                <div
                  key={group.id}
                  className="flex items-start justify-between gap-3 border border-slate-200 rounded-xl px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">{group.name}</p>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      {group.members.map(displayName).join(' · ')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDelete(group)}
                    className="p-2 -mr-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer shrink-0"
                    aria-label={`Split "${group.name}" back into separate names`}
                    title="Split back into separate names"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppModal>
  );
}
