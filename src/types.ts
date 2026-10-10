export interface Account {
  id: string;
  name: string;
  balance: number; // in cents
  balanceAsOf: string; // YYYY-MM-DD
  balanceAsOfMs: number; // timestamp in ms
}

export type PayCycle = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';

export interface Paycheck {
  id: string;
  label: string;
  amount: number; // in cents
  cycle: PayCycle;
  anchorDate: string; // YYYY-MM-DD (a reference payday)
}

export interface Bill {
  id: string;
  name: string;
  amount: number; // in cents
  dueDay: number; // 1-31
  dueMonth?: number; // 1-12 (for annual bills)
  recurrence: 'monthly' | 'annual';
  paidDates: string[]; // dates marked paid, e.g. "2026-10" or "2026-10-01"
  paidAt: Record<string, number>; // dateKey -> timestamp ms when marked paid
}

export interface Transaction {
  id: string;
  amount: number; // in cents
  category: string;
  date: string; // YYYY-MM-DD
  createdAt: number; // timestamp ms
  note?: string;
  account?: string;
  card?: boolean;
  owed?: boolean;
}

export interface Envelope {
  id: string;
  name: string;
  category: string;
  cap: number; // in cents per pay period
}

export interface Goal {
  id: string;
  name: string;
  targetAmount: number; // in cents
  savedAmount: number; // in cents
  monthlyAllocation: number; // in cents
}

export interface Debt {
  id: string;
  name: string;
  balance: number; // in cents
  apr: number; // annual percentage rate (e.g. 18.5 for 18.5%)
  minPayment: number; // in cents
}

export type DebtStrategy = 'snowball' | 'avalanche';
export type ThemeMode = 'light' | 'dark' | 'system';
export type ColorSchemeId =
  | 'royal-glimmer'
  | 'urban-slate'
  | 'jade-pebble'
  | 'amber-walnut'
  | 'sapphire-marina'
  | 'inked-vichy'
  | 'rose-quartz';

export interface SpendCategory {
  id: string;
  name: string;
  color: string;
  isQuick: boolean;
}

export type LayoutMode = 'everything' | 'simple';

export interface DeviceSyncState {
  isSynced: boolean;
  syncStatus: 'synced' | 'syncing' | 'local' | 'offline';
  lastSyncedAt?: number;
  recoveryKey?: string;
  pairingCode?: string;
  pairingExpiresAt?: number;
  vaultId?: string;
  deviceId?: string;
}

export type IncomeStatus = 'arrived' | 'soon' | 'later';

export interface IncomeItem {
  id: string;
  source: string;
  amount: number; // in cents
  date: string; // YYYY-MM-DD
  status: IncomeStatus;
  notes?: string;
  createdAt?: number;
}

export type MilestoneCategory = 'habit' | 'savings' | 'debt' | 'bills' | 'general';

export interface MilestoneItem {
  id: string;
  title: string;
  description: string;
  category: MilestoneCategory;
  isReached: boolean;
  reachedAt?: string;
  icon?: string;
}

export interface LedgerState {
  schemaVersion: 1;
  currency: string;
  theme: ThemeMode;
  colorScheme?: ColorSchemeId;
  userName?: string;
  plannerTitle?: string;
  layoutMode?: LayoutMode;
  sync?: DeviceSyncState;
  account: Account;
  paycheck: Paycheck;
  bills: Bill[];
  transactions: Transaction[];
  envelopes: Envelope[];
  goals: Goal[];
  debts: Debt[];
  debtStrategy: DebtStrategy;
  setAside: number; // in cents
  categories?: SpendCategory[];
  categoryLabels?: Record<string, string>;
  kindSide?: Record<string, 'living' | 'fun'>;
  incomes?: IncomeItem[];
  milestones?: MilestoneItem[];
  monthNotes?: Record<string, MonthNoteItem[]>;
}

export interface MonthNoteItem {
  id: string;
  text: string;
  createdAt: number;
}

export interface SafeCalculation {
  safeUntilPayday: number; // in cents
  safeToSpendToday: number; // in cents
  dailyStartingAllowance: number; // in cents
  spentTodayCents: number;
  daysLeft: number;
  nextPayday: string; // YYYY-MM-DD
  checkingBalance: number;
  billsDueCents: number;
  annualReserveCents: number;
  paidSinceBalanceCents: number;
  spentAfterBalanceCents: number;
  setAsideCents: number;
  unpaidBills: { bill: Bill; dueDate: string }[];
}

export interface DayEvent {
  id: string;
  type: 'payday' | 'bill' | 'spend';
  title: string;
  amount: number; // in cents
  isIncome: boolean;
  isPaid?: boolean;
  billId?: string;
  dueDateStr?: string;
}
