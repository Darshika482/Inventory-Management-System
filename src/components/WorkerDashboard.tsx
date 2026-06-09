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
  X,
  FileDown,
  Search
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Category, WithdrawalLog, User } from '../types';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

interface WorkerDashboardProps {
  currentUser: User;
  categories: Category[];
  logs: WithdrawalLog[];
  onWithdraw: (categoryId: string, quantity: number) => { success: boolean, message: string };
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
    return categories.filter((cat) =>
      cat.name.toLowerCase().includes(directorySearch.toLowerCase())
    );
  }, [categories, directorySearch]);

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
      doc.setFontSize(18);
      doc.text('PERSONAL REQUISITION LEDGER REPORT', 14, 15);

      // Subtitle
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(245, 158, 11); // amber-500
      doc.text(`Authorized Personnel Summary  •  Generated on: ${new Date().toLocaleString()}`, 14, 21);

      // Metrics block
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184); // slate-400
      doc.text(`Authorized Worker ID: ${currentUser.username.toUpperCase()}   |   Transactions Logged: ${personalLogs.length}   |   Approved: ${personalLogs.filter(l => l.status === 'Approved').length}`, 14, 27);

      // Bold orange divider line
      doc.setDrawColor(245, 158, 11);
      doc.setLineWidth(1);
      doc.line(0, 38, 210, 38);

      // Table mapping
      const tableHeaders = [['Requisition Ledger ID', 'Item Category Name', 'Quantity Disbursed', 'Logged Timestamp', 'Allocation Status']];
      
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
        startY: 46,
        head: tableHeaders,
        body: tableRows,
        theme: 'striped',
        headStyles: {
          fillColor: [15, 23, 42],
          textColor: [255, 255, 255],
          fontSize: 8,
          fontStyle: 'bold',
          halign: 'left'
        },
        bodyStyles: {
          fontSize: 8,
          textColor: [51, 65, 85]
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252]
        },
        columnStyles: {
          0: { cellWidth: 35, fontStyle: 'bold' },
          1: { cellWidth: 55, fontStyle: 'bold' },
          2: { cellWidth: 25, halign: 'right' },
          3: { cellWidth: 45 },
          4: { cellWidth: 25, fontStyle: 'bold' }
        },
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 4) {
            const val = data.cell.raw as string;
            if (val === 'APPROVED') {
              data.cell.styles.textColor = [22, 101, 52]; // green-800
            } else {
              data.cell.styles.textColor = [153, 27, 27]; // red-800
            }
          }
        },
        margin: { left: 14, right: 14 }
      });

      const pageCount = (doc as any).internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text(`Page ${i} of ${pageCount}`, 14, 287);
        doc.text('Secure Administrative Audit  •  Shift Requisition Receipt  •  Verification Signed', 72, 287);
      }

      doc.save(`personal-requisition-report-${currentUser.username}-${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (err) {
      console.error('Personal log PDF export failed:', err);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg('');
    setErrorMsg('');

    if (!selectedCategoryId) {
      setErrorMsg('Please select an inventory category.');
      return;
    }

    if (quantity === '' || quantity <= 0) {
      setErrorMsg('Please enter a valid transfer quantity (> 0).');
      return;
    }

    const response = onWithdraw(selectedCategoryId, Number(quantity));

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
          <h2 className="font-sans text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Worker Stock Dispatch
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Requisition terminal authorized for: <span className="text-amber-700 font-bold">{currentUser.username}</span>
          </p>
        </div>
        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2.5 w-full sm:w-auto">
          <button
            onClick={() => {
              setErrorMsg('');
              setIsWithdrawalOpen(true);
            }}
            className="flex items-center justify-center gap-1.5 px-3 py-2 sm:py-1.5 bg-[#0F172A] hover:bg-slate-800 text-white rounded-md text-xs font-semibold shadow-xs cursor-pointer transition-all border border-slate-850"
          >
            <Send className="h-3.5 w-3.5" />
            Request Withdrawal
          </button>
          <div className="text-xs font-mono text-slate-500 bg-white border border-slate-200 rounded-md px-3 py-2 sm:py-1.5 flex items-center justify-center sm:justify-start gap-2 shadow-2xs">
            <HardHat className="h-4 w-4 text-amber-600 shrink-0" />
            <span className="truncate">Shift Status: Live & Monitored</span>
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
                className="bg-emerald-50 border border-emerald-200 text-emerald-700 p-4 rounded-lg text-xs flex items-start gap-2.5 shadow-2xs"
              >
                <CheckCircle className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600" />
                <div className="space-y-0.5">
                  <span className="font-bold uppercase block text-[10px] tracking-wider text-emerald-800">Withdrawal Registered Successfully</span>
                  <p>{successMsg}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Personal Requisition Ledger Container */}
          <div className="bg-white border border-slate-200 rounded-lg p-4 sm:p-6 shadow-xs">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700 mb-4 flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <span className="p-1 rounded bg-slate-50 text-amber-600 border border-slate-100 shrink-0">
                  <History className="h-3.5 w-3.5" />
                </span>
                <span className="truncate">Personal Requisition Ledger</span>
              </div>
              {personalLogs.length > 0 && (
                <button
                  onClick={downloadPersonalPDF}
                  className="flex items-center justify-center gap-1 px-2.5 py-1.5 sm:py-1 text-[10px] font-bold uppercase rounded border bg-[#0F172A] hover:bg-slate-800 text-white border-slate-855 cursor-pointer transition-all shadow-2xs w-full sm:w-auto"
                  title="Download personal requisition log report in PDF"
                >
                  <FileDown className="h-3 w-3 text-amber-500" />
                  PDF Download
                </button>
              )}
            </h3>

            {/* Search Input */}
            <div className="mb-4">
              <div className="relative w-full">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter transactions by category name..."
                  value={ledgerSearch}
                  onChange={(e) => setLedgerSearch(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded pl-8 pr-3 py-2 sm:py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 transition-all font-sans"
                />
              </div>
            </div>

            {/* Mobile card list */}
            <div className="md:hidden divide-y divide-slate-100 border border-slate-100 rounded-lg overflow-hidden">
              {filteredPersonalLogs.length === 0 ? (
                <div className="p-6 text-center text-slate-400 italic text-xs">
                  {personalLogs.length === 0
                    ? 'No transaction telemetry logged yet in this shift.'
                    : 'No transactions match your search filter.'}
                </div>
              ) : (
                filteredPersonalLogs.map((log) => (
                  <div
                    key={log.id}
                    className={`p-4 space-y-2 ${log.status === 'Rejected' ? 'opacity-60 line-through text-slate-400 bg-red-500/[0.01]' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-semibold text-slate-900 truncate">{log.categoryName}</p>
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-bold rounded uppercase border shrink-0 ${
                        log.status === 'Approved'
                          ? 'bg-[#DCFCE7] text-[#166534] border-[#BBF7D0]'
                          : 'bg-[#FEE2E2] text-[#991B1B] border-[#FECACA]'
                      }`}>
                        {log.status === 'Approved' ? 'Approved' : 'Rejected'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">Disbursed</span>
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
                  <tr className="bg-slate-50 border-b border-slate-200 text-[9px] font-bold text-slate-500 uppercase tracking-widest select-none">
                    <th className="p-3 w-2/5">Category</th>
                    <th className="p-3 w-1/5">Disbursed</th>
                    <th className="p-3 w-1/3">Occurred on</th>
                    <th className="p-3 w-1/5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                  <AnimatePresence>
                    {filteredPersonalLogs.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="p-8 text-center text-slate-400 italic">
                          {personalLogs.length === 0 
                            ? "No transaction telemetry logged yet in this shift."
                            : "No transactions match your search filter."}
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
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-bold rounded uppercase border ${
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
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700 mb-2 flex items-center gap-2">
              <span className="p-1 rounded bg-slate-50 text-amber-600 border border-slate-100">
                <Package className="h-3.5 w-3.5" />
              </span>
              Active Inventory Directory
            </h3>

            {/* Search Input */}
            <div className="mb-4">
              <div className="relative w-full">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter key category name..."
                  value={directorySearch}
                  onChange={(e) => setDirectorySearch(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded pl-8 pr-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 transition-all font-sans"
                />
              </div>
            </div>

            <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
              {filteredCategories.length === 0 ? (
                <div className="p-6 text-center text-slate-400 italic text-xs">
                  {categories.length === 0
                    ? "No inventory categories available."
                    : "No categories match your search filter."}
                </div>
              ) : (
                filteredCategories.map((cat) => (
                  <div key={cat.id} className="bg-slate-50 border border-slate-200 rounded p-3 flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-900">{cat.name}</span>
                    <span className="text-[10px] text-slate-500 border border-slate-200 px-1.5 py-0.5 rounded bg-white font-semibold">
                      unit: {cat.unit}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Guidelines instruction card */}
          <div className="bg-slate-50 border border-slate-200 p-5 rounded-lg flex gap-3 text-slate-600 text-xs leading-relaxed">
            <Info className="h-5 w-5 text-amber-600 shrink-0" />
            <div className="space-y-1">
              <span className="font-bold text-slate-700 uppercase block">Guidance & Compliance</span>
              <p>Each transaction instantly decrements global quantities. Overdraft logs will be flagged and rejected by shift manager.</p>
            </div>
          </div>

        </div>

      </div>

      {/* Requisition Withdrawal Modal */}
      <AnimatePresence>
        {isWithdrawalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop Blur Layer */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsWithdrawalOpen(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
            />
            
            {/* Modal Body Container */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              className="bg-white border border-slate-200 shadow-2xl rounded-xl w-full max-w-sm overflow-hidden relative z-10"
            >
              <div className="h-1 bg-amber-500 w-full" />
              
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="p-1 px-1.5 rounded bg-slate-50 text-amber-600 border border-slate-100">
                    <Send className="h-4 w-4" />
                  </span>
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Register Withdrawal
                  </h3>
                </div>
                <button
                  onClick={() => setIsWithdrawalOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-600 transition-colors rounded hover:bg-slate-50 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                {errorMsg && (
                  <div className="bg-red-50 border border-red-200 text-red-600 p-2.5 text-xs rounded flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider">
                    Category Name
                  </label>
                  <select
                    required
                    value={selectedCategoryId}
                    onChange={(e) => setSelectedCategoryId(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-[#0F172A] transition-colors"
                  >
                    <option value="">-- Choose Category --</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name} ({cat.unit})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider">
                    Quantity Demanded
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    placeholder="e.g. 5"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full bg-white border border-slate-200 rounded px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-[#0F172A] transition-colors"
                  />
                </div>

                <div className="pt-4 flex items-center justify-end gap-2 border-t border-slate-100 mt-4">
                  <button
                    type="button"
                    onClick={() => setIsWithdrawalOpen(false)}
                    className="px-4 py-2 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-md text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-[#0F172A] hover:bg-slate-800 text-white rounded-md font-semibold text-xs uppercase tracking-wider transition-all cursor-pointer"
                  >
                    Commit Allocation
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
