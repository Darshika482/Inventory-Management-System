export type Role = 'Admin' | 'Worker';

export interface User {
  id: string;
  username: string;
  role: Role;
}

export interface Category {
  id: string;
  name: string;
  unit: string;
  initialStock: number;
  currentQuantity: number;
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
