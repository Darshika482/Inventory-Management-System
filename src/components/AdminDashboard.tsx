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
  Send,
  Layers, 
  Database,
  ArrowUpRight,
  Filter,
  CheckCircle2,
  XCircle,
  HardHat,
  FileDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Category, WithdrawalLog, Floor, User } from '../types';
import { FLOOR_OPTIONS, getFloorBadgeClass, getFloorShortLabel } from '../lib/floors';
import { groupCategoriesByNameAndFloor, sortGroupedCategories, getWorstVariant } from '../lib/groupCategories';
import { QuantityCalculation } from './QuantityCalculation';
import { formatTotalQuantity, calculateTotalQuantity } from '../lib/unitQuantity';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PremiumSelect } from './PremiumSelect';
import { AppModal } from './AppModal';
import { FormInput, FormError, ModalActions } from './FormInput';
import { categoryToSelectOption, staffToSelectOption, FLOOR_SELECT_OPTIONS } from '../lib/selectOptions';

interface AdminDashboardProps {
  categories: Category[];
  logs: WithdrawalLog[];
  staffMembers: User[];
  onAddStock: (categoryId: string, quantity: number) => void;
  onAddNewCategory: (name: string, unit: string, initialStock: number, floor: Floor) => void;
  onUpdateCategory: (
    categoryId: string,
    updates: { name: string; unit: string; floor: Floor; initialStock: number; currentQuantity: number }
  ) => void;
  onDeleteCategory: (categoryId: string) => void;
  onToggleLogStatus: (logId: string) => void;
  onRecordWithdrawal: (
    categoryId: string,
    quantity: number,
    staffUsername: string
  ) => Promise<{ success: boolean; message: string }>;
  activeSection: string;
}

type SortFieldCategory = 'name' | 'stock' | 'percentage';
type SortFieldLog = 'worker' | 'category' | 'quantity' | 'timestamp' | 'status';

export function AdminDashboard({ 
  categories, 
  logs, 
  staffMembers,
  onAddStock, 
  onAddNewCategory,
  onUpdateCategory,
  onDeleteCategory,
  onToggleLogStatus,
  onRecordWithdrawal,
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

  // Record withdrawal (admin on behalf of staff)
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
  const [selectedStaffUsername, setSelectedStaffUsername] = useState('');
  const [withdrawCategoryId, setWithdrawCategoryId] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState<number | ''>('');
  const [withdrawError, setWithdrawError] = useState('');
  const [isWithdrawSubmitting, setIsWithdrawSubmitting] = useState(false);

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

  const stockSelectOptions = useMemo(
    () => categories.map((cat) => categoryToSelectOption(cat, categories)),
    [categories]
  );

  const staffSelectOptions = useMemo(
    () => staffMembers.map(staffToSelectOption),
    [staffMembers]
  );

  // Handle addition of new category
  const handleAddCategorySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setCatError('');

    if (!newCatName.trim()) {
      setCatError('Please enter an item name.');
      return;
    }

    if (newCatInitial === '' || newCatInitial < 0) {
      setCatError('Starting amount must be zero or more.');
      return;
    }

    const nameExists = categories.some(
      (c) =>
        c.name.toLowerCase() === newCatName.trim().toLowerCase() &&
        c.floor === newCatFloor &&
        c.unit.toLowerCase() === newCatUnit.trim().toLowerCase()
    );
    if (nameExists) {
      setCatError('An item with this name, unit, and floor already exists.');
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
      setRestockError('Please choose an item.');
      return;
    }

    if (restockAmount === '' || restockAmount <= 0) {
      setRestockError('Please enter an amount greater than 0.');
      return;
    }

    onAddStock(selectedCatIdForRestock, Number(restockAmount));
    setRestockAmount('');
    setSelectedCatIdForRestock('');
    setIsRestockOpen(false);
  };

  const openWithdrawModal = () => {
    setWithdrawError('');
    setSelectedStaffUsername(staffMembers[0]?.username ?? '');
    setWithdrawCategoryId('');
    setWithdrawAmount('');
    setIsWithdrawOpen(true);
  };

  const closeWithdrawModal = () => {
    setIsWithdrawOpen(false);
    setWithdrawError('');
    setIsWithdrawSubmitting(false);
  };

  const handleWithdrawSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setWithdrawError('');

    if (!selectedStaffUsername) {
      setWithdrawError('Please choose which staff member took the items.');
      return;
    }
    if (!withdrawCategoryId) {
      setWithdrawError('Please choose an item.');
      return;
    }
    if (withdrawAmount === '' || withdrawAmount <= 0) {
      setWithdrawError('Please enter an amount greater than 0.');
      return;
    }

    setIsWithdrawSubmitting(true);
    const response = await onRecordWithdrawal(
      withdrawCategoryId,
      Number(withdrawAmount),
      selectedStaffUsername
    );
    setIsWithdrawSubmitting(false);

    if (response.success) {
      closeWithdrawModal();
    } else {
      setWithdrawError(response.message);
    }
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
      setEditError('Please enter an item name.');
      return;
    }

    if (editCatInitial === '' || editCatInitial < 0) {
      setEditError('Total stock must be zero or more.');
      return;
    }

    if (editCatCurrent === '' || editCatCurrent < 0) {
      setEditError('Remaining stock must be zero or more.');
      return;
    }

    const nameExists = categories.some(
      (c) =>
        c.id !== editingCategoryId &&
        c.name.toLowerCase() === editCatName.trim().toLowerCase() &&
        c.floor === editCatFloor &&
        c.unit.toLowerCase() === editCatUnit.trim().toLowerCase()
    );
    if (nameExists) {
      setEditError('Another item with this name, unit, and floor already exists.');
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

  const renderCategoryActions = (cat: Category, variant: 'icon' | 'labeled' = 'icon') => (
    variant === 'labeled' ? (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => openEditModal(cat)}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors cursor-pointer"
        >
          <Pencil className="h-4 w-4" />
          Edit
        </button>
        <button
          type="button"
          onClick={() => setDeletingCategoryId(cat.id)}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors cursor-pointer"
        >
          <Trash2 className="h-4 w-4" />
          Remove
        </button>
      </div>
    ) : (
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => openEditModal(cat)}
          title="Edit item"
          className="p-1.5 text-slate-500 hover:text-amber-700 bg-white border border-slate-200 rounded shadow-2xs hover:border-amber-300 transition-colors cursor-pointer"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setDeletingCategoryId(cat.id)}
          title="Remove item"
          className="p-1.5 text-slate-500 hover:text-red-600 bg-white border border-slate-200 rounded shadow-2xs hover:border-red-200 transition-colors cursor-pointer"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  );

  const renderFloorBadge = (floor: Floor) => (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-md border ${getFloorBadgeClass(floor)}`}
    >
      {getFloorShortLabel(floor)}
    </span>
  );

  // Helper to determine the stock health color badge
  const getStockStatus = (current: number, initial: number) => {
    const ratio = current / initial;
    if (ratio < 0.2) {
      return {
        label: 'Very low',
        bg: 'bg-[#FEE2E2] text-[#991B1B] border-[#FECACA]',
        text: 'text-red-600',
        indicator: 'bg-[#991B1B]',
        tooltip: 'Less than 20% left'
      };
    }
    if (ratio < 0.5) {
      return {
        label: 'Low',
        bg: 'bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]',
        text: 'text-amber-600',
        indicator: 'bg-[#92400E]',
        tooltip: 'Less than half left'
      };
    }
    return {
      label: 'Good',
      bg: 'bg-[#DCFCE7] text-[#166534] border-[#BBF7D0]',
      text: 'text-emerald-700',
      indicator: 'bg-[#166534]',
      tooltip: 'Plenty in stock'
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

  const groupedCategories = useMemo(() => {
    const groups = groupCategoriesByNameAndFloor(filteredAndSortedCategories);
    return sortGroupedCategories(groups, catSortField, catSortDirection);
  }, [filteredAndSortedCategories, catSortField, catSortDirection]);

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
      doc.text('AKSHAY TRADERS — STOCK LIST', 14, 16);

      // Subtitle
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(245, 158, 11); // amber-500
      doc.text(`Downloaded: ${new Date().toLocaleString()}`, 14, 23);

      // Summary indicators in header banner
      doc.setFontSize(10);
      doc.setTextColor(148, 163, 184); // slate-400
      doc.text(`Item types: ${stats.totalCategories}   |   In stock: ${stats.totalItemsInStock}   |   Running low: ${stats.lowStockItems}`, 14, 30);

      // Accent border below banner
      doc.setDrawColor(245, 158, 11);
      doc.setLineWidth(1);
      doc.line(0, 38, 210, 38);

      // Table mapping
      const tableHeaders = [['Item', 'Floor', 'Unit', 'Total stock', 'Left', 'Remaining %', 'Status']];
      
      const tableRows = filteredAndSortedCategories.map((cat) => {
        const ratio = cat.currentQuantity / cat.initialStock;
        const percentage = cat.initialStock > 0
          ? Math.min(100, Math.round(ratio * 100))
          : 0;
        let status = 'Good';
        if (ratio < 0.2) {
          status = 'Very low';
        } else if (ratio < 0.5) {
          status = 'Low';
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
            if (val === 'Very low') {
              data.cell.styles.textColor = [153, 27, 27];
            } else if (val === 'Low') {
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
        doc.text('Akshay Traders  •  Stock report', 72, 287);
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
      doc.text('AKSHAY TRADERS — TAKEN ITEMS HISTORY', 14, 16);

      // Subtitle
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(245, 158, 11); // amber-500
      doc.text(`Downloaded: ${new Date().toLocaleString()}`, 14, 23);

      // Metric lines
      doc.setFontSize(10);
      doc.setTextColor(148, 163, 184); // slate-400
      doc.text(`Records shown: ${filteredAndSortedLogs.length}   |   Confirmed: ${logs.filter(l => l.status === 'Approved').length}   |   Undone: ${logs.filter(l => l.status === 'Rejected').length}`, 14, 30);

      // Border line accent
      doc.setDrawColor(245, 158, 11);
      doc.setLineWidth(1);
      doc.line(0, 38, 210, 38);

      // Table mapping
      const tableHeaders = [['Reference', 'Staff', 'Item', 'Amount', 'When', 'Status']];
      
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
        doc.text('Akshay Traders  •  Stock report', 85, 287);
      }

      doc.save(`audit-reconciliation-ledger-${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (err) {
      console.error('Audit PDF export failed:', err);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#F8FAFC] p-4 sm:p-6 md:p-8 space-y-6 sm:space-y-8 font-sans text-slate-900 selection:bg-amber-500 selection:text-white">
      
      {/* Dynamic Header */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-sans text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              Stock overview
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              See what you have and what has been taken
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsAddCategoryOpen(true)}
            title="Add new item"
            className="shrink-0 p-2.5 bg-[#0F172A] hover:bg-slate-800 text-white rounded-lg shadow-xs cursor-pointer transition-all border border-slate-850"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>
        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2.5 w-full sm:w-auto">
          <button
            onClick={() => setIsRestockOpen(true)}
            className="flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold shadow-xs cursor-pointer transition-all border border-emerald-700/20"
          >
            <ArrowUpRight className="h-4 w-4" />
            Add more stock
          </button>
          <button
            onClick={openWithdrawModal}
            className="flex items-center justify-center gap-2 px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-bold shadow-xs cursor-pointer transition-all border border-red-700/20"
          >
            <Send className="h-4 w-4" />
            Record taken stock
          </button>
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
            <div className="bg-white border border-slate-200 rounded-xl md:rounded-lg overflow-hidden shadow-xs">
              <div className="px-3 py-2.5 border-b border-slate-100 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <ClipboardList className="h-4 w-4 text-amber-600 shrink-0" />
                    <h3 className="text-sm font-bold text-slate-800">Stock list</h3>
                    <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full tabular-nums">
                      {groupedCategories.length} items
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Search */}
                  <div className="relative flex-1 min-w-0">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Search by name..."
                      value={categorySearch}
                      onChange={(e) => setCategorySearch(e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 focus:bg-white w-full transition-all"
                    />
                  </div>

                  {/* Floor filter */}
                  <div className="inline-flex rounded-lg bg-slate-100 p-0.5 shrink-0">
                    {(['All', ...FLOOR_OPTIONS] as const).map((floor) => (
                      <button
                        key={floor}
                        type="button"
                        onClick={() => setFloorFilter(floor)}
                        className={`px-2.5 py-1 text-xs rounded-md font-semibold cursor-pointer transition-colors ${
                          floorFilter === floor
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        {floor === 'All' ? 'All' : getFloorShortLabel(floor)}
                      </button>
                    ))}
                  </div>

                  {/* Low stock filter */}
                  <button
                    type="button"
                    onClick={() => setLowStockFilterOnly(!lowStockFilterOnly)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all cursor-pointer shrink-0 ${
                      lowStockFilterOnly
                        ? 'bg-amber-50 text-amber-700 border-amber-300'
                        : 'bg-white text-slate-500 border-slate-200 hover:text-slate-800'
                    }`}
                  >
                    <Filter className="h-3 w-3 shrink-0" />
                    Low stock
                    {stats.lowStockItems > 0 && (
                      <span className={`px-1 py-0.5 text-xs rounded-full ${
                        lowStockFilterOnly ? 'bg-amber-200 text-amber-900' : 'bg-slate-200 text-slate-700'
                      }`}>
                        {stats.lowStockItems}
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* Mobile card list */}
              <div className="md:hidden p-3 space-y-3 bg-slate-50/80">
                {groupedCategories.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 text-sm leading-relaxed">
                    {categories.length === 0
                      ? 'No items added yet. Tap the + button above to get started.'
                      : 'No items match your search.'}
                  </div>
                ) : (
                  groupedCategories.map((group) => {
                    const worstVariant = getWorstVariant(group);
                    const status = getStockStatus(worstVariant.currentQuantity, worstVariant.initialStock);

                    return (
                      <div
                        key={group.key}
                        className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs"
                      >
                        <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <h4 className="text-base font-bold text-slate-900 leading-snug">{group.name}</h4>
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                              {renderFloorBadge(group.floor)}
                              {group.variants.length > 1 && (
                                <span className="text-xs text-slate-400 font-medium">
                                  {group.variants.length} units
                                </span>
                              )}
                            </div>
                          </div>
                          <span
                            title={status.tooltip}
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-semibold rounded-full border shrink-0 ${status.bg}`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${status.indicator}`} />
                            {status.label}
                          </span>
                        </div>

                        <div className="divide-y divide-slate-100">
                          {group.variants.map((cat) => (
                            <div key={cat.id} className="flex items-center gap-3 px-4 py-3">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm text-slate-600">{cat.unit}</p>
                                <p className="text-sm font-bold text-slate-900 mt-0.5 tabular-nums">
                                  {cat.currentQuantity.toLocaleString()} left
                                </p>
                              </div>
                              <p className="text-xs text-slate-400 tabular-nums shrink-0">
                                <QuantityCalculation
                                  unit={cat.unit}
                                  count={cat.currentQuantity}
                                  className="text-xs text-slate-400 tabular-nums"
                                />
                              </p>
                              <div className="shrink-0">
                                {renderCategoryActions(cat, 'icon')}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })
                )}

                {groupedCategories.length > 0 && (
                  <button
                    type="button"
                    onClick={downloadInventoryPDF}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-colors cursor-pointer"
                  >
                    <FileDown className="h-4 w-4 text-amber-600" />
                    Download stock list (PDF)
                  </button>
                )}
              </div>

              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-sm font-bold text-slate-500 tracking-wider select-none">
                      <th className="p-4 w-1/3 cursor-pointer hover:bg-slate-100/50" onClick={() => toggleSortCategories('name')}>
                        <div className="flex items-center gap-1.5">
                           Item name
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </th>
                      <th className="p-4 w-1/6">Unit</th>
                      <th className="p-4 w-1/6">Floor</th>
                      <th className="p-4 w-1/5 cursor-pointer hover:bg-slate-100/50" onClick={() => toggleSortCategories('stock')}>
                        <div className="flex items-center gap-1.5">
                          Left in stock
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
                      <th className="p-4 w-1/6">Stock level</th>
                      <th className="p-4 w-24 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    <AnimatePresence>
                      {groupedCategories.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="p-8 text-center text-slate-400 italic">
                            {categories.length === 0
                              ? 'No items added yet. Tap the + button above to get started.'
                              : 'No logistics line items matched search constraints.'}
                          </td>
                        </tr>
                      ) : (
                        groupedCategories.flatMap((group) =>
                          group.variants.map((cat, variantIndex) => {
                            const status = getStockStatus(cat.currentQuantity, cat.initialStock);
                            const percentage = cat.initialStock > 0
                              ? Math.min(100, Math.round((cat.currentQuantity / cat.initialStock) * 100))
                              : 0;
                            const isFirstVariant = variantIndex === 0;

                            return (
                              <motion.tr
                                key={cat.id}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.15 }}
                                className={`hover:bg-slate-50/50 transition-colors ${!isFirstVariant ? 'border-t-0' : ''}`}
                              >
                                {isFirstVariant ? (
                                  <td
                                    rowSpan={group.variants.length}
                                    className="p-4 font-semibold text-slate-900 align-top border-r border-slate-100"
                                  >
                                    <div className="space-y-1">
                                      <span className="block">{group.name}</span>
                                      {group.variants.length > 1 && (
                                        <span className="text-xs font-medium text-slate-400">
                                          {group.variants.length} units
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                ) : null}
                                <td className="p-4 text-slate-600 font-medium">
                                  {cat.unit}
                                </td>
                                {isFirstVariant ? (
                                  <td
                                    rowSpan={group.variants.length}
                                    className="p-4 align-top border-r border-slate-100"
                                  >
                                    {renderFloorBadge(group.floor)}
                                  </td>
                                ) : null}
                                <td className="p-4 text-slate-800">
                                  <span className="font-extrabold text-sm tracking-tight tabular-nums">
                                    {cat.currentQuantity.toLocaleString()}
                                  </span>
                                  {calculateTotalQuantity(cat.unit, cat.currentQuantity) !== null && (
                                    <span className="block text-xs text-slate-400 tabular-nums mt-0.5">
                                      = {calculateTotalQuantity(cat.unit, cat.currentQuantity)!.toLocaleString()}
                                    </span>
                                  )}
                                </td>
                                <td className="p-4 text-slate-600 font-semibold">
                                  <span className="font-semibold text-sm tabular-nums">
                                    {cat.initialStock.toLocaleString()}
                                  </span>
                                  {calculateTotalQuantity(cat.unit, cat.initialStock) !== null && (
                                    <span className="block text-xs text-slate-400 tabular-nums mt-0.5">
                                      = {calculateTotalQuantity(cat.unit, cat.initialStock)!.toLocaleString()}
                                    </span>
                                  )}
                                </td>
                                <td className="p-4">
                                  <div className="space-y-1">
                                    <div className="flex justify-between text-xs text-slate-400 font-bold">
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
                                    className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-full border ${status.bg}`}
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
                        )
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
                    <h3 className="text-base font-bold text-slate-800">
                      Taken items history
                    </h3>
                    <p className="text-sm text-slate-500 mt-0.5">
                      See what staff have taken and undo if needed
                    </p>
                  </div>
                </div>

                {/* Table search & tab-filters */}
                <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2.5 sm:gap-3">
                  <div className="relative w-full sm:w-auto sm:min-w-[12rem] sm:flex-1 sm:max-w-xs">
                    <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-450" />
                    <input
                      type="text"
                      placeholder="Search by name or date..."
                      value={logSearch}
                      onChange={(e) => setLogSearch(e.target.value)}
                      className="bg-white border border-slate-200 rounded-lg pl-9 pr-3 py-3 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 w-full transition-all"
                    />
                  </div>

                  <div className="inline-flex rounded-md bg-slate-50 p-0.5 border border-slate-200 w-full sm:w-auto">
                    {(['All', 'Approved', 'Rejected'] as const).map((status) => (
                      <button
                        key={status}
                        onClick={() => setLogStatusFilter(status)}
                        className={`flex-1 sm:flex-none px-3 py-2.5 sm:py-2 text-sm rounded-lg font-semibold cursor-pointer transition-colors ${
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
                    className="flex items-center justify-center gap-1.5 px-3 py-2.5 sm:py-2 text-sm font-semibold rounded-lg border bg-[#0F172A] hover:bg-slate-800 text-white border-slate-850 transition-all cursor-pointer shadow-xs"
                    title="Export withdrawal ledger log report to PDF"
                  >
                    <FileDown className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    Download PDF
                  </button>
                </div>
              </div>

              {/* Mobile card list */}
              <div className="md:hidden p-3 space-y-3 bg-slate-50/50">
                {filteredAndSortedLogs.length === 0 ? (
                  <div className="p-6 text-center text-slate-400 italic text-sm">
                    Nothing found.
                  </div>
                ) : (
                  filteredAndSortedLogs.map((log) => (
                    <div
                      key={log.id}
                      className={`bg-white border border-slate-200 rounded-xl p-4 shadow-xs ${
                        log.status === 'Rejected' ? 'opacity-60' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className={`text-base font-bold text-slate-900 ${log.status === 'Rejected' ? 'line-through text-slate-400' : ''}`}>
                            {log.categoryName}
                          </p>
                          <p className="text-sm text-slate-500 flex items-center gap-1.5 mt-1">
                            <HardHat className="h-3.5 w-3.5 shrink-0" />
                            {log.workerId}
                          </p>
                        </div>
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-full border shrink-0 ${
                          log.status === 'Approved'
                            ? 'bg-[#DCFCE7] text-[#166534] border-[#BBF7D0]'
                            : 'bg-[#FEE2E2] text-[#991B1B] border-[#FECACA]'
                        }`}>
                          {log.status === 'Approved' ? (
                            <>
                              <CheckCircle2 className="h-3 w-3" />
                              Confirmed
                            </>
                          ) : (
                            <>
                              <XCircle className="h-3 w-3" />
                              Undone
                            </>
                          )}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                        <div>
                          <p className={`text-xl font-bold tabular-nums ${log.status === 'Rejected' ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                            {log.quantity}
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5">taken</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm text-slate-500">{log.timestamp}</p>
                          <button
                            onClick={() => onToggleLogStatus(log.id)}
                            title={log.status === 'Approved' ? 'Undo — put stock back' : 'Confirm again — take stock'}
                            className="p-2 text-slate-500 hover:text-slate-800 bg-slate-50 border border-slate-200 rounded-lg transition-colors cursor-pointer shrink-0"
                          >
                            <RotateCcw className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-sm font-bold text-slate-500 tracking-wider select-none">
                      <th className="p-4 w-1/6 cursor-pointer hover:bg-slate-100/50" onClick={() => toggleSortLogs('worker')}>
                        <div className="flex items-center gap-1.5">
                          Staff Name
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </th>
                      <th className="p-4 w-1/4 cursor-pointer hover:bg-slate-100/50" onClick={() => toggleSortLogs('category')}>
                        <div className="flex items-center gap-1.5">
                          Item
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
                          When
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </th>
                      <th className="p-4 w-1/6 cursor-pointer hover:bg-slate-100/50" onClick={() => toggleSortLogs('status')}>
                        <div className="flex items-center gap-1.5">
                          Status
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
                    <AnimatePresence>
                      {filteredAndSortedLogs.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-8 text-center text-slate-400 italic">
                            Nothing found.
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
                            <td className="p-4 text-sm text-slate-505 whitespace-nowrap">
                              {log.timestamp}
                            </td>
                            <td className="p-4">
                              <div className="flex items-center gap-2">
                                <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-full border ${
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
                                  title={log.status === 'Approved' ? 'Undo — put stock back' : 'Confirm again — take stock'}
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

      {/* Compact summary stats at page bottom */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 pt-2">
        <div className="bg-white px-3 py-2.5 rounded-lg border border-slate-200 shadow-xs flex items-center gap-2.5">
          <Layers className="h-4 w-4 text-slate-300 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs text-slate-500 truncate">Item types</p>
            <p className="text-lg font-bold text-slate-900 leading-tight">{stats.totalCategories}</p>
          </div>
        </div>
        <div className="bg-white px-3 py-2.5 rounded-lg border border-slate-200 shadow-xs flex items-center gap-2.5">
          <Database className="h-4 w-4 text-slate-300 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs text-slate-500 truncate">Total pieces</p>
            <p className="text-lg font-bold text-slate-900 leading-tight">{stats.totalItemsInStock.toLocaleString()}</p>
          </div>
        </div>
        <div className="bg-white px-3 py-2.5 rounded-lg border border-slate-200 shadow-xs flex items-center gap-2.5">
          <ArrowUpRight className="h-4 w-4 text-slate-300 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs text-slate-500 truncate">Taken out</p>
            <p className="text-lg font-bold text-amber-600 leading-tight">{stats.totalWithdrawals.toLocaleString()}</p>
          </div>
        </div>
        <div className={`px-3 py-2.5 rounded-lg border shadow-xs flex items-center gap-2.5 ${
          stats.lowStockItems > 0 ? 'bg-amber-50/50 border-amber-200' : 'bg-white border-slate-200'
        }`}>
          <AlertTriangle className={`h-4 w-4 shrink-0 ${stats.lowStockItems > 0 ? 'text-amber-400' : 'text-slate-300'}`} />
          <div className="min-w-0">
            <p className={`text-xs truncate ${stats.lowStockItems > 0 ? 'text-amber-800' : 'text-slate-500'}`}>Running low</p>
            <p className={`text-lg font-bold leading-tight ${stats.lowStockItems > 0 ? 'text-amber-600' : 'text-slate-900'}`}>
              {stats.lowStockItems}
            </p>
          </div>
        </div>
      </div>

      {/* Category Edit Modal */}
      <AppModal
        open={isEditCategoryOpen}
        onClose={closeEditModal}
        title="Edit item"
        description="Update name, floor, or stock amounts"
        icon={<Pencil className="h-5 w-5" />}
        accent="amber"
      >
        <form onSubmit={handleEditCategorySubmit} className="space-y-4">
          {editError && <FormError message={editError} />}

          <FormInput
            label="Item name"
            type="text"
            required
            value={editCatName}
            onChange={(e) => setEditCatName(e.target.value)}
            accent="amber"
          />

          <FormInput
            label="Unit (e.g. pieces, 146, 124 Dr.)"
            type="text"
            required
            value={editCatUnit}
            onChange={(e) => setEditCatUnit(e.target.value)}
            accent="amber"
          />

          <PremiumSelect
            label="Which floor"
            value={editCatFloor}
            onChange={(value) => setEditCatFloor(value as Floor)}
            options={FLOOR_SELECT_OPTIONS}
            placeholder="Choose floor..."
            accent="amber"
            required
            name="editFloor"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormInput
              label="Total stock"
              type="number"
              required
              min={0}
              value={editCatInitial}
              onChange={(e) => setEditCatInitial(e.target.value === '' ? '' : Number(e.target.value))}
              accent="amber"
            />
            <FormInput
              label="Left in stock"
              type="number"
              required
              min={0}
              value={editCatCurrent}
              onChange={(e) => setEditCatCurrent(e.target.value === '' ? '' : Number(e.target.value))}
              accent="amber"
            />
          </div>

          <ModalActions onCancel={closeEditModal} submitLabel="Save changes" submitAccent="amber" />
        </form>
      </AppModal>

      {/* Category Delete Confirmation Modal */}
      <AppModal
        open={Boolean(deletingCategory)}
        onClose={() => setDeletingCategoryId(null)}
        title="Remove item?"
        description={
          deletingCategory
            ? `Remove "${deletingCategory.name}" from your stock list? Past records of items taken will still be kept.`
            : undefined
        }
        icon={<Trash2 className="h-5 w-5" />}
        accent="red"
      >
        <ModalActions
          onCancel={() => setDeletingCategoryId(null)}
          submitLabel="Remove"
          cancelLabel="Keep item"
          submitType="button"
          onSubmit={handleDeleteConfirm}
          submitAccent="red"
        />
      </AppModal>

      {/* Category Creation Modal */}
      <AppModal
        open={isAddCategoryOpen}
        onClose={() => setIsAddCategoryOpen(false)}
        title="Add new item"
        description="Add a product to track on your stock list"
        icon={<Plus className="h-5 w-5" />}
        accent="amber"
      >
        <form onSubmit={handleAddCategorySubmit} className="space-y-4">
          {catError && <FormError message={catError} />}

          <FormInput
            label="Item name"
            type="text"
            required
            placeholder="e.g. Parag piece"
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            accent="amber"
          />

          <FormInput
            label="Unit (e.g. pieces, 146, 124 Dr.)"
            type="text"
            required
            placeholder="e.g. pieces or 146"
            value={newCatUnit}
            onChange={(e) => setNewCatUnit(e.target.value)}
            accent="amber"
          />

          <PremiumSelect
            label="Which floor"
            value={newCatFloor}
            onChange={(value) => setNewCatFloor(value as Floor)}
            options={FLOOR_SELECT_OPTIONS}
            placeholder="Choose floor..."
            accent="amber"
            required
            name="newFloor"
          />

          <FormInput
            label="Starting amount"
            type="number"
            required
            min={0}
            placeholder="e.g. 100"
            value={newCatInitial}
            onChange={(e) => setNewCatInitial(e.target.value === '' ? '' : Number(e.target.value))}
            accent="amber"
          />

          <ModalActions
            onCancel={() => setIsAddCategoryOpen(false)}
            submitLabel="Add item"
            submitAccent="amber"
          />
        </form>
      </AppModal>

      {/* Add Stock Modal */}
      <AppModal
        open={isRestockOpen}
        onClose={() => setIsRestockOpen(false)}
        title="Add more stock"
        description="Increase the total and remaining stock for an item"
        icon={<ArrowUpRight className="h-5 w-5" />}
        accent="amber"
      >
        <form onSubmit={handleRestockSubmit} className="space-y-4">
          {restockError && <FormError message={restockError} />}

          <PremiumSelect
            label="Choose item"
            value={selectedCatIdForRestock}
            onChange={setSelectedCatIdForRestock}
            options={stockSelectOptions}
            placeholder="Choose an item..."
            searchable
            searchPlaceholder="Search items..."
            accent="amber"
            required
            name="restockItem"
          />

          <FormInput
            label="How much to add"
            type="number"
            required
            min={1}
            placeholder="e.g. 150"
            value={restockAmount}
            onChange={(e) => setRestockAmount(e.target.value === '' ? '' : Number(e.target.value))}
            accent="amber"
          />

          <ModalActions
            onCancel={() => setIsRestockOpen(false)}
            submitLabel="Add stock"
            submitAccent="amber"
          />
        </form>
      </AppModal>

      {/* Record withdrawal (admin) */}
      <AppModal
        open={isWithdrawOpen}
        onClose={closeWithdrawModal}
        title="Record taken stock"
        description="Log items taken out and assign them to a staff member"
        icon={<Send className="h-5 w-5" />}
        accent="emerald"
      >
        {staffMembers.length === 0 ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-600 leading-relaxed">
              No staff accounts found. Add staff users before recording taken stock.
            </p>
            <button
              type="button"
              onClick={closeWithdrawModal}
              className="w-full px-5 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition-all cursor-pointer"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleWithdrawSubmit} className="space-y-4">
            {withdrawError && <FormError message={withdrawError} />}

            <PremiumSelect
              label="Staff member"
              value={selectedStaffUsername}
              onChange={setSelectedStaffUsername}
              options={staffSelectOptions}
              placeholder="Choose staff..."
              disabled={isWithdrawSubmitting}
              searchable={staffSelectOptions.length > 4}
              searchPlaceholder="Search staff..."
              accent="emerald"
              required
              name="staffMember"
            />

            <PremiumSelect
              label="Which item"
              value={withdrawCategoryId}
              onChange={setWithdrawCategoryId}
              options={stockSelectOptions}
              placeholder="Choose an item..."
              disabled={isWithdrawSubmitting}
              searchable
              searchPlaceholder="Search items..."
              accent="emerald"
              required
              name="withdrawItem"
            />

            <FormInput
              label="How many taken"
              type="number"
              required
              min={1}
              placeholder="e.g. 5"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value === '' ? '' : Number(e.target.value))}
              disabled={isWithdrawSubmitting}
              accent="emerald"
            />

            <ModalActions
              onCancel={closeWithdrawModal}
              submitLabel="Save record"
              submitAccent="emerald"
              isSubmitting={isWithdrawSubmitting}
            />
          </form>
        )}
      </AppModal>
    </div>
  );
}
