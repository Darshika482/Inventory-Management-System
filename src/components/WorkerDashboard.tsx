import React, { useState, useMemo } from 'react';
import { 
  Package, 
  Send, 
  History, 
  HardHat, 
  Info,
  CheckCircle,
  XCircle,
  AlertCircle,
  FileDown,
  Search
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Category, WithdrawalLog, User, Floor } from '../types';
import { FLOOR_OPTIONS, getFloorBadgeClass, getFloorShortLabel } from '../lib/floors';
import { groupCategoriesByNameAndFloor } from '../lib/groupCategories';
import { QuantityCalculation } from './QuantityCalculation';
import { categoryToSelectOption } from '../lib/selectOptions';
import { PremiumSelect } from './PremiumSelect';
import { AppModal } from './AppModal';
import { FormInput, FormError, ModalActions } from './FormInput';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

interface WorkerDashboardProps {
  currentUser: User;
  categories: Category[];
  logs: WithdrawalLog[];
  onWithdraw: (categoryId: string, quantity: number) => Promise<{ success: boolean; message: string }>;
}

export function WorkerDashboard({ currentUser, categories, logs, onWithdraw }: WorkerDashboardProps) {
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [quantity, setQuantity] = useState<number | ''>('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isWithdrawalOpen, setIsWithdrawalOpen] = useState(false);

  // Search filter states
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [directorySearch, setDirectorySearch] = useState('');
  const [floorFilter, setFloorFilter] = useState<'All' | Floor>('All');

  // Extract worker's own past submissions sorted by newest/sequential sequence
  const personalLogs = useMemo(() => {
    return logs
      .filter((log) => log.workerId === currentUser.username)
      .sort((a, b) => b.id.localeCompare(a.id)); // Newer first based on custom ID timestamp sequence
  }, [logs, currentUser.username]);

  // Filter personal logs by category name search matching
  const filteredPersonalLogs = useMemo(() => {
    return personalLogs.filter((log) =>
      log.categoryName.toLowerCase().includes(ledgerSearch.toLowerCase())
    );
  }, [personalLogs, ledgerSearch]);

  // Filter local directory categories by name
  const filteredCategories = useMemo(() => {
    return categories.filter((cat) => {
      const matchSearch =
        cat.name.toLowerCase().includes(directorySearch.toLowerCase()) ||
        cat.floor.toLowerCase().includes(directorySearch.toLowerCase());
      const matchFloor = floorFilter === 'All' ? true : cat.floor === floorFilter;
      return matchSearch && matchFloor;
    });
  }, [categories, directorySearch, floorFilter]);

  const groupedCategories = useMemo(
    () => groupCategoriesByNameAndFloor(filteredCategories),
    [filteredCategories]
  );

  const stockSelectOptions = useMemo(
    () => filteredCategories.map((cat) => categoryToSelectOption(cat, categories)),
    [filteredCategories, categories]
  );

  const renderFloorBadge = (floor: Floor) => (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-md border ${getFloorBadgeClass(floor)}`}
    >
      {getFloorShortLabel(floor)}
    </span>
  );

  // Download personal ledger details
  const downloadPersonalPDF = () => {
    try {
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      // Top banner
      doc.setFillColor(15, 23, 42); // slate-900 background
      doc.rect(0, 0, 210, 38, 'F');

      // Title
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(22);
      doc.text('AKSHAY TRADERS — MY TAKEN ITEMS', 14, 16);

      // Subtitle
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(245, 158, 11); // amber-500
      doc.text(`Staff: ${currentUser.username}  •  Downloaded: ${new Date().toLocaleString()}`, 14, 23);

      // Metrics block
      doc.setFontSize(10);
      doc.setTextColor(148, 163, 184); // slate-400
      doc.text(`Staff Member: ${currentUser.username.toUpperCase()}   |   Transactions Logged: ${personalLogs.length}   |   Approved: ${personalLogs.filter(l => l.status === 'Approved').length}`, 14, 30);

      // Bold orange divider line
      doc.setDrawColor(245, 158, 11);
      doc.setLineWidth(1);
      doc.line(0, 38, 210, 38);

      // Table mapping
      const tableHeaders = [['Reference', 'Item', 'Amount taken', 'When', 'Status']];
      
      const tableRows = personalLogs.map((log) => {
        return [
          log.id,
          log.categoryName,
          log.quantity.toString(),
          log.timestamp,
          log.status.toUpperCase()
        ];
      });

      autoTable(doc, {
        startY: 44,
        head: tableHeaders,
        body: tableRows,
        theme: 'striped',
        styles: {
          fontSize: 11,
          cellPadding: 3.5,
          overflow: 'linebreak',
        },
        headStyles: {
          fillColor: [15, 23, 42],
          textColor: [255, 255, 255],
          fontSize: 12,
          fontStyle: 'bold',
          halign: 'left',
        },
        bodyStyles: {
          fontSize: 11,
          textColor: [51, 65, 85],
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252],
        },
        columnStyles: {
          0: { cellWidth: 34, fontStyle: 'bold' },
          1: { cellWidth: 48, fontStyle: 'bold' },
          2: { cellWidth: 26, halign: 'right' },
          3: { cellWidth: 42 },
          4: { cellWidth: 28, fontStyle: 'bold' },
        },
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 4) {
            const val = data.cell.raw as string;
            if (val === 'APPROVED') {
              data.cell.styles.textColor = [22, 101, 52];
            } else {
              data.cell.styles.textColor = [153, 27, 27];
            }
          }
        },
        margin: { left: 14, right: 14 },
      });

      const pageCount = (doc as any).internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(10);
        doc.setTextColor(148, 163, 184);
        doc.text(`Page ${i} of ${pageCount}`, 14, 287);
        doc.text('Akshay Traders  •  Taken items report', 72, 287);
      }

      doc.save(`personal-requisition-report-${currentUser.username}-${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (err) {
      console.error('Personal log PDF export failed:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg('');
    setErrorMsg('');

    if (!selectedCategoryId) {
      setErrorMsg('Please choose an item.');
      return;
    }

    if (quantity === '' || quantity <= 0) {
      setErrorMsg('Please enter an amount greater than 0.');
      return;
    }

    const response = await onWithdraw(selectedCategoryId, Number(quantity));

    if (response.success) {
      setSuccessMsg(response.message);
      setSelectedCategoryId('');
      setQuantity('');
      setIsWithdrawalOpen(false); // Close modal on success
      
      // Clear success message after some seconds
      setTimeout(() => {
        setSuccessMsg('');
      }, 5000);
    } else {
      setErrorMsg(response.message);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#F8FAFC]/90 p-4 sm:p-6 md:p-8 space-y-6 sm:space-y-8 font-sans text-slate-900 selection:bg-amber-500 selection:text-white">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div className="min-w-0">
          <h2 className="font-sans text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Take stock
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Signed in as <span className="text-amber-700 font-bold">{currentUser.username}</span>
          </p>
        </div>
        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2.5 w-full sm:w-auto">
          <button
            onClick={() => {
              setErrorMsg('');
              setIsWithdrawalOpen(true);
            }}
            className="flex items-center justify-center gap-2 px-4 py-3 bg-[#0F172A] hover:bg-slate-800 text-white rounded-lg text-sm font-semibold shadow-xs cursor-pointer transition-all border border-slate-850"
          >
            <Send className="h-4 w-4" />
            Take items
          </button>
          <div className="text-sm text-slate-500 bg-white border border-slate-200 rounded-lg px-4 py-3 flex items-center justify-center sm:justify-start gap-2 shadow-2xs">
            <HardHat className="h-5 w-5 text-amber-600 shrink-0" />
            <span className="truncate">Ready to go</span>
          </div>
        </div>
      </div>

      {/* Main Grid: Split into History (8-cols) and Directory / Status (4-cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left column: Success state banner & Requisition History logs (width prioritized for tables) */}
        <div className="lg:col-span-8 space-y-6">
          
          <AnimatePresence mode="wait">
            {successMsg && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="bg-emerald-50 border border-emerald-200 text-emerald-700 p-4 rounded-lg text-base flex items-start gap-3 shadow-2xs"
              >
                <CheckCircle className="h-5 w-5 shrink-0 mt-0.5 text-emerald-600" />
                <div className="space-y-0.5">
                  <span className="font-bold block text-sm text-emerald-800">Saved successfully</span>
                  <p>{successMsg}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Personal Requisition Ledger Container */}
          <div className="bg-white border border-slate-200 rounded-lg p-4 sm:p-6 shadow-xs">
            <h3 className="text-base font-semibold text-slate-700 mb-4 flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <span className="p-1.5 rounded bg-slate-50 text-amber-600 border border-slate-100 shrink-0">
                  <History className="h-4 w-4" />
                </span>
                <span className="truncate">My taken items</span>
              </div>
              {personalLogs.length > 0 && (
                <button
                  onClick={downloadPersonalPDF}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg border bg-[#0F172A] hover:bg-slate-800 text-white border-slate-855 cursor-pointer transition-all shadow-2xs w-full sm:w-auto"
                  title="Download a PDF of your taken items"
                >
                  <FileDown className="h-4 w-4 text-amber-500" />
                  Download PDF
                </button>
              )}
            </h3>

            {/* Search Input */}
            <div className="mb-4">
              <div className="relative w-full">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by item name..."
                  value={ledgerSearch}
                  onChange={(e) => setLedgerSearch(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-3 py-3 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 transition-all font-sans"
                />
              </div>
            </div>

            {/* Mobile card list */}
            <div className="md:hidden divide-y divide-slate-100 border border-slate-100 rounded-lg overflow-hidden">
              {filteredPersonalLogs.length === 0 ? (
                <div className="p-6 text-center text-slate-400 italic text-sm">
                  {personalLogs.length === 0
                    ? 'You have not taken any items yet.'
                    : 'No items match your search.'}
                </div>
              ) : (
                filteredPersonalLogs.map((log) => (
                  <div
                    key={log.id}
                    className={`p-4 space-y-2 ${log.status === 'Rejected' ? 'opacity-60 line-through text-slate-400 bg-red-500/[0.01]' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-semibold text-slate-900 truncate">{log.categoryName}</p>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold rounded border shrink-0 ${
                        log.status === 'Approved'
                          ? 'bg-[#DCFCE7] text-[#166534] border-[#BBF7D0]'
                          : 'bg-[#FEE2E2] text-[#991B1B] border-[#FECACA]'
                      }`}>
                        {log.status === 'Approved' ? 'Approved' : 'Rejected'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">Amount taken</span>
                      <span className="font-bold">{log.quantity}</span>
                    </div>
                    <p className="text-[10px] text-slate-500">{log.timestamp}</p>
                  </div>
                ))
              )}
            </div>

            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-sm font-bold text-slate-500 select-none">
                    <th className="p-3 w-2/5">Item</th>
                    <th className="p-3 w-1/5">Amount taken</th>
                    <th className="p-3 w-1/3">When</th>
                    <th className="p-3 w-1/5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
                  <AnimatePresence>
                    {filteredPersonalLogs.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="p-8 text-center text-slate-400 italic">
                          {personalLogs.length === 0 
                            ? "You have not taken any items yet."
                            : "No items match your search."}
                        </td>
                      </tr>
                    ) : (
                      filteredPersonalLogs.map((log) => (
                        <motion.tr 
                          key={log.id} 
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className={`hover:bg-slate-50/50 transition-colors ${
                            log.status === 'Rejected' ? 'line-through text-slate-400 bg-red-500/[0.01]' : ''
                          }`}
                        >
                          <td className="p-3 font-semibold text-slate-900 whitespace-nowrap overflow-hidden text-ellipsis">
                            {log.categoryName}
                          </td>
                          <td className="p-3 font-bold text-slate-800">
                            {log.quantity}
                          </td>
                          <td className="p-3 text-[10px] text-slate-505">
                            {log.timestamp}
                          </td>
                          <td className="p-3">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold rounded border ${
                              log.status === 'Approved'
                                ? 'bg-[#DCFCE7] text-[#166534] border-[#BBF7D0]'
                                : 'bg-[#FEE2E2] text-[#991B1B] border-[#FECACA]'
                            }`}>
                              {log.status === 'Approved' ? 'Approved' : 'Rejected'}
                            </span>
                          </td>
                        </motion.tr>
                      ))
                    )}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          </div>
          
        </div>

        {/* Right column: Reference Directory & Compliance instructions */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Active Inventory list */}
          <div className="bg-white border border-slate-200 rounded-lg p-4 sm:p-6 shadow-xs">
            <h3 className="text-base font-semibold text-slate-700 mb-2 flex items-center gap-2">
              <span className="p-1.5 rounded bg-slate-50 text-amber-600 border border-slate-100">
                <Package className="h-4 w-4" />
              </span>
              Available stock
            </h3>

            {/* Search Input */}
            <div className="mb-4">
              <div className="relative w-full">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search items..."
                  value={directorySearch}
                  onChange={(e) => setDirectorySearch(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-3 py-3 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 transition-all font-sans"
                />
              </div>
            </div>

            {/* Floor filter */}
            <div className="mb-4 inline-flex rounded-md bg-slate-50 p-0.5 border border-slate-200 w-full">
              {(['All', ...FLOOR_OPTIONS] as const).map((floor) => (
                <button
                  key={floor}
                  type="button"
                  onClick={() => setFloorFilter(floor)}
                  className={`flex-1 px-2 py-2 text-sm rounded font-semibold cursor-pointer transition-colors ${
                    floorFilter === floor
                      ? 'bg-[#0F172A] text-white font-bold shadow-xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {floor === 'All' ? 'All Floors' : floor.replace(' Floor', '')}
                </button>
              ))}
            </div>

            <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
              {groupedCategories.length === 0 ? (
                <div className="p-6 text-center text-slate-400 italic text-sm">
                  {categories.length === 0
                    ? "No items in stock yet."
                    : "No items match your search."}
                </div>
              ) : (
                groupedCategories.map((group) => (
                  <div key={group.key} className="bg-slate-50 border border-slate-200 rounded-lg overflow-hidden text-sm">
                    <div className="px-3 py-2.5 border-b border-slate-200 bg-white">
                      <span className="font-bold text-slate-900 block truncate">{group.name}</span>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {renderFloorBadge(group.floor)}
                        {group.variants.length > 1 && (
                          <span className="text-xs text-slate-400 font-medium">
                            {group.variants.length} units
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="divide-y divide-slate-200">
                      {group.variants.map((cat) => (
                        <div
                          key={cat.id}
                          className="flex items-center justify-between gap-3 px-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <span className="text-sm text-slate-600 block">{cat.unit}</span>
                            <span className="text-sm font-bold text-slate-900 tabular-nums">{cat.currentQuantity} left</span>
                          </div>
                          <span className="text-xs text-slate-400 tabular-nums shrink-0">
                            <QuantityCalculation
                              unit={cat.unit}
                              count={cat.currentQuantity}
                              className="text-xs text-slate-400 tabular-nums"
                            />
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Guidelines instruction card */}
          <div className="bg-slate-50 border border-slate-200 p-5 rounded-lg flex gap-3 text-slate-600 text-sm leading-relaxed">
            <Info className="h-5 w-5 text-amber-600 shrink-0" />
            <div className="space-y-1">
              <span className="font-bold text-slate-700 block">How it works</span>
              <p>When you take items, the count goes down right away. If you ask for more than what is left, you will see an error message.</p>
            </div>
          </div>

        </div>

      </div>

      <AppModal
        open={isWithdrawalOpen}
        onClose={() => setIsWithdrawalOpen(false)}
        title="Take items"
        description="Record what you are taking from stock"
        icon={<Send className="h-5 w-5" />}
        accent="slate"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {errorMsg && <FormError message={errorMsg} />}

          <PremiumSelect
            label="Which item"
            value={selectedCategoryId}
            onChange={setSelectedCategoryId}
            options={stockSelectOptions}
            placeholder="Choose an item..."
            searchable
            searchPlaceholder="Search items..."
            accent="slate"
            required
            name="withdrawItem"
          />

          <FormInput
            label="How many"
            type="number"
            required
            min={1}
            placeholder="e.g. 5"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value === '' ? '' : Number(e.target.value))}
            accent="slate"
          />

          <ModalActions
            onCancel={() => setIsWithdrawalOpen(false)}
            submitLabel="Confirm"
            submitAccent="slate"
          />
        </form>
      </AppModal>

    </div>
  );
}
