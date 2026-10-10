import {
  LedgerState,
  SafeCalculation,
  Bill,
  Transaction,
  Envelope,
  Goal,
  Debt,
  DayEvent,
  IncomeItem
} from './types';
import { getNextPayday, getDaysLeft, parseISODate, formatISODate } from './payday';

/**
 * Currency formatter supporting multiple currencies
 */
export function formatCurrency(cents: number, currency: string = 'USD'): string {
  const isNegative = cents < 0;
  const abs = Math.abs(cents);

  if (currency === 'IDR') {
    // IDR: Rp X.XXX.XXX (represented standard integer cents as Rp 1 = 100 cents or 1:1)
    const formatted = Math.floor(abs / 100).toLocaleString('id-ID');
    return `${isNegative ? '-' : ''}Rp ${formatted}`;
  }

  if (currency === 'EUR') {
    const formatted = (abs / 100).toLocaleString('de-DE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return `${isNegative ? '-' : ''}€${formatted}`;
  }

  if (currency === 'GBP') {
    const formatted = (abs / 100).toLocaleString('en-GB', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return `${isNegative ? '-' : ''}£${formatted}`;
  }

  if (currency === 'JPY') {
    const formatted = Math.floor(abs / 100).toLocaleString('ja-JP');
    return `${isNegative ? '-' : ''}¥${formatted}`;
  }

  if (currency === 'INR') {
    const formatted = (abs / 100).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return `${isNegative ? '-' : ''}₹${formatted}`;
  }

  if (currency === 'AUD') {
    const formatted = (abs / 100).toLocaleString('en-AU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return `${isNegative ? '-' : ''}A$${formatted}`;
  }

  if (currency === 'CAD') {
    const formatted = (abs / 100).toLocaleString('en-CA', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return `${isNegative ? '-' : ''}C$${formatted}`;
  }

  if (currency === 'CHF') {
    const formatted = (abs / 100).toLocaleString('de-CH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return `${isNegative ? '-' : ''}CHF ${formatted}`;
  }

  if (currency === 'SEK') {
    const formatted = (abs / 100).toLocaleString('sv-SE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return `${isNegative ? '-' : ''}${formatted} kr`;
  }

  if (currency === 'PLN') {
    const formatted = (abs / 100).toLocaleString('pl-PL', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return `${isNegative ? '-' : ''}${formatted} zł`;
  }

  if (currency === 'BRL') {
    const formatted = (abs / 100).toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return `${isNegative ? '-' : ''}R$ ${formatted}`;
  }

  if (currency === 'ZAR') {
    const formatted = (abs / 100).toLocaleString('en-ZA', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return `${isNegative ? '-' : ''}R ${formatted}`;
  }

  if (currency === 'AED') {
    const formatted = (abs / 100).toLocaleString('en-AE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return `${isNegative ? '-' : ''}AED ${formatted}`;
  }

  if (currency === 'SGD') {
    const formatted = (abs / 100).toLocaleString('en-SG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return `${isNegative ? '-' : ''}S$${formatted}`;
  }

  // Default USD
  const formatted = (abs / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return `${isNegative ? '-' : ''}$${formatted}`;
}

/**
 * Checks whether a transaction occurred AFTER the checking balance was entered/updated.
 */
export function isTransactionAfterBalance(
  txDate: string,
  txCreatedAt: number,
  balanceAsOfDate: string,
  balanceAsOfMs: number
): boolean {
  if (txDate > balanceAsOfDate) return true;
  if (txDate < balanceAsOfDate) return false;
  return txCreatedAt > balanceAsOfMs;
}

/**
 * Checks whether a bill marked paid was paid AFTER the checking balance was entered.
 */
export function isBillPaidAfterBalance(
  paidAtMs: number | undefined,
  balanceAsOfMs: number
): boolean {
  if (!paidAtMs) return false;
  return paidAtMs > balanceAsOfMs;
}

/**
 * Resolves upcoming bill due dates between today and next payday.
 */
export function getBillsDueBetween(
  bills: Bill[],
  todayStr: string,
  nextPaydayStr: string
): { bill: Bill; dueDate: string; isPaid: boolean }[] {
  const today = parseISODate(todayStr);
  const payday = parseISODate(nextPaydayStr);
  const result: { bill: Bill; dueDate: string; isPaid: boolean }[] = [];

  const monthsToCheck = [
    { year: today.getFullYear(), month: today.getMonth() },
    { year: payday.getFullYear(), month: payday.getMonth() }
  ];

  const seenKeys = new Set<string>();

  for (const bill of bills) {
    if (bill.recurrence === 'annual') {
      // Annual bills only occur in their specific month
      const targetMonth = (bill.dueMonth || 1) - 1; // 0-indexed
      for (const m of monthsToCheck) {
        if (m.month === targetMonth) {
          const maxDay = new Date(m.year, m.month + 1, 0).getDate();
          const actualDay = Math.min(bill.dueDay, maxDay);
          const dueDateStr = formatISODate(new Date(m.year, m.month, actualDay));
          const uniqueKey = `${bill.id}_${dueDateStr}`;
          if (!seenKeys.has(uniqueKey) && dueDateStr >= todayStr && dueDateStr < nextPaydayStr) {
            seenKeys.add(uniqueKey);
            result.push({ bill, dueDate: dueDateStr, isPaid: bill.paidDates.includes(dueDateStr) });
          }
        }
      }
    } else {
      // Monthly recurrence
      for (const m of monthsToCheck) {
        const maxDay = new Date(m.year, m.month + 1, 0).getDate();
        const actualDay = Math.min(bill.dueDay, maxDay);
        const dueDateObj = new Date(m.year, m.month, actualDay);
        const dueDateStr = formatISODate(dueDateObj);

        const uniqueKey = `${bill.id}_${dueDateStr}`;
        if (seenKeys.has(uniqueKey)) continue;
        seenKeys.add(uniqueKey);

        // All bills due before next payday:
        if (dueDateStr < nextPaydayStr) {
          const isPaid = bill.paidDates.includes(dueDateStr);
          result.push({ bill, dueDate: dueDateStr, isPaid });
        }
      }
    }
  }

  return result.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/**
 * Core calculation of Safe to Spend Today
 */
export function calculateSafeToSpend(state: LedgerState, todayStr: string): SafeCalculation {
  const nextPayday = getNextPayday(state.paycheck, todayStr);
  const daysLeft = getDaysLeft(todayStr, nextPayday);

  const checkingBalance = state.account.balance;
  const balanceAsOfDate = state.account.balanceAsOf;
  const balanceAsOfMs = state.account.balanceAsOfMs;

  // 1. Unpaid bills due before next payday
  const billOccurrences = getBillsDueBetween(state.bills, todayStr, nextPayday);
  const unpaidBills = billOccurrences.filter(b => !b.isPaid);
  const billsDueCents = unpaidBills.reduce((sum, b) => sum + b.bill.amount, 0);

  // 2. Annual bill monthly reserve amortizations
  let annualReserveCents = 0;
  for (const bill of state.bills) {
    if (bill.recurrence === 'annual') {
      annualReserveCents += Math.floor(bill.amount / 12);
    }
  }

  // 3. Transactions logged AFTER balance entry (split into today vs past)
  let spentTodayCents = 0;
  let spentPastAfterBalanceCents = 0;
  for (const tx of state.transactions) {
    if (isTransactionAfterBalance(tx.date, tx.createdAt, balanceAsOfDate, balanceAsOfMs)) {
      if (tx.date === todayStr) {
        spentTodayCents += tx.amount;
      } else {
        spentPastAfterBalanceCents += tx.amount;
      }
    }
  }

  const spentAfterBalanceCents = spentTodayCents + spentPastAfterBalanceCents;
  const setAsideCents = state.setAside || 0;

  // Base safe pool before today's spending:
  const baseSafePool =
    checkingBalance -
    billsDueCents -
    annualReserveCents -
    spentPastAfterBalanceCents -
    setAsideCents;

  const dailyStartingAllowance = Math.max(0, Math.floor(baseSafePool / daysLeft));
  const safeToSpendToday = Math.max(0, dailyStartingAllowance - spentTodayCents);
  const safeUntilPayday = Math.max(0, baseSafePool - spentTodayCents);

  return {
    safeUntilPayday,
    safeToSpendToday,
    dailyStartingAllowance,
    spentTodayCents,
    daysLeft,
    nextPayday,
    checkingBalance,
    billsDueCents,
    annualReserveCents,
    paidSinceBalanceCents: 0,
    spentAfterBalanceCents,
    setAsideCents,
    unpaidBills: unpaidBills.map(u => ({ bill: u.bill, dueDate: u.dueDate }))
  };
}

/**
 * Envelopes calculation for current pay cycle
 */
export interface EnvelopeStatus {
  envelope: Envelope;
  spentCents: number;
  leftCents: number;
  percentUsed: number;
  isOver: boolean;
}

export function calculateEnvelopes(
  state: LedgerState,
  todayStr: string
): {
  items: EnvelopeStatus[];
  totalCaps: number;
  totalSpent: number;
  totalLeft: number;
} {
  const currentMonth = todayStr.slice(0, 7);
  let totalCaps = 0;
  let totalSpent = 0;

  const items = (state.envelopes || []).map(env => {
    totalCaps += env.cap;
    const spentCents = state.transactions
      .filter(t => t.date.startsWith(currentMonth) && t.category.toLowerCase() === env.category.toLowerCase())
      .reduce((sum, t) => sum + t.amount, 0);

    totalSpent += spentCents;
    const leftCents = Math.max(0, env.cap - spentCents);
    const percentUsed = env.cap > 0 ? Math.min(100, Math.round((spentCents / env.cap) * 100)) : 0;
    const isOver = spentCents > env.cap;

    return {
      envelope: env,
      spentCents,
      leftCents,
      percentUsed,
      isOver
    };
  });

  return {
    items,
    totalCaps,
    totalSpent,
    totalLeft: Math.max(0, totalCaps - totalSpent)
  };
}

/**
 * Savings Goals calculation
 */
export interface GoalStatus {
  goal: Goal;
  percent: number;
  remainingCents: number;
  monthsRemaining: number | null;
}

export function calculateGoals(state: LedgerState): {
  items: GoalStatus[];
  totalTarget: number;
  totalSaved: number;
  totalMonthly: number;
} {
  let totalTarget = 0;
  let totalSaved = 0;
  let totalMonthly = 0;

  const items = (state.goals || []).map(g => {
    totalTarget += g.targetAmount;
    totalSaved += g.savedAmount;
    totalMonthly += g.monthlyAllocation;

    const remainingCents = Math.max(0, g.targetAmount - g.savedAmount);
    const percent = g.targetAmount > 0
      ? Math.min(100, Math.round((g.savedAmount / g.targetAmount) * 100))
      : 0;
    const monthsRemaining = g.monthlyAllocation > 0
      ? Math.ceil(remainingCents / g.monthlyAllocation)
      : null;

    return {
      goal: g,
      percent,
      remainingCents,
      monthsRemaining
    };
  });

  return { items, totalTarget, totalSaved, totalMonthly };
}

/**
 * Debt Payoff Calculation (Snowball vs Avalanche)
 */
export interface DebtStatus {
  debt: Debt;
  monthsToPayoff: number;
  monthlyInterest: number;
}

export function calculateDebts(state: LedgerState): {
  items: DebtStatus[];
  totalBalance: number;
  totalMinPayment: number;
  strategy: 'snowball' | 'avalanche';
  maxMonths: number;
} {
  const strategy = state.debtStrategy || 'snowball';
  const debts = [...(state.debts || [])];

  if (strategy === 'snowball') {
    debts.sort((a, b) => a.balance - b.balance); // smallest balance first
  } else {
    debts.sort((a, b) => b.apr - a.apr); // highest APR first
  }

  let totalBalance = 0;
  let totalMinPayment = 0;
  let maxMonths = 0;

  const items = debts.map(d => {
    totalBalance += d.balance;
    totalMinPayment += d.minPayment;

    const monthlyRate = (d.apr / 100) / 12;
    const monthlyInterest = Math.round(d.balance * monthlyRate);

    // Approximate payoff months
    let months = 1;
    if (d.minPayment <= monthlyInterest) {
      months = 999; // Interest exceeds payment
    } else {
      const balance = d.balance;
      const payment = d.minPayment;
      // Formula: -ln(1 - (balance * r / payment)) / ln(1 + r)
      const numerator = -Math.log(1 - (balance * monthlyRate) / payment);
      const denominator = Math.log(1 + monthlyRate);
      months = Math.max(1, Math.ceil(numerator / denominator));
    }

    if (months > maxMonths && months < 999) {
      maxMonths = months;
    }

    return {
      debt: d,
      monthsToPayoff: months,
      monthlyInterest
    };
  });

  return {
    items,
    totalBalance,
    totalMinPayment,
    strategy,
    maxMonths
  };
}

/**
 * Calendar month structure for interactive month planner
 */
export interface CalendarDay {
  dateStr: string;
  dayNumber: number;
  isToday: boolean;
  isCurrentMonth: boolean;
  isPayday: boolean;
  events: DayEvent[];
  totalSpent: number;
}

export function getMonthCalendarDays(
  state: LedgerState,
  year: number,
  month: number,
  todayStr: string
): CalendarDay[] {
  const days: CalendarDay[] = [];
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const anchor = parseISODate(state.paycheck.anchorDate);
  const paydaysThisMonth = new Set<string>();
  for (let d = 1; d <= daysInMonth; d++) {
    const curDate = new Date(year, month, d);
    const curDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    
    let isPayday = false;
    if (state.paycheck.cycle === 'weekly' || state.paycheck.cycle === 'biweekly') {
      const step = state.paycheck.cycle === 'weekly' ? 7 : 14;
      const diffDays = Math.round((curDate.getTime() - anchor.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays % step === 0) {
        isPayday = true;
      }
    } else if (state.paycheck.cycle === 'monthly') {
      if (d === anchor.getDate()) {
        isPayday = true;
      }
    } else if (state.paycheck.cycle === 'semimonthly') {
      if (d === 15 || d === daysInMonth) {
        isPayday = true;
      }
    }

    if (isPayday) {
      paydaysThisMonth.add(curDateStr);
    }
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday = dateStr === todayStr;
    const isPayday = paydaysThisMonth.has(dateStr);
    const events: DayEvent[] = [];

    if (isPayday) {
      events.push({
        id: `pay_${dateStr}`,
        type: 'payday',
        title: state.paycheck.label || 'Payday',
        amount: state.paycheck.amount,
        isIncome: true
      });
    }

    for (const bill of state.bills) {
      const matchMonth = bill.recurrence === 'annual' ? (bill.dueMonth || 1) === (month + 1) : true;
      if (bill.dueDay === d && matchMonth) {
        const isPaid = bill.paidDates.includes(dateStr);
        events.push({
          id: `bill_${bill.id}_${dateStr}`,
          type: 'bill',
          title: bill.name,
          amount: bill.amount,
          isIncome: false,
          isPaid,
          billId: bill.id,
          dueDateStr: dateStr
        });
      }
    }

    let daySpent = 0;
    const dayTxs = state.transactions.filter(t => t.date === dateStr);
    for (const tx of dayTxs) {
      daySpent += tx.amount;
      events.push({
        id: tx.id,
        type: 'spend',
        title: tx.category,
        amount: tx.amount,
        isIncome: false
      });
    }

    days.push({
      dateStr,
      dayNumber: d,
      isToday,
      isCurrentMonth: true,
      isPayday,
      events,
      totalSpent: daySpent
    });
  }

  return days;
}

/**
 * Creates a new transaction and appends to state
 */
export function addTransaction(
  state: LedgerState,
  amountCents: number,
  category: string,
  todayStr: string,
  note?: string,
  account?: string,
  card?: boolean,
  owed?: boolean
): LedgerState {
  const newTx: Transaction = {
    id: 'tx_' + Math.random().toString(36).slice(2, 10),
    amount: amountCents,
    category,
    date: todayStr,
    createdAt: Date.now(),
    note,
    account,
    card,
    owed
  };

  return {
    ...state,
    transactions: [newTx, ...state.transactions]
  };
}

/**
 * Marks a bill as paid for a given date
 */
export function markBillPaid(
  state: LedgerState,
  billId: string,
  dueDateStr: string,
  isPaid: boolean
): LedgerState {
  const now = Date.now();
  const updatedBills = state.bills.map(b => {
    if (b.id !== billId) return b;
    
    const paidDates = isPaid
      ? Array.from(new Set([...b.paidDates, dueDateStr]))
      : b.paidDates.filter(d => d !== dueDateStr);
      
    const paidAt = { ...b.paidAt };
    if (isPaid) {
      paidAt[dueDateStr] = now;
    } else {
      delete paidAt[dueDateStr];
    }

    return { ...b, paidDates, paidAt };
  });

  return {
    ...state,
    bills: updatedBills
  };
}

/**
 * Updates checking balance
 */
export function updateCheckingBalance(
  state: LedgerState,
  newBalanceCents: number,
  todayStr: string
): LedgerState {
  return {
    ...state,
    account: {
      ...state.account,
      balance: newBalanceCents,
      balanceAsOf: todayStr,
      balanceAsOfMs: Date.now()
    }
  };
}

/**
 * Envelope Management
 */
export function saveEnvelope(
  state: LedgerState,
  name: string,
  category: string,
  capCents: number,
  existingId?: string
): LedgerState {
  const envelopes = [...(state.envelopes || [])];
  if (existingId) {
    const idx = envelopes.findIndex(e => e.id === existingId);
    if (idx !== -1) {
      envelopes[idx] = { id: existingId, name, category, cap: capCents };
      return { ...state, envelopes };
    }
  }

  const newEnv: Envelope = {
    id: 'env_' + Math.random().toString(36).slice(2, 10),
    name,
    category,
    cap: capCents
  };
  return { ...state, envelopes: [...envelopes, newEnv] };
}

export function deleteEnvelope(state: LedgerState, envelopeId: string): LedgerState {
  return {
    ...state,
    envelopes: (state.envelopes || []).filter(e => e.id !== envelopeId)
  };
}

/**
 * Goal Management
 */
export function saveGoal(
  state: LedgerState,
  name: string,
  targetAmount: number,
  savedAmount: number,
  monthlyAllocation: number,
  existingId?: string
): LedgerState {
  const goals = [...(state.goals || [])];
  if (existingId) {
    const idx = goals.findIndex(g => g.id === existingId);
    if (idx !== -1) {
      goals[idx] = { id: existingId, name, targetAmount, savedAmount, monthlyAllocation };
      return { ...state, goals };
    }
  }

  const newGoal: Goal = {
    id: 'goal_' + Math.random().toString(36).slice(2, 10),
    name,
    targetAmount,
    savedAmount,
    monthlyAllocation
  };
  return { ...state, goals: [...goals, newGoal] };
}

export function deleteGoal(state: LedgerState, goalId: string): LedgerState {
  return {
    ...state,
    goals: (state.goals || []).filter(g => g.id !== goalId)
  };
}

/**
 * Debt Management
 */
export function saveDebt(
  state: LedgerState,
  name: string,
  balance: number,
  apr: number,
  minPayment: number,
  existingId?: string
): LedgerState {
  const debts = [...(state.debts || [])];
  if (existingId) {
    const idx = debts.findIndex(d => d.id === existingId);
    if (idx !== -1) {
      debts[idx] = { id: existingId, name, balance, apr, minPayment };
      return { ...state, debts };
    }
  }

  const newDebt: Debt = {
    id: 'debt_' + Math.random().toString(36).slice(2, 10),
    name,
    balance,
    apr,
    minPayment
  };
  return { ...state, debts: [...debts, newDebt] };
}

export function deleteDebt(state: LedgerState, debtId: string): LedgerState {
  return {
    ...state,
    debts: (state.debts || []).filter(d => d.id !== debtId)
  };
}

/**
 * Calculates month-level summary for "The Month So Far"
 */
export interface MonthSummary {
  cameInCents: number;
  wentOutCents: number;
  keptCents: number;
  billsAndRentCents: number;
  livingAndFoodCents: number;
  funAndFriendsCents: number;
  toSavingsCents: number;
  toDebtCents: number;
  leftOverCents: number;
}

export function calculateMonthSummary(state: LedgerState, todayStr: string): MonthSummary {
  const currentMonth = todayStr.slice(0, 7);

  // Income came in
  const cameInCents = state.paycheck ? state.paycheck.amount : 0;

  // Transactions by category groups
  let livingAndFoodCents = 0;
  let funAndFriendsCents = 0;
  let otherSpendCents = 0;

  const livingKeywords = ['food', 'groceries', 'gas', 'transit', 'living', 'meal', 'utilities', 'household'];
  const funKeywords = ['coffee', 'fun', 'entertainment', 'friends', 'shopping', 'dining', 'leisure'];
  const kindSide = state.kindSide || {};

  (state.transactions || []).forEach(tx => {
    if (tx.date.startsWith(currentMonth)) {
      const explicitSide = kindSide[tx.category];
      if (explicitSide === 'living') {
        livingAndFoodCents += tx.amount;
      } else if (explicitSide === 'fun') {
        funAndFriendsCents += tx.amount;
      } else {
        const catLower = tx.category.toLowerCase();
        let matched = false;
        for (const [k, side] of Object.entries(kindSide)) {
          if (k.toLowerCase() === catLower) {
            if (side === 'living') livingAndFoodCents += tx.amount;
            else funAndFriendsCents += tx.amount;
            matched = true;
            break;
          }
        }
        if (!matched) {
          if (livingKeywords.some(k => catLower.includes(k))) {
            livingAndFoodCents += tx.amount;
          } else if (funKeywords.some(k => catLower.includes(k))) {
            funAndFriendsCents += tx.amount;
          } else {
            otherSpendCents += tx.amount;
          }
        }
      }
    }
  });

  // Bills this month
  let billsAndRentCents = 0;
  (state.bills || []).forEach(b => {
    if (b.recurrence === 'annual') {
      billsAndRentCents += Math.floor(b.amount / 12);
    } else {
      billsAndRentCents += b.amount;
    }
  });

  // Goals & Debts monthly
  let toSavingsCents = 0;
  (state.goals || []).forEach(g => {
    toSavingsCents += g.monthlyAllocation;
  });

  let toDebtCents = 0;
  (state.debts || []).forEach(d => {
    toDebtCents += d.minPayment;
  });

  const wentOutCents = livingAndFoodCents + funAndFriendsCents + otherSpendCents + billsAndRentCents;
  const keptCents = Math.max(0, cameInCents - wentOutCents);
  const leftOverCents = keptCents;

  return {
    cameInCents,
    wentOutCents,
    keptCents,
    billsAndRentCents,
    livingAndFoodCents,
    funAndFriendsCents,
    toSavingsCents,
    toDebtCents,
    leftOverCents
  };
}

/**
 * Calculates Run To Payday runway timeline bars
 */
export interface RunToPaydayData {
  daysLeft: number;
  totalCycleDays: number;
  passedDays: number;
  safeUntilPayday: number;
  perDayCents: number;
  bars: { dayIndex: number; isPast: boolean; isToday: boolean; isPayday: boolean }[];
}

export function calculateRunToPayday(state: LedgerState, todayStr: string): RunToPaydayData {
  const calc = calculateSafeToSpend(state, todayStr);
  const totalCycleDays = state.paycheck.cycle === 'weekly' ? 7 : state.paycheck.cycle === 'biweekly' ? 14 : 30;
  const daysLeft = calc.daysLeft;
  const passedDays = Math.max(0, totalCycleDays - daysLeft);

  const bars: { dayIndex: number; isPast: boolean; isToday: boolean; isPayday: boolean }[] = [];
  for (let i = 0; i < totalCycleDays; i++) {
    const isToday = i === passedDays;
    const isPast = i < passedDays;
    const isPayday = i === totalCycleDays - 1;
    bars.push({ dayIndex: i, isPast, isToday, isPayday });
  }

  return {
    daysLeft,
    totalCycleDays,
    passedDays,
    safeUntilPayday: calc.safeUntilPayday,
    perDayCents: calc.safeToSpendToday,
    bars
  };
}

/**
 * Calculates financial habit milestones
 */
export interface MilestonesData {
  items: { title: string; reached: boolean }[];
  reachedCount: number;
}

export function calculateMilestones(state: LedgerState, todayStr: string): MilestonesData {
  const calc = calculateSafeToSpend(state, todayStr);
  const currentMonth = todayStr.slice(0, 7);

  // 1. Every bill covered before payday
  const billCovered = calc.billsDueCents === 0 || calc.safeUntilPayday > 0;

  // 2. A day without spending (e.g. today has 0 spend or yesterday had 0 spend)
  const spentToday = (state.transactions || []).some(t => t.date === todayStr);
  const dayWithoutSpending = !spentToday;

  // 3. A month with every bill ticked off
  const billsThisMonth = (state.bills || []).filter(b => b.recurrence === 'monthly');
  const monthBillsTicked = billsThisMonth.length > 0 && billsThisMonth.every(b => b.paidDates.some(d => d.startsWith(currentMonth)));

  // 4. A goal reached in full
  const goalReached = (state.goals || []).some(g => g.targetAmount > 0 && g.savedAmount >= g.targetAmount);

  const items = [
    { title: 'Every bill covered before payday', reached: billCovered },
    { title: 'A day without spending', reached: dayWithoutSpending },
    { title: 'A month with every bill ticked off', reached: monthBillsTicked },
    { title: 'A goal reached in full', reached: goalReached }
  ];

  const reachedCount = items.filter(i => i.reached).length;
  return { items, reachedCount };
}

export interface IncomeSummary {
  arrivedCents: number;
  soonCents: number;
  laterCents: number;
  totalCents: number;
}

export function calculateIncomeSummary(state: LedgerState, currentMonthStr: string): IncomeSummary {
  const incomes = state.incomes || [];
  let arrivedCents = 0;
  let soonCents = 0;
  let laterCents = 0;

  for (const inc of incomes) {
    if (inc.status === 'arrived') {
      if (inc.date.startsWith(currentMonthStr)) {
        arrivedCents += inc.amount;
      }
    } else if (inc.status === 'soon') {
      soonCents += inc.amount;
    } else if (inc.status === 'later') {
      laterCents += inc.amount;
    }
  }

  return {
    arrivedCents,
    soonCents,
    laterCents,
    totalCents: arrivedCents + soonCents + laterCents
  };
}

export function addIncome(state: LedgerState, item: Omit<IncomeItem, 'id' | 'createdAt'> & { id?: string; createdAt?: number }): LedgerState {
  const newIncome: IncomeItem = {
    ...item,
    id: item.id || `inc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    createdAt: item.createdAt || Date.now()
  };
  return {
    ...state,
    incomes: [newIncome, ...(state.incomes || [])]
  };
}

export function deleteIncome(state: LedgerState, id: string): LedgerState {
  return {
    ...state,
    incomes: (state.incomes || []).filter(inc => inc.id !== id)
  };
}

export function updateIncomeStatus(state: LedgerState, id: string, status: 'arrived' | 'soon' | 'later'): LedgerState {
  return {
    ...state,
    incomes: (state.incomes || []).map(inc => inc.id === id ? { ...inc, status } : inc)
  };
}
