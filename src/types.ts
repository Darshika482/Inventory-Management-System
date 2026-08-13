export type Role = 'Admin' | 'Worker';

export type Floor = 'First Floor' | 'Second Floor';

export interface User {
  id: string;
  username: string;
  role: Role;
}

export interface Category {
  id: string;
  name: string;
  unit: string;
  floor: Floor;
  initialStock: number;
  currentQuantity: number;
  createdAt: string;
}

export interface WithdrawalLog {
  id: string;
  workerId: string;
  categoryId: string;
  categoryName: string;
  quantity: number;
  timestamp: string; // formatted e.g., "Jun 9, 2026 at 3:42 PM"
  status: 'Approved' | 'Rejected';
}

export interface StockAddition {
  id: string;
  categoryId: string;
  categoryName: string;
  quantity: number;
  floor: Floor;
  unit: string;
  type: 'new' | 'restock';
  timestamp: string;
  createdAt: string;
}

// --- Firm bills (purchases) ---

export type PaymentMethod = 'Cash' | 'Cheque' | 'Bank transfer' | 'UPI';

export interface BillLineItem {
  name: string;
  quantity: number;
  unit: string; // e.g. Piece, Meter, Kg
  rate: number;
  amount: number;
}

export interface BillDiscount {
  name: string; // e.g. "Cash discount", "Scheme discount"
  amount: number;
}

export interface PurchaseBill {
  id: string;
  firmName: string;
  billNo: string;
  billDate: string; // YYYY-MM-DD, may be empty if unknown
  gstNumber: string;
  lrNo: string;
  transportName: string;
  items: BillLineItem[];
  grossAmount: number;
  discounts: BillDiscount[];
  discount: number; // total of all discounts
  gstAmount: number;
  netAmount: number;
  photoUrl: string | null;
  createdAt: string;
}

export interface BillPayment {
  id: string;
  billId: string;
  paidOn: string; // YYYY-MM-DD
  amount: number;
  method: PaymentMethod;
  reference: string; // cheque no. / UTR / UPI transaction id
  bankName: string;
  photoUrl: string | null;
  createdAt: string;
}

/**
 * Combines different spellings of the same item on bills into one item for
 * the rate analysis (e.g. "Dyed Cloth CT L Titan" + "Dyed Cloth Titan").
 */
export interface ItemGroup {
  id: string;
  name: string; // display name for the combined item
  members: string[]; // normalized (lowercased, single-spaced) bill item names
  createdAt: string;
}

// --- Workers (salary & job work) ---

export type WorkerType = 'Shop' | 'Job work';

export interface Worker {
  id: string;
  name: string;
  type: WorkerType;
  phone: string;
  monthlySalary: number; // for shop workers; 0 for job workers
  note: string;
  createdAt: string;
}

/** One line of goods inside a give / receive transaction. */
export interface GoodsItem {
  item: string; // e.g. "Cotton cloth", "Falls"
  quantity: number;
  unit: string; // e.g. Meter, Dozen
}

/** Cloth / raw material handed to a job worker for stitching (one transaction, many items). */
export interface GoodsIssue {
  id: string;
  workerId: string;
  issuedOn: string; // YYYY-MM-DD
  items: GoodsItem[];
  note: string;
  createdAt: string;
}

/** Finished pieces (falls) brought back by a job worker (one transaction, many items). */
export interface GoodsReturn {
  id: string;
  workerId: string;
  returnedOn: string; // YYYY-MM-DD
  items: GoodsItem[];
  metersUsed: number; // cloth worked on for this return, in meters
  rate: number; // wage per meter worked; 0 if the amount was entered directly
  amount: number; // wage earned for this return
  note: string;
  createdAt: string;
}

export interface WorkerPayment {
  id: string;
  workerId: string;
  paidOn: string; // YYYY-MM-DD
  amount: number;
  method: PaymentMethod;
  reference: string;
  bankName: string;
  photoUrl: string | null;
  note: string;
  createdAt: string;
}

// --- Transport bills (bilty / freight charges) ---

export interface TransportBill {
  id: string;
  receivedDate: string; // YYYY-MM-DD — the day the parcel arrived; may be empty
  transportName: string;
  item: string; // what was in the parcel, e.g. "Cotton bales"
  weight: string; // as printed on the bilty, e.g. "250 kg"
  biltyNo: string;
  partyName: string; // who sent the goods
  amount: number; // freight amount to pay
  photoUrl: string | null;
  createdAt: string;
}
