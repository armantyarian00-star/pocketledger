import { LedgerState, SpendCategory, IncomeItem, MilestoneItem } from './types';
import { formatISODate } from './payday';

const STORAGE_KEY = 'budgetplanner_v1';
const LEGACY_STORAGE_KEY = 'pocketledger_v1';

export const INITIAL_CATEGORIES: SpendCategory[] = [
  { id: 'cat-1', name: 'Coffee', color: '#9b2c59', isQuick: true },
  { id: 'cat-2', name: 'Food', color: '#b45309', isQuick: true },
  { id: 'cat-3', name: 'Groceries', color: '#15803d', isQuick: true },
  { id: 'cat-4', name: 'Gas', color: '#d97706', isQuick: false },
  { id: 'cat-5', name: 'Transit', color: '#2563eb', isQuick: false },
  { id: 'cat-6', name: 'Shopping', color: '#ea580c', isQuick: false },
  { id: 'cat-7', name: 'Bills', color: '#7c3aed', isQuick: false },
  { id: 'cat-8', name: 'Fun', color: '#db2777', isQuick: false },
  { id: 'cat-9', name: 'Other', color: '#64748b', isQuick: false }
];

export const DEFAULT_CATEGORY_LABELS: Record<string, string> = {
  bills: 'Bills & rent',
  living: 'Living & food',
  fun: 'Fun & friends',
  debt: 'To debt',
  savings: 'To savings',
  leftover: 'Left over'
};

export const DEFAULT_KIND_SIDE: Record<string, 'living' | 'fun'> = {
  'Coffee': 'fun',
  'Fun': 'fun',
  'Food': 'living',
  'Groceries': 'living',
  'Transit': 'living',
  'Gas': 'living',
  'Shopping': 'fun',
  'Bills': 'living',
  'Other': 'living'
};

export const INITIAL_INCOMES: IncomeItem[] = [
  {
    id: 'inc-1',
    source: 'Freelance Design Sprint',
    amount: 35000, // $350.00
    date: formatISODate(new Date()),
    status: 'arrived',
    notes: 'Paid via direct transfer',
    createdAt: Date.now() - 86400000
  },
  {
    id: 'inc-2',
    source: 'Etsy Digital Template Sales',
    amount: 12500, // $125.00
    date: formatISODate(new Date()),
    status: 'soon',
    notes: 'Scheduled payout this Friday',
    createdAt: Date.now()
  },
  {
    id: 'inc-3',
    source: 'Cashback & Rebates',
    amount: 4500, // $45.00
    date: formatISODate(new Date()),
    status: 'later',
    notes: 'Credit card rewards point conversion',
    createdAt: Date.now()
  }
];

export const INITIAL_MILESTONES: MilestoneItem[] = [
  {
    id: 'first_spend',
    title: 'First Spend Logged',
    description: 'Captured an expense into your daily safe log.',
    category: 'habit',
    isReached: true,
    reachedAt: 'Day 1',
    icon: '⚡'
  },
  {
    id: 'streak_3_spends',
    title: 'Habit Builder',
    description: 'Logged 3 or more transactions without losing count.',
    category: 'habit',
    isReached: false,
    icon: '🔥'
  },
  {
    id: 'first_bill_paid',
    title: 'Bill Destroyer',
    description: 'Marked your first essential bill as paid on time.',
    category: 'bills',
    isReached: false,
    icon: '🛡️'
  },
  {
    id: 'all_bills_paid',
    title: 'Zero Bill Overdue',
    description: 'All essential bills due for the current cycle are satisfied.',
    category: 'bills',
    isReached: false,
    icon: '✨'
  },
  {
    id: 'emergency_buffer',
    title: 'Safe Harbor Buffer',
    description: 'Preserved positive safe-to-spend allowance without dipping negative.',
    category: 'savings',
    isReached: true,
    reachedAt: 'Day 3',
    icon: '⚓'
  },
  {
    id: 'first_goal_started',
    title: 'Dream In Motion',
    description: 'Allocated your first funds toward a meaningful goal.',
    category: 'savings',
    isReached: true,
    reachedAt: 'Day 2',
    icon: '🎯'
  },
  {
    id: 'first_envelope_funded',
    title: 'Envelope Guard',
    description: 'Assigned an envelope spend cap to prevent impulse blowouts.',
    category: 'habit',
    isReached: true,
    reachedAt: 'Day 1',
    icon: '✉️'
  },
  {
    id: 'debt_payment_logged',
    title: 'Debt Crusher',
    description: 'Made an active payment reducing total outstanding debt balance.',
    category: 'debt',
    isReached: false,
    icon: '📉'
  }
];

export function getDefaultState(): LedgerState {
  const todayStr = formatISODate(new Date());
  return {
    schemaVersion: 1,
    currency: 'USD',
    theme: 'light',
    colorScheme: 'royal-glimmer',
    userName: '',
    plannerTitle: 'My Everyday Money Plan',
    layoutMode: 'everything',
    account: {
      id: 'acct-main',
      name: 'Main Checking',
      balance: 150000, // $1,500.00
      balanceAsOf: todayStr,
      balanceAsOfMs: Date.now()
    },
    paycheck: {
      id: 'pay-main',
      label: 'Main Income',
      amount: 250000, // $2,500.00
      cycle: 'biweekly',
      anchorDate: todayStr
    },
    bills: [
      {
        id: 'bill-1',
        name: 'Rent / Mortgage',
        amount: 80000, // $800.00
        dueDay: 1,
        recurrence: 'monthly',
        paidDates: [],
        paidAt: {}
      },
      {
        id: 'bill-2',
        name: 'Internet & Utilities',
        amount: 8500, // $85.00
        dueDay: 15,
        recurrence: 'monthly',
        paidDates: [],
        paidAt: {}
      },
      {
        id: 'bill-3',
        name: 'Vehicle Insurance (Annual)',
        amount: 60000, // $600.00 / year ($50 / month reserve)
        dueDay: 20,
        dueMonth: 12,
        recurrence: 'annual',
        paidDates: [],
        paidAt: {}
      }
    ],
    envelopes: [
      {
        id: 'env-1',
        name: 'Food & Groceries',
        category: 'Food',
        cap: 40000 // $400.00
      },
      {
        id: 'env-2',
        name: 'Coffee & Drinks',
        category: 'Coffee',
        cap: 6000 // $60.00
      },
      {
        id: 'env-3',
        name: 'Transport & Gas',
        category: 'Transit',
        cap: 10000 // $100.00
      },
      {
        id: 'env-4',
        name: 'Shopping & Leisure',
        category: 'Shopping',
        cap: 15000 // $150.00
      }
    ],
    goals: [
      {
        id: 'goal-1',
        name: 'Emergency Fund',
        targetAmount: 100000, // $1,000.00
        savedAmount: 35000, // $350.00
        monthlyAllocation: 10000 // $100.00 / month
      },
      {
        id: 'goal-2',
        name: 'Vacation Trip',
        targetAmount: 60000, // $600.00
        savedAmount: 20000, // $200.00
        monthlyAllocation: 5000 // $50.00 / month
      }
    ],
    debts: [
      {
        id: 'debt-1',
        name: 'Visa Credit Card',
        balance: 120000, // $1,200.00
        apr: 21.5,
        minPayment: 6000 // $60.00 / month
      },
      {
        id: 'debt-2',
        name: 'Personal Loan',
        balance: 250000, // $2,500.00
        apr: 11.0,
        minPayment: 10000 // $100.00 / month
      }
    ],
    debtStrategy: 'snowball',
    transactions: [],
    setAside: 0,
    categories: [...INITIAL_CATEGORIES],
    categoryLabels: { ...DEFAULT_CATEGORY_LABELS },
    kindSide: { ...DEFAULT_KIND_SIDE },
    incomes: [...INITIAL_INCOMES],
    milestones: [...INITIAL_MILESTONES],
    monthNotes: {},
    sync: {
      isSynced: true,
      syncStatus: 'synced',
      lastSyncedAt: Date.now(),
      recoveryKey: 'PL-8A2F-9C4D-7E1B',
      pairingCode: '553 699',
      pairingExpiresAt: Date.now() + 10 * 60 * 1000
    }
  };
}

export function loadState(): LedgerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return getDefaultState();
    const parsed = JSON.parse(raw);
    if (parsed && parsed.schemaVersion === 1 && parsed.account && parsed.paycheck) {
      const def = getDefaultState();
      if (!Array.isArray(parsed.bills)) parsed.bills = def.bills;
      if (!Array.isArray(parsed.transactions)) parsed.transactions = [];
      if (!Array.isArray(parsed.envelopes)) parsed.envelopes = def.envelopes;
      if (!Array.isArray(parsed.goals)) parsed.goals = def.goals;
      if (!Array.isArray(parsed.debts)) parsed.debts = def.debts;
      if (!parsed.debtStrategy) parsed.debtStrategy = 'snowball';
      if (!parsed.theme || parsed.theme === 'system') parsed.theme = 'light';
      if (!parsed.colorScheme) parsed.colorScheme = 'royal-glimmer';
      if (!parsed.currency) parsed.currency = 'USD';
      if (parsed.userName === undefined) parsed.userName = '';
      if (!parsed.plannerTitle) parsed.plannerTitle = 'My Everyday Money Plan';
      if (!parsed.layoutMode) parsed.layoutMode = 'everything';
      if (!Array.isArray(parsed.categories) || parsed.categories.length === 0) {
        parsed.categories = [...INITIAL_CATEGORIES];
      }
      if (!parsed.categoryLabels || typeof parsed.categoryLabels !== 'object') {
        parsed.categoryLabels = { ...DEFAULT_CATEGORY_LABELS };
      }
      if (!parsed.kindSide || typeof parsed.kindSide !== 'object') {
        parsed.kindSide = { ...DEFAULT_KIND_SIDE };
      }
      if (!Array.isArray(parsed.incomes)) {
        parsed.incomes = [...INITIAL_INCOMES];
      }
      if (!Array.isArray(parsed.milestones) || parsed.milestones.length === 0) {
        parsed.milestones = [...INITIAL_MILESTONES];
      }
      if (!parsed.monthNotes || typeof parsed.monthNotes !== 'object') {
        parsed.monthNotes = {};
      }
      if (!parsed.sync) {
        parsed.sync = def.sync;
      }
      return parsed as LedgerState;
    }
    return getDefaultState();
  } catch (err) {
    console.error('Failed to load state from localStorage:', err);
    return getDefaultState();
  }
}

export function saveState(state: LedgerState): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    console.error('Failed to save state to localStorage:', err);
    return false;
  }
}

export function exportBackupJSON(state: LedgerState): string {
  return JSON.stringify(state, null, 2);
}

export function importBackupJSON(jsonStr: string): LedgerState | null {
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && parsed.schemaVersion === 1 && parsed.account && parsed.paycheck) {
      const def = getDefaultState();
      if (!Array.isArray(parsed.bills)) parsed.bills = def.bills;
      if (!Array.isArray(parsed.transactions)) parsed.transactions = [];
      if (!Array.isArray(parsed.envelopes)) parsed.envelopes = def.envelopes;
      if (!Array.isArray(parsed.goals)) parsed.goals = def.goals;
      if (!Array.isArray(parsed.debts)) parsed.debts = def.debts;
      if (!parsed.debtStrategy) parsed.debtStrategy = 'snowball';
      if (!parsed.theme || parsed.theme === 'system') parsed.theme = 'light';
      if (!parsed.colorScheme) parsed.colorScheme = 'royal-glimmer';
      if (!parsed.currency) parsed.currency = 'USD';
      if (parsed.userName === undefined) parsed.userName = '';
      if (!parsed.plannerTitle) parsed.plannerTitle = 'My Everyday Money Plan';
      if (!parsed.layoutMode) parsed.layoutMode = 'everything';
      if (!Array.isArray(parsed.categories) || parsed.categories.length === 0) {
        parsed.categories = [...INITIAL_CATEGORIES];
      }
      if (!parsed.categoryLabels || typeof parsed.categoryLabels !== 'object') {
        parsed.categoryLabels = { ...DEFAULT_CATEGORY_LABELS };
      }
      if (!parsed.kindSide || typeof parsed.kindSide !== 'object') {
        parsed.kindSide = { ...DEFAULT_KIND_SIDE };
      }
      if (!Array.isArray(parsed.incomes)) parsed.incomes = [];
      if (!Array.isArray(parsed.milestones) || parsed.milestones.length === 0) {
        parsed.milestones = [...INITIAL_MILESTONES];
      }
      if (!parsed.monthNotes || typeof parsed.monthNotes !== 'object') {
        parsed.monthNotes = {};
      }
      if (!parsed.sync) {
        parsed.sync = def.sync;
      }
      return parsed as LedgerState;
    }
    return null;
  } catch (err) {
    console.error('Failed to parse backup JSON:', err);
    return null;
  }
}

export function getFreshEmptyState(): LedgerState {
  const todayStr = formatISODate(new Date());
  return {
    schemaVersion: 1,
    currency: 'USD',
    theme: 'light',
    colorScheme: 'royal-glimmer',
    userName: '',
    plannerTitle: 'My Everyday Money Plan',
    layoutMode: 'everything',
    account: {
      id: 'acct-main',
      name: 'Main Checking',
      balance: 0,
      balanceAsOf: todayStr,
      balanceAsOfMs: Date.now()
    },
    paycheck: {
      id: 'pay-main',
      label: 'Main Income',
      amount: 0,
      cycle: 'biweekly',
      anchorDate: todayStr
    },
    bills: [],
    envelopes: [],
    goals: [],
    debts: [],
    debtStrategy: 'snowball',
    transactions: [],
    setAside: 0,
    categories: [...INITIAL_CATEGORIES],
    incomes: [],
    milestones: [...INITIAL_MILESTONES],
    monthNotes: {},
    sync: {
      isSynced: false,
      syncStatus: 'local',
      lastSyncedAt: undefined,
      recoveryKey: 'PL-8A2F-9C4D-7E1B',
      pairingCode: '553 699',
      pairingExpiresAt: Date.now() + 10 * 60 * 1000
    }
  };
}

export function resetState(clean: boolean = false): LedgerState {
  const newState = clean ? getFreshEmptyState() : getDefaultState();
  saveState(newState);
  return newState;
}

export function exportTransactionsCSV(state: LedgerState): string {
  const headers = ['Date', 'Category', 'Amount', 'Note', 'CreatedAt'];
  const rows = state.transactions.map(t => [
    t.date,
    `"${t.category.replace(/"/g, '""')}"`,
    (t.amount / 100).toFixed(2),
    `"${(t.note || '').replace(/"/g, '""')}"`,
    new Date(t.createdAt).toISOString()
  ]);
  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}
