import type { Milli, Paise } from './money';
import type { BillType } from './fy';

export type Language = 'hi' | 'en';

/** A UPI account the shop can be paid into. */
export interface UpiAccount {
  id: string;
  /** What the owner calls it, e.g. "PNB · Akshay Traders". */
  label: string;
  upiId: string;
  /** The name on the bank's own QR; empty: the shop name is used. */
  payeeName: string;
  /** The bank's merchant code (mc on its QR); empty for a personal account. */
  merchantCode: string;
}

export interface ShopSettings {
  shopName: string;
  address: string;
  phone: string;
  gstin: string;
  stateCode: string;
  /** The UPI ID whose QR goes on bills. */
  upiId: string;
  /** Saved UPI accounts to choose from; null until supabase/shop/13-upi-accounts.sql is run. */
  upiAccounts?: UpiAccount[] | null;
  printerWidthMm: 58 | 80;
  ratesIncludeGst: boolean;
  receiptFooter: string;
  language: Language;
}

export interface ShopCategory {
  id: string;
  name: string;
  nameHi: string;
  sortOrder: number;
  isActive: boolean;
}

export interface ShopItem {
  id: string;
  categoryId: string | null;
  name: string;
  nameHi: string;
  unit: string;
  saleRate: Paise;
  purchaseRate: Paise;
  gstRate: number;
  hsn: string;
  isActive: boolean;
}

export type PartyType = 'customer' | 'supplier' | 'both';

export interface ShopParty {
  id: string;
  name: string;
  phone: string;
  address: string;
  gstin: string;
  stateCode: string;
  partyType: PartyType;
  /** Positive = they owe the shop. */
  openingBalance: Paise;
  isActive: boolean;
}

export type PaymentMode = 'cash' | 'upi' | 'credit' | 'partial';
export type PaidMode = 'cash' | 'upi';

export interface ShopInvoiceLine {
  itemId: string | null;
  itemName: string;
  hsn: string;
  unit: string;
  qty: Milli;
  rate: Paise;
  gstRate: number;
  discountAmount: Paise;
  taxableAmount: Paise;
  taxAmount: Paise;
  lineTotal: Paise;
}

/** Where a bill is: on the server, waiting on this phone, or refused by the server. */
export type SyncState = 'synced' | 'pending' | 'failed';

export interface ShopInvoice {
  id: string | null; // null until the server has it
  clientId: string;
  billType: BillType;
  series: string;
  billNumber: string | null; // null when made offline before this phone had a number series
  fy: string;
  billDate: string; // YYYY-MM-DD, India time
  partyId: string | null;
  partyName: string;
  partyGstin: string;
  isGst: boolean;
  isInterstate: boolean;
  ratesIncludeGst: boolean;
  paymentMode: PaymentMode;
  paidMode: PaidMode | null;
  itemsTotal: Paise;
  subtotal: Paise;
  discount: Paise;
  /** Hundredths of a percent (5% = 500) when the discount was typed as a %. */
  discountPercent: number | null;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  roundOff: Paise;
  total: Paise;
  paidAmount: Paise;
  status: 'active' | 'cancelled';
  notes: string;
  createdBy: string | null;
  createdAt: string;
  /** 1 for a bill as first saved; each edit by the owner makes the next one. */
  version?: number;
  /** When and by whom the bill was last edited (version 2 on). */
  editedAt?: string | null;
  editedBy?: string | null;
  lines: ShopInvoiceLine[];
  syncState: SyncState;
  syncError?: string;
}
