import React, { useState, useMemo } from 'react';
import { 
  Plus, 
  Trash2, 
  Pencil,
  ArrowUpDown, 
  Search, 
  AlertTriangle, 
  RotateCcw, 
  ClipboardList, 
  TrendingDown, 
  Layers, 
  Database,
  ArrowUpRight,
  Filter,
  CheckCircle2,
  XCircle,
  HardHat,
  X,
  FileDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Category, WithdrawalLog, Floor } from '../types';
import { FLOOR_OPTIONS, getFloorBadgeClass } from '../lib/floors';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

interface AdminDashboardProps {
  categories: Category[];
  logs: WithdrawalLog[];
  onAddStock: (categoryId: string, quantity: number) => void;
  onAddNewCategory: (name: string, unit: string, initialStock: number, floor: Floor) => void;
  onUpdateCategory: (
    categoryId: string,
    updates: { name: string; unit: string; floor: Floor; initialStock: number; currentQuantity: number }
  ) => void;
  onDeleteCategory: (categoryId: string) => void;
  onToggleLogStatus: (logId: string) => void;
  activeSection: string;
}

type SortFieldCategory = 'name' | 'stock' | 'percentage';
type SortFieldLog = 'worker' | 'category' | 'quantity' | 'timestamp' | 'status';

export function AdminDashboard({ 
  categories, 
  logs, 
  onAddStock, 
  onAddNewCategory,
  onUpdateCategory,
  onDeleteCategory,
  onToggleLogStatus,
  activeSection 
}: AdminDashboardProps) {
  
  // Category Form State
  const [newCatName, setNewCatName] = useState('');
  const [newCatUnit, setNewCatUnit] = useState('pieces');
  const [newCatFloor, setNewCatFloor] = useState<Floor>('First Floor');
  const [newCatInitial, setNewCatInitial] = useState<number | ''>('');
  const [catError, setCatError] = useState('');

  // Restock Form State
  const [selectedCatIdForRestock, setSelectedCatIdForRestock] = useState('');
  const [restockAmount, setRestockAmount] = useState<number | ''>('');
  const [restockError, setRestockError] = useState('');

  // Modals visibility state
  const [isAddCategoryOpen, setIsAddCategoryOpen] = useState(false);
  const [isRestockOpen, setIsRestockOpen] = useState(false);
  const [isEditCategoryOpen, setIsEditCategoryOpen] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editCatName, setEditCatName] = useState('');
  const [editCatUnit, setEditCatUnit] = useState('');
  const [editCatFloor, setEditCatFloor] = useState<Floor>('First Floor');
  const [editCatInitial, setEditCatInitial] = useState<number | ''>('');
  const [editCatCurrent, setEditCatCurrent] = useState<number | ''>('');
  const [editError, setEditError] = useState('');
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null);

  // Table Search and Sorting States
  const [categorySearch, setCategorySearch] = useState('');
  const [floorFilter, setFloorFilter] = useState<'All' | Floor>('All');
  const [lowStockFilterOnly, setLowStockFilterOnly] = useState(false);
  const [catSortField, setCatSortField] = useState<SortFieldCategory>('name');
  const [catSortDirection, setCatSortDirection] = useState<'asc' | 'desc'>('asc');

  const [logSearch, setLogSearch] = useState('');
  const [logStatusFilter, setLogStatusFilter] = useState<'All' | 'Approved' | 'Rejected'>('All');
  const [logSortField, setLogSortField] = useState<SortFieldLog>('timestamp');
  const [logSortDirection, setLogSortDirection] = useState<'asc' | 'desc'>('desc');

  // Compute Summary Statistics
  const stats = useMemo(() => {
    const totalCategories = categories.length;
    const totalItemsInStock = categories.reduce((sum, cat) => sum + cat.currentQuantity, 0);
    const totalWithdrawals = logs.filter(l => l.status === 'Approved').reduce((sum, log) => sum + log.quantity, 0);
    const lowStockItems = categories.filter((cat) => cat.currentQuantity < cat.initialStock * 0.2).length;

    return {
      totalCategories,
      totalItemsInStock,
      totalWithdrawals,
      lowStockItems
    };
  }, [categories, logs]);

  // Handle addition of new category
  const handleAddCategorySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setCatError('');

    if (!newCatName.trim()) {
      setCatError('Category name is required.');
      return;
    }

    if (newCatInitial === '' || newCatInitial < 0) {
      setCatError('Initial stock must be a non-negative number.');
      return;
    }

    const nameExists = categories.some(
      (c) =>
        c.name.toLowerCase() === newCatName.trim().toLowerCase() &&
        c.floor === newCatFloor
    );
    if (nameExists) {
      setCatError('Category with this name already exists on this floor.');
      return;
    }

    onAddNewCategory(newCatName.trim(), newCatUnit.trim(), Number(newCatInitial), newCatFloor);
    setNewCatName('');
    setNewCatInitial('');
    setNewCatUnit('pieces');
    setNewCatFloor('First Floor');
    setIsAddCategoryOpen(false);
  };

  // Handle restock
  const handleRestockSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setRestockError('');

    if (!selectedCatIdForRestock) {
      setRestockError('Please select a category.');
      return;
    }

    if (restockAmount === '' || restockAmount <= 0) {
      setRestockError('Please enter a quantity greater than 0.');
      return;
    }

    onAddStock(selectedCatIdForRestock, Number(restockAmount));
    setRestockAmount('');
    setSelectedCatIdForRestock('');
    setIsRestockOpen(false);
  };

  const openEditModal = (cat: Category) => {
    setEditingCategoryId(cat.id);
    setEditCatName(cat.name);
    setEditCatUnit(cat.unit);
    setEditCatFloor(cat.floor);
    setEditCatInitial(cat.initialStock);
    setEditCatCurrent(cat.currentQuantity);
    setEditError('');
    setIsEditCategoryOpen(true);
  };

  const closeEditModal = () => {
    setIsEditCategoryOpen(false);
    setEditingCategoryId(null);
    setEditError('');
  };

  const handleEditCategorySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setEditError('');

    if (!editingCategoryId) return;

    if (!editCatName.trim()) {
      setEditError('Category name is required.');
      return;
    }

    if (editCatInitial === '' || editCatInitial < 0) {
      setEditError('Initial stock must be a non-negative number.');
      return;
    }

    if (editCatCurrent === '' || editCatCurrent < 0) {
      setEditError('Current stock must be a non-negative number.');
      return;
    }

    const nameExists = categories.some(
      (c) =>
        c.id !== editingCategoryId &&
        c.name.toLowerCase() === editCatName.trim().toLowerCase() &&
        c.floor === editCatFloor
    );
    if (nameExists) {
      setEditError('Another category with this name already exists on this floor.');
      return;
    }

    onUpdateCategory(editingCategoryId, {
      name: editCatName.trim(),
      unit: editCatUnit.trim() || 'pieces',
      floor: editCatFloor,
      initialStock: Number(editCatInitial),
      currentQuantity: Number(editCatCurrent),
    });
    closeEditModal();
  };

  const handleDeleteConfirm = () => {
    if (!deletingCategoryId) return;
    onDeleteCategory(deletingCategoryId);
    setDeletingCategoryId(null);
  };

  const deletingCategory = deletingCategoryId
    ? categories.find((c) => c.id === deletingCategoryId)
    : null;

  const renderCategoryActions = (cat: Category) => (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => openEditModal(cat)}
        title="Edit category"
        className="p-1.5 text-slate-500 hover:text-amber-700 bg-white border border-slate-200 rounded shadow-2xs hover:border-amber-300 transition-colors cursor-pointer"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => setDeletingCategoryId(cat.id)}
        title="Delete category"
        className="p-1.5 text-slate-500 hover:text-red-600 bg-white border border-slate-200 rounded shadow-2xs hover:border-red-200 transition-colors cursor-pointer"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  const renderFloorBadge = (floor: Floor) => (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[9px] font-bold rounded-full border uppercase tracking-wider ${getFloorBadgeClass(floor)}`}
    >
      {floor}
    </span>
  );

  // Helper to determine the stock health color badge
  const getStockStatus = (current: number, initial: number) => {
    const ratio = current / initial;
    if (ratio < 0.2) {
      return {
        label: 'Critical',
        bg: 'bg-[#FEE2E2] text-[#991B1B] border-[#FECACA]',
        text: 'text-red-600',
        indicator: 'bg-[#991B1B]',
        tooltip: 'Below 20% of initial capacity'
      };
    }
    if (ratio < 0.5) {
      return {
        label: 'Low',
        bg: 'bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]',
        text: 'text-amber-600',
        indicator: 'bg-[#92400E]',
        tooltip: 'Below 50% of initial capacity'
      };
    }
    return {
      label: 'Healthy',
      bg: 'bg-[#DCFCE7] text-[#166534] border-[#BBF7D0]',
      text: 'text-emerald-700',
      indicator: 'bg-[#166534]',
      tooltip: 'Optimal storage density'
    };
  };

  // Filter & sort categories
  const filteredAndSortedCategories = useMemo(() => {
    let result = categories.filter((cat) => {
      const matchSearch =
        cat.name.toLowerCase().includes(categorySearch.toLowerCase()) ||
        cat.unit.toLowerCase().includes(categorySearch.toLowerCase()) ||
        cat.floor.toLowerCase().includes(categorySearch.toLowerCase());
      const matchFloor = floorFilter === 'All' ? true : cat.floor === floorFilter;
      const isLowStock = cat.currentQuantity < cat.initialStock * 0.2;
      return lowStockFilterOnly ? matchSearch && matchFloor && isLowStock : matchSearch && matchFloor;
    });

    result.sort((a, b) => {
      let multiplier = catSortDirection === 'asc' ? 1 : -1;
      
      if (catSortField === 'name') {
        return a.name.localeCompare(b.name) * multiplier;
      }
      if (catSortField === 'stock') {
        return (a.currentQuantity - b.currentQuantity) * multiplier;
      }
      if (catSortField === 'percentage') {
        const percentA = (a.currentQuantity / a.initialStock);
        const percentB = (b.currentQuantity / b.initialStock);
        return (percentA - percentB) * multiplier;
      }
      return 0;
    });

    return result;
  }, [categories, categorySearch, floorFilter, lowStockFilterOnly, catSortField, catSortDirection]);

  // Filter & sort logs
  const filteredAndSortedLogs = useMemo(() => {
    let result = logs.filter((log) => {
      const matchSearch = log.workerId.toLowerCase().includes(logSearch.toLowerCase()) ||
                          log.categoryName.toLowerCase().includes(logSearch.toLowerCase()) ||
                          log.timestamp.toLowerCase().includes(logSearch.toLowerCase());
      
      const matchStatus = logStatusFilter === 'All' ? true : log.status === logStatusFilter;
      return matchSearch && matchStatus;
    });

    result.sort((a, b) => {
      let multiplier = logSortDirection === 'asc' ? 1 : -1;

      if (logSortField === 'worker') {
        return a.workerId.localeCompare(b.workerId) * multiplier;
      }
      if (logSortField === 'category') {
        return a.categoryName.localeCompare(b.categoryName) * multiplier;
      }
      if (logSortField === 'quantity') {
        return (a.quantity - b.quantity) * multiplier;
      }
      if (logSortField === 'timestamp') {
        // Since we are sorting formatted human readable string, let's reverse parse if possible, 
        // or since we have standard date elements, rely on timestamp fallback or reverse order.
        // As a fallback, we can use ID which is sequential or custom timestamp string sorting.
        // Actually since IDs are sequence numbers, we can sort by ID.
        return a.id.localeCompare(b.id) * multiplier;
      }
      if (logSortField === 'status') {
        return a.status.localeCompare(b.status) * multiplier;
      }
      return 0;
    });

    return result;
  }, [logs, logSearch, logStatusFilter, logSortField, logSortDirection]);

  const toggleSortCategories = (field: SortFieldCategory) => {
    if (catSortField === field) {
      setCatSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setCatSortField(field);
      setCatSortDirection('asc');
    }
  };

  const toggleSortLogs = (field: SortFieldLog) => {
    if (logSortField === field) {
      setLogSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setLogSortField(field);
      setLogSortDirection('asc');
    }
  };

  // Download full/filtered inventory PDF
  const downloadInventoryPDF = () => {
    try {
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      // Title & Header section
      doc.setFillColor(15, 23, 42); // slate-900 background for top banner
      doc.rect(0, 0, 210, 38, 'F');

      // Title text
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(22);
      doc.text('INVENTORY LOGISTICS STATUS REPORT', 14, 16);

      // Subtitle
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(245, 158, 11); // amber-500
      doc.text(`Shift Status: Active & Authenticated  •  Generated on: ${new Date().toLocaleString()}`, 14, 23);

      // Summary indicators in header banner
      doc.setFontSize(10);
      doc.setTextColor(148, 163, 184); // slate-400
      doc.text(`Total Stock Categories: ${stats.totalCategories}   |   Total Units In Stock: ${stats.totalItemsInStock}   |   Low Stock Warnings: ${stats.lowStockItems}`, 14, 30);

      // Accent border below banner
      doc.setDrawColor(245, 158, 11);
      doc.setLineWidth(1);
      doc.line(0, 38, 210, 38);

      // Table mapping
      const tableHeaders = [['Inventory Line Item', 'Floor', 'Measuring Unit', 'Total Stock', 'Stock Remaining', 'Remaining %', 'Logistics Status']];
      
      const tableRows = filteredAndSortedCategories.map((cat) => {
        const ratio = cat.currentQuantity / cat.initialStock;
        const percentage = cat.initialStock > 0
          ? Math.min(100, Math.round(ratio * 100))
          : 0;
        let status = 'HEALTHY';
        if (ratio < 0.2) {
          status = 'CRITICAL ALERT';
        } else if (ratio < 0.5) {
          status = 'LOW SUPPLY';
        }
        return [
          cat.name,
          cat.floor,
          cat.unit,
          cat.initialStock.toLocaleString(),
          cat.currentQuantity.toLocaleString(),
          `${percentage}%`,
          status
        ];
      });

      // Render Table using autotable
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
          0: { cellWidth: 38, fontStyle: 'bold' },
          1: { cellWidth: 26 },
          2: { cellWidth: 22, halign: 'center' },
          3: { cellWidth: 24, halign: 'right' },
          4: { cellWidth: 26, halign: 'right' },
          5: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
          6: { cellWidth: 24, fontStyle: 'bold' },
        },
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 6) {
            const val = data.cell.raw as string;
            if (val === 'CRITICAL ALERT') {
              data.cell.styles.textColor = [153, 27, 27];
            } else if (val === 'LOW SUPPLY') {
              data.cell.styles.textColor = [146, 64, 14];
            } else {
              data.cell.styles.textColor = [22, 101, 52];
            }
          }
        },
        margin: { left: 14, right: 14 },
      });

      // Footer signatures
      const pageCount = (doc as any).internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(10);
        doc.setTextColor(148, 163, 184); // slate-400
        doc.text(`Page ${i} of ${pageCount}`, 14, 287);
        doc.text('Secure Administrative Report  •  Inventory Dispatch Terminal  •  Verification Signed', 72, 287);
      }

      doc.save(`inventory-status-report-${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (err) {
      console.error('Inventory log PDF generation error:', err);
    }
  };

  // Download complete/filtered withdrawal transaction logs PDF
  const downloadLogsPDF = () => {
    try {
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      // Banner configuration
      doc.setFillColor(15, 23, 42); // slate-900 background for top banner
      doc.rect(0, 0, 210, 38, 'F');

      // Title
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(22);
      doc.text('WITHDRAWAL TRANSACTION LEDGER LOGS', 14, 16);

      // Subtitle
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(245, 158, 11); // amber-500
      doc.text(`Full Operational Audit Trail  •  Generated on: ${new Date().toLocaleString()}`, 14, 23);

      // Metric lines
      doc.setFontSize(10);
      doc.setTextColor(148, 163, 184); // slate-400
      doc.text(`Total Audit Actions Listed: ${filteredAndSortedLogs.length}   |   Approved Withdrawals: ${logs.filter(l => l.status === 'Approved').length}   |   Rejected/Reverted: ${logs.filter(l => l.status === 'Rejected').length}`, 14, 30);

      // Border line accent
      doc.setDrawColor(245, 158, 11);
      doc.setLineWidth(1);
      doc.line(0, 38, 210, 38);

      // Table mapping
      const tableHeaders = [['Action Ledger ID', 'Staff Member', 'Category Disbursed', 'Units Taken', 'Timestamp', 'Audit Status']];
      
      const tableRows = filteredAndSortedLogs.map((log) => {
        return [
          log.id,
          log.workerId,
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
          0: { cellWidth: 32, fontStyle: 'bold' },
          1: { cellWidth: 28 },
          2: { cellWidth: 38, fontStyle: 'bold' },
          3: { cellWidth: 22, halign: 'right' },
          4: { cellWidth: 38 },
          5: { cellWidth: 24, fontStyle: 'bold' },
        },
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 5) {
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
        doc.text('Secure Administrative Audit  •  Inventory Dispatch Terminal  •  Verification Signed', 85, 287);
      }

      doc.save(`audit-reconciliation-ledger-${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (err) {
      console.error('Audit PDF export failed:', err);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#F8FAFC] p-4 sm:p-6 md:p-8 space-y-6 sm:space-y-8 font-sans text-slate-900 selection:bg-amber-500 selection:text-white">
      
      {/* Dynamic Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div className="min-w-0">
          <h2 className="font-sans text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Admin Control Center
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Real-time analytics and inventory reconciliation tools
          </p>
        </div>
        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2.5 w-full sm:w-auto">
          <button
            onClick={() => setIsAddCategoryOpen(true)}
            className="flex items-center justify-center gap-1.5 px-3 py-2 sm:py-1.5 bg-[#0F172A] hover:bg-slate-800 text-white rounded-md text-xs font-semibold shadow-xs cursor-pointer transition-all border border-slate-850"
          >
            <Plus className="h-3.5 w-3.5" />
            Provision Category
          </button>
          <button
            onClick={() => setIsRestockOpen(true)}
            className="flex items-center justify-center gap-1.5 px-3 py-2 sm:py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-md text-xs font-semibold shadow-xs cursor-pointer transition-all border border-amber-600/10"
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
            Inject Stock
          </button>
          <div className="text-xs font-mono text-slate-500 px-3 py-2 sm:py-1.5 bg-white border border-slate-200 rounded-md flex items-center justify-center sm:justify-start gap-2 shadow-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            System Live
          </div>
        </div>
      </div>

      {/* High-Contrast Summary Stats Cards (Bento style) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1 */}
        <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-xs flex items-start justify-between relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-3 text-slate-100 group-hover:text-amber-500/10 transition-colors pointer-events-none">
            <Layers className="h-16 w-16 -mr-4 -mt-4 font-black" />
          </div>
          <div className="space-y-1 z-10">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Total Categories
            </p>
            <h3 className="font-sans text-3xl font-bold text-slate-900 tracking-tight">
              {stats.totalCategories}
            </h3>
            <p className="text-[11px] text-slate-400">
              Active stock line items
            </p>
          </div>
        </div>

        {/* Card 2 */}
        <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-xs flex items-start justify-between relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-3 text-slate-100 group-hover:text-amber-500/10 transition-colors pointer-events-none">
            <Database className="h-16 w-16 -mr-4 -mt-4 font-black" />
          </div>
          <div className="space-y-1 z-10">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Total Units
            </p>
            <h3 className="font-sans text-3xl font-bold text-slate-900 tracking-tight">
              {stats.totalItemsInStock.toLocaleString()}
            </h3>
            <p className="text-[11px] text-slate-400">
              Across all categories
            </p>
          </div>
        </div>

        {/* Card 3 */}
        <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-xs flex items-start justify-between relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-3 text-slate-100 group-hover:text-amber-500/10 transition-colors pointer-events-none">
            <ArrowUpRight className="h-16 w-16 -mr-4 -mt-4 font-black" />
          </div>
          <div className="space-y-1 z-10">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Total Disbursed
            </p>
            <h3 className="font-sans text-3xl font-bold text-amber-600 tracking-tight">
              {stats.totalWithdrawals.toLocaleString()}
            </h3>
            <p className="text-[11px] text-slate-400">
              Approved transactions
            </p>
          </div>
        </div>

        {/* Card 4 - Low Stock Panel */}
        <div className={`p-5 rounded-lg border shadow-xs flex items-start justify-between relative overflow-hidden group transition-all duration-300 ${
          stats.lowStockItems > 0 
            ? 'bg-amber-50/50 border-amber-200' 
            : 'bg-white border-slate-200'
        }`}>
          <div className="absolute top-0 right-0 p-3 text-slate-100 pointer-events-none">
            <AlertTriangle className="h-16 w-16 -mr-4 -mt-4 font-black" />
          </div>
          <div className="space-y-1 z-10">
            <p className={`text-xs font-semibold uppercase tracking-wider ${stats.lowStockItems > 0 ? 'text-amber-800' : 'text-slate-500'}`}>
              Low Stock Alerts
            </p>
            <h3 className={`font-sans text-3xl font-bold tracking-tight ${stats.lowStockItems > 0 ? 'text-amber-600' : 'text-slate-900'}`}>
              {stats.lowStockItems < 10 ? `0${stats.lowStockItems}` : stats.lowStockItems}
            </h3>
            <p className={`text-[11px] ${stats.lowStockItems > 0 ? 'text-amber-700 font-medium' : 'text-slate-400'}`}>
              {stats.lowStockItems > 0 ? 'Requires action' : 'All stores balanced'}
            </p>
          </div>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {activeSection === 'overview' ? (
          <motion.div
            key="overview-section"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="space-y-8"
          >
            {/* Inventory Overview Panel (Table) */}
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
              <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col gap-4">
                <div className="flex items-start gap-2.5 min-w-0">
                  <ClipboardList className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">
                      Inventory Logistics Table
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Check balances, thresholds, and storage configurations
                    </p>
                  </div>
                </div>

                {/* Table search & filter controls */}
                <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2.5 sm:gap-3">
                  <div className="relative w-full sm:w-auto sm:min-w-[12rem] sm:flex-1 sm:max-w-xs">
                    <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-450" />
                    <input
                      type="text"
                      placeholder="Filter by keyword..."
                      value={categorySearch}
                      onChange={(e) => setCategorySearch(e.target.value)}
                      className="bg-white border border-slate-200 rounded pl-8 pr-2.5 py-2 sm:py-1 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 w-full transition-all"
                    />
                  </div>

                  <button
                    onClick={() => setLowStockFilterOnly(!lowStockFilterOnly)}
                    className={`flex items-center justify-center gap-1.5 px-3 py-2 sm:py-1 text-[11px] font-semibold rounded border uppercase tracking-wider transition-all cursor-pointer ${
                      lowStockFilterOnly
                        ? 'bg-amber-50 text-amber-700 border-amber-300 shadow-2xs'
                        : 'bg-white border-slate-250 text-slate-500 hover:text-slate-850'
                    }`}
                  >
                    <Filter className="h-3 w-3 shrink-0" />
                    <span className="truncate">Low Stock Only ({categories.filter((cat) => cat.currentQuantity < cat.initialStock * 0.2).length})</span>
                  </button>

                  <div className="inline-flex rounded-md bg-slate-50 p-0.5 border border-slate-200 w-full sm:w-auto">
                    {(['All', ...FLOOR_OPTIONS] as const).map((floor) => (
                      <button
                        key={floor}
                        type="button"
                        onClick={() => setFloorFilter(floor)}
                        className={`flex-1 sm:flex-none px-3 py-2 sm:py-1 text-[10px] uppercase tracking-wider rounded font-semibold cursor-pointer transition-colors ${
                          floorFilter === floor
                            ? 'bg-[#0F172A] text-white font-bold shadow-xs'
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        {floor === 'All' ? 'All Floors' : floor.replace(' Floor', '')}
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={downloadInventoryPDF}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 sm:py-1 text-[11px] font-semibold rounded-md border bg-[#0F172A] hover:bg-slate-800 text-white border-slate-850 uppercase tracking-wider transition-all cursor-pointer shadow-xs"
                    title="Export complete inventory layout report to PDF"
                  >
                    <FileDown className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    Export PDF
                  </button>
                </div>
              </div>

              {/* Mobile card list */}
              <div className="md:hidden divide-y divide-slate-100">
                {filteredAndSortedCategories.length === 0 ? (
                  <div className="p-6 text-center text-slate-400 italic text-xs leading-relaxed">
                    {categories.length === 0
                      ? 'No inventory categories provisioned yet. Use "Provision Category" to add your first item.'
                      : 'No logistics line items matched search constraints.'}
                  </div>
                ) : (
                  filteredAndSortedCategories.map((cat) => {
                    const status = getStockStatus(cat.currentQuantity, cat.initialStock);
                    const percentage = cat.initialStock > 0
                      ? Math.min(100, Math.round((cat.currentQuantity / cat.initialStock) * 100))
                      : 0;

                    return (
                      <div key={cat.id} className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-slate-900 truncate">{cat.name}</p>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              {renderFloorBadge(cat.floor)}
                              <p className="text-[11px] text-slate-500 capitalize">{cat.unit}</p>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-2 shrink-0">
                            <span
                              title={status.tooltip}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 text-[9px] font-bold rounded-full border ${status.bg}`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${status.indicator}`} />
                              {status.label}
                            </span>
                            {renderCategoryActions(cat)}
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-500">Stock Remaining</span>
                          <span className="font-bold text-slate-800">{cat.currentQuantity}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-500">Total Stock</span>
                          <span className="font-semibold text-slate-700">{cat.initialStock}</span>
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px] text-slate-400 font-bold">
                            <span>Remaining %</span>
                            <span>{percentage}%</span>
                          </div>
                          <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden border border-slate-200">
                            <div
                              className={`h-full ${status.indicator} transition-all duration-300`}
                              style={{ width: `${Math.min(percentage, 100)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 tracking-wider select-none">
                      <th className="p-4 w-1/3 cursor-pointer hover:bg-slate-100/50" onClick={() => toggleSortCategories('name')}>
                        <div className="flex items-center gap-1.5">
                           Category Name
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </th>
                      <th className="p-4 w-1/6">Unit</th>
                      <th className="p-4 w-1/6">Floor</th>
                      <th className="p-4 w-1/5 cursor-pointer hover:bg-slate-100/50" onClick={() => toggleSortCategories('stock')}>
                        <div className="flex items-center gap-1.5">
                          Stock Remaining
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </th>
                      <th className="p-4 w-1/6">Total Stock</th>
                      <th className="p-4 w-1/6 cursor-pointer hover:bg-slate-100/50" onClick={() => toggleSortCategories('percentage')}>
                        <div className="flex items-center gap-1.5">
                          Remaining %
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </th>
                      <th className="p-4 w-1/6">Logistics Status</th>
                      <th className="p-4 w-24 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    <AnimatePresence>
                      {filteredAndSortedCategories.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="p-8 text-center text-slate-400 italic">
                            {categories.length === 0
                              ? 'No inventory categories provisioned yet. Use "Provision Category" to add your first item.'
                              : 'No logistics line items matched search constraints.'}
                          </td>
                        </tr>
                      ) : (
                        filteredAndSortedCategories.map((cat) => {
                          const status = getStockStatus(cat.currentQuantity, cat.initialStock);
                          const percentage = cat.initialStock > 0
                      ? Math.min(100, Math.round((cat.currentQuantity / cat.initialStock) * 100))
                      : 0;

                          return (
                            <motion.tr 
                              key={cat.id}
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              transition={{ duration: 0.15 }}
                              className="hover:bg-slate-50/50 transition-colors"
                            >
                              <td className="p-4 font-semibold text-slate-900 whitespace-nowrap overflow-hidden text-ellipsis">
                                {cat.name}
                              </td>
                              <td className="p-4 text-slate-505">
                                {cat.unit}
                              </td>
                              <td className="p-4">
                                {renderFloorBadge(cat.floor)}
                              </td>
                              <td className="p-4 text-slate-800">
                                <span className="font-extrabold text-sm tracking-tight">{cat.currentQuantity}</span>
                              </td>
                              <td className="p-4 text-slate-600 font-semibold">
                                {cat.initialStock}
                              </td>
                              <td className="p-4">
                                <div className="space-y-1">
                                  <div className="flex justify-between text-[9px] text-slate-400 font-bold">
                                    <span>{percentage}%</span>
                                  </div>
                                  <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden border border-slate-200">
                                    <div 
                                      className={`h-full ${status.indicator} transition-all duration-300`} 
                                      style={{ width: `${Math.min(percentage, 100)}%` }} 
                                    />
                                  </div>
                                </div>
                              </td>
                              <td className="p-4">
                                <span 
                                  title={status.tooltip}
                                  className={`inline-flex items-center gap-1 px-2.5 py-1 text-[9px] font-bold rounded-full border ${status.bg}`}
                                >
                                  <span className={`w-1.5 h-1.5 rounded-full ${status.indicator}`} />
                                  {status.label}
                                </span>
                              </td>
                              <td className="p-4 text-right">
                                {renderCategoryActions(cat)}
                              </td>
                            </motion.tr>
                          );
                        })
                      )}
                    </AnimatePresence>
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="logs-section"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="space-y-6"
          >
            {/* Withdrawal Logs Table */}
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
              <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col gap-4">
                <div className="flex items-start gap-2.5 min-w-0">
                  <ClipboardList className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">
                      Withdrawal Transaction Ledger
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Review, audit or reject staff withdrawal submissions
                    </p>
                  </div>
                </div>

                {/* Table search & tab-filters */}
                <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2.5 sm:gap-3">
                  <div className="relative w-full sm:w-auto sm:min-w-[12rem] sm:flex-1 sm:max-w-xs">
                    <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-450" />
                    <input
                      type="text"
                      placeholder="Search ledger logs..."
                      value={logSearch}
                      onChange={(e) => setLogSearch(e.target.value)}
                      className="bg-white border border-slate-200 rounded pl-8 pr-2.5 py-2 sm:py-1 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 w-full transition-all"
                    />
                  </div>

                  <div className="inline-flex rounded-md bg-slate-50 p-0.5 border border-slate-200 w-full sm:w-auto">
                    {(['All', 'Approved', 'Rejected'] as const).map((status) => (
                      <button
                        key={status}
                        onClick={() => setLogStatusFilter(status)}
                        className={`flex-1 sm:flex-none px-3 py-2 sm:py-1 text-[10px] uppercase tracking-wider rounded font-semibold cursor-pointer transition-colors ${
                          logStatusFilter === status
                            ? 'bg-[#0F172A] text-white font-bold shadow-xs'
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        {status}
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={downloadLogsPDF}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 sm:py-1 text-[11px] font-semibold rounded-md border bg-[#0F172A] hover:bg-slate-800 text-white border-slate-850 uppercase tracking-wider transition-all cursor-pointer shadow-xs"
                    title="Export withdrawal ledger log report to PDF"
                  >
                    <FileDown className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    Export PDF
                  </button>
                </div>
              </div>

              {/* Mobile card list */}
              <div className="md:hidden divide-y divide-slate-100">
                {filteredAndSortedLogs.length === 0 ? (
                  <div className="p-6 text-center text-slate-400 italic text-xs">
                    No ledger logs available under criteria.
                  </div>
                ) : (
                  filteredAndSortedLogs.map((log) => (
                    <div
                      key={log.id}
                      className={`p-4 space-y-3 ${log.status === 'Rejected' ? 'opacity-60' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className={`font-semibold text-slate-900 truncate ${log.status === 'Rejected' ? 'line-through text-slate-400' : ''}`}>
                            {log.categoryName}
                          </p>
                          <p className="text-[11px] text-amber-700 font-semibold flex items-center gap-1 mt-0.5">
                            <HardHat className="h-3 w-3 opacity-60 shrink-0" />
                            {log.workerId}
                          </p>
                        </div>
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-[9px] font-bold rounded-full border shrink-0 ${
                          log.status === 'Approved'
                            ? 'bg-[#DCFCE7] text-[#166534] border-[#BBF7D0]'
                            : 'bg-[#FEE2E2] text-[#991B1B] border-[#FECACA]'
                        }`}>
                          {log.status === 'Approved' ? (
                            <>
                              <CheckCircle2 className="h-2.5 w-2.5" />
                              Approved
                            </>
                          ) : (
                            <>
                              <XCircle className="h-2.5 w-2.5" />
                              Rejected
                            </>
                          )}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500">Quantity</span>
                        <span className={`font-bold ${log.status === 'Rejected' ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                          {log.quantity}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-[11px] text-slate-500">
                        <span className="truncate">{log.timestamp}</span>
                        <button
                          onClick={() => onToggleLogStatus(log.id)}
                          title={log.status === 'Approved' ? 'Reject & Revert Stock' : 'Re-Approve (Deduct Stock)'}
                          className="p-1.5 text-slate-500 hover:text-slate-800 bg-white border border-slate-200 rounded shadow-2xs hover:border-slate-350 transition-colors cursor-pointer shrink-0"
                        >
                          <RotateCcw className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 tracking-wider select-none">
                      <th className="p-4 w-1/6 cursor-pointer hover:bg-slate-100/50" onClick={() => toggleSortLogs('worker')}>
                        <div className="flex items-center gap-1.5">
                          Staff Name
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </th>
                      <th className="p-4 w-1/4 cursor-pointer hover:bg-slate-100/50" onClick={() => toggleSortLogs('category')}>
                        <div className="flex items-center gap-1.5">
                          Stock Category
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </th>
                      <th className="p-4 w-1/6 cursor-pointer hover:bg-slate-100/50" onClick={() => toggleSortLogs('quantity')}>
                        <div className="flex items-center gap-1.5">
                          Quantity
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </th>
                      <th className="p-4 w-1/4 cursor-pointer hover:bg-slate-100/50" onClick={() => toggleSortLogs('timestamp')}>
                        <div className="flex items-center gap-1.5">
                          Timestamp
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </th>
                      <th className="p-4 w-1/6 cursor-pointer hover:bg-slate-100/50" onClick={() => toggleSortLogs('status')}>
                        <div className="flex items-center gap-1.5">
                          Status & Actions
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                    <AnimatePresence>
                      {filteredAndSortedLogs.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-8 text-center text-slate-400 italic">
                            No ledger logs available under criteria.
                          </td>
                        </tr>
                      ) : (
                        filteredAndSortedLogs.map((log) => (
                          <motion.tr 
                            key={log.id}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className={`hover:bg-slate-50/20 transition-colors ${
                              log.status === 'Rejected' ? 'opacity-60 line-through text-slate-400' : ''
                            }`}
                          >
                            <td className="p-4 font-semibold text-amber-700 whitespace-nowrap overflow-hidden text-ellipsis flex items-center gap-1.5">
                              <HardHat className="h-3.5 w-3.5 opacity-60" />
                              {log.workerId}
                            </td>
                            <td className="p-4 text-slate-900 font-semibold whitespace-nowrap overflow-hidden text-ellipsis">
                              {log.categoryName}
                            </td>
                            <td className="p-4 font-bold">
                              {log.quantity}
                            </td>
                            <td className="p-4 text-[11px] text-slate-505 whitespace-nowrap">
                              {log.timestamp}
                            </td>
                            <td className="p-4">
                              <div className="flex items-center gap-2">
                                <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-[9px] font-bold rounded-full border ${
                                  log.status === 'Approved'
                                    ? 'bg-[#DCFCE7] text-[#166534] border-[#BBF7D0]'
                                    : 'bg-[#FEE2E2] text-[#991B1B] border-[#FECACA]'
                                }`}>
                                  {log.status === 'Approved' ? (
                                    <>
                                      <CheckCircle2 className="h-2.5 w-2.5" />
                                      Approved
                                    </>
                                  ) : (
                                    <>
                                      <XCircle className="h-2.5 w-2.5" />
                                      Rejected
                                    </>
                                  )}
                                </span>

                                <button
                                  onClick={() => onToggleLogStatus(log.id)}
                                  title={log.status === 'Approved' ? 'Reject & Revert Stock' : 'Re-Approve (Deduct Stock)'}
                                  className="p-1.5 text-slate-500 hover:text-slate-800 bg-white border border-slate-200 rounded shadow-2xs hover:border-slate-350 transition-colors cursor-pointer"
                                >
                                  <RotateCcw className="h-3 w-3" />
                                </button>
                              </div>
                            </td>
                          </motion.tr>
                        ))
                      )}
                    </AnimatePresence>
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Category Edit Overlay Modal */}
      <AnimatePresence>
        {isEditCategoryOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeEditModal}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              className="bg-white border border-slate-200 shadow-2xl rounded-xl w-full max-w-sm overflow-hidden relative z-10 max-h-[90vh] overflow-y-auto"
            >
              <div className="h-1 bg-amber-500 w-full" />

              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="p-1 px-1.5 rounded bg-slate-50 text-amber-600 border border-slate-100">
                    <Pencil className="h-4 w-4" />
                  </span>
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Edit Category
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={closeEditModal}
                  className="p-1 text-slate-400 hover:text-slate-600 transition-colors rounded hover:bg-slate-50 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleEditCategorySubmit} className="p-6 space-y-4">
                {editError && (
                  <div className="bg-red-50 border border-red-200 text-red-655 p-2.5 text-xs rounded flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    {editError}
                  </div>
                )}
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider">
                    Category Name
                  </label>
                  <input
                    type="text"
                    required
                    value={editCatName}
                    onChange={(e) => setEditCatName(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-amber-500 transition-colors shadow-2xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider">
                    Measuring Unit
                  </label>
                  <input
                    type="text"
                    required
                    value={editCatUnit}
                    onChange={(e) => setEditCatUnit(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:border-amber-500 transition-colors shadow-2xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider">
                    Floor Location
                  </label>
                  <select
                    required
                    value={editCatFloor}
                    onChange={(e) => setEditCatFloor(e.target.value as Floor)}
                    className="w-full bg-white border border-slate-200 rounded px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-amber-500 transition-colors shadow-2xs"
                  >
                    {FLOOR_OPTIONS.map((floor) => (
                      <option key={floor} value={floor}>
                        {floor}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider">
                      Total Stock
                    </label>
                    <input
                      type="number"
                      required
                      min="0"
                      value={editCatInitial}
                      onChange={(e) => setEditCatInitial(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full bg-white border border-slate-200 rounded px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:border-amber-500 transition-colors shadow-2xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider">
                      Stock Remaining
                    </label>
                    <input
                      type="number"
                      required
                      min="0"
                      value={editCatCurrent}
                      onChange={(e) => setEditCatCurrent(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full bg-white border border-slate-200 rounded px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:border-amber-500 transition-colors shadow-2xs"
                    />
                  </div>
                </div>

                <div className="pt-4 flex items-center justify-end gap-2 border-t border-slate-100 mt-4">
                  <button
                    type="button"
                    onClick={closeEditModal}
                    className="px-4 py-2 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-md text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-[#0F172A] hover:bg-slate-800 text-white rounded-md font-semibold text-xs uppercase tracking-wider transition-all cursor-pointer"
                  >
                    Save Changes
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Category Delete Confirmation Modal */}
      <AnimatePresence>
        {deletingCategory && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDeletingCategoryId(null)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              className="bg-white border border-slate-200 shadow-2xl rounded-xl w-full max-w-sm overflow-hidden relative z-10"
            >
              <div className="h-1 bg-red-500 w-full" />

              <div className="p-6 space-y-4">
                <div className="flex items-start gap-3">
                  <span className="p-2 rounded-lg bg-red-50 text-red-600 border border-red-100 shrink-0">
                    <Trash2 className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Delete Category</h3>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                      Remove <span className="font-semibold text-slate-800">&quot;{deletingCategory.name}&quot;</span> from inventory?
                      Withdrawal logs for this item will be kept for audit history.
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setDeletingCategoryId(null)}
                    className="px-4 py-2 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-md text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteConfirm}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md font-semibold text-xs uppercase tracking-wider transition-all cursor-pointer"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Category Creation Overlay Modal */}
      <AnimatePresence>
        {isAddCategoryOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop blur layer */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddCategoryOpen(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
            />
            
            {/* Modal Body Card */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              className="bg-white border border-slate-200 shadow-2xl rounded-xl w-full max-w-sm overflow-hidden relative z-10"
            >
              {/* Top Accent line */}
              <div className="h-1 bg-amber-500 w-full" />
              
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="p-1 px-1.5 rounded bg-slate-50 text-amber-600 border border-slate-100">
                    <Plus className="h-4 w-4" />
                  </span>
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Provision New Category
                  </h3>
                </div>
                <button
                  onClick={() => setIsAddCategoryOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-600 transition-colors rounded hover:bg-slate-50 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleAddCategorySubmit} className="p-6 space-y-4">
                {catError && (
                  <div className="bg-red-50 border border-red-200 text-red-655 p-2.5 text-xs rounded flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    {catError}
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider">
                      Category Name
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Copper Connectors"
                      value={newCatName}
                      onChange={(e) => setNewCatName(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-amber-500 transition-colors shadow-2xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider">
                      Measuring Unit
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. pieces, meters"
                      value={newCatUnit}
                      onChange={(e) => setNewCatUnit(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:border-amber-500 transition-colors shadow-2xs"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider">
                    Floor Location
                  </label>
                  <select
                    required
                    value={newCatFloor}
                    onChange={(e) => setNewCatFloor(e.target.value as Floor)}
                    className="w-full bg-white border border-slate-200 rounded px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-amber-500 transition-colors shadow-2xs"
                  >
                    {FLOOR_OPTIONS.map((floor) => (
                      <option key={floor} value={floor}>
                        {floor}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider">
                    Total Stock (Initial Quantity)
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    placeholder="e.g. 100"
                    value={newCatInitial}
                    onChange={(e) => setNewCatInitial(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full bg-white border border-slate-200 rounded px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:border-amber-500 transition-colors shadow-2xs"
                  />
                </div>

                <div className="pt-4 flex items-center justify-end gap-2 border-t border-slate-100 mt-4">
                  <button
                    type="button"
                    onClick={() => setIsAddCategoryOpen(false)}
                    className="px-4 py-2 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-md text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-[#0F172A] hover:bg-slate-800 text-white rounded-md font-semibold text-xs uppercase tracking-wider transition-all cursor-pointer"
                  >
                    Register Line Item
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Stock Refill / Reconcile Overlay Modal */}
      <AnimatePresence>
        {isRestockOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop blur layer */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsRestockOpen(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
            />
            
            {/* Modal Body Card */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              className="bg-white border border-slate-200 shadow-2xl rounded-xl w-full max-w-sm overflow-hidden relative z-10"
            >
              {/* Top Accent line */}
              <div className="h-1 bg-amber-500 w-full" />
              
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="p-1 px-1.5 rounded bg-slate-50 text-amber-600 border border-slate-100">
                    <ArrowUpRight className="h-4 w-4" />
                  </span>
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Inject / Reconcile Stock
                  </h3>
                </div>
                <button
                  onClick={() => setIsRestockOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-600 transition-colors rounded hover:bg-slate-50 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleRestockSubmit} className="p-6 space-y-4">
                {restockError && (
                  <div className="bg-red-50 border border-red-200 text-red-600 p-2.5 text-xs rounded flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    {restockError}
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider">
                    Select Category
                  </label>
                  <select
                    required
                    value={selectedCatIdForRestock}
                    onChange={(e) => setSelectedCatIdForRestock(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-amber-500 transition-colors shadow-2xs animate-fade-in"
                  >
                    <option value="">-- Choose Item --</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name} · {cat.floor} ({cat.currentQuantity} remaining / {cat.initialStock} total {cat.unit})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 tracking-wider">
                    Refill Quantity
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    placeholder="e.g. 150"
                    value={restockAmount}
                    onChange={(e) => setRestockAmount(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full bg-white border border-slate-200 rounded px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-amber-500 transition-colors shadow-2xs"
                  />
                </div>

                <div className="pt-4 flex items-center justify-end gap-2 border-t border-slate-100 mt-4">
                  <button
                    type="button"
                    onClick={() => setIsRestockOpen(false)}
                    className="px-4 py-2 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-md text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-[#0F172A] hover:bg-slate-800 text-white rounded-md font-semibold text-xs uppercase tracking-wider transition-all cursor-pointer"
                  >
                    Refill Stock
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
