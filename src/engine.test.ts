import { describe, it, expect } from 'vitest';
import {
  calculateSafeToSpend,
  isTransactionAfterBalance,
  isBillPaidAfterBalance,
  markBillPaid,
  updateCheckingBalance,
  addTransaction,
  calculateEnvelopes,
  getMonthCalendarDays,
  saveEnvelope,
  deleteEnvelope,
  formatCurrency,
  calculateGoals,
  saveGoal,
  deleteGoal,
  calculateDebts,
  saveDebt,
  deleteDebt,
  calculateIncomeSummary,
  addIncome,
  deleteIncome,
  updateIncomeStatus,
  calculateMonthSummary
} from './engine';
import { getNextPayday, getDaysLeft } from './payday';
import { LedgerState } from './types';

function createMockState(overrides: Partial<LedgerState> = {}): LedgerState {
  const baseTime = 1700000000000;
  return {
    schemaVersion: 1,
    currency: 'USD',
    theme: 'system',
    account: {
      id: 'acct-1',
      name: 'Checking',
      balance: 100000, // $1,000.00
      balanceAsOf: '2026-10-01',
      balanceAsOfMs: baseTime
    },
    paycheck: {
      id: 'pay-1',
      label: 'Main Job',
      amount: 200000, // $2,000.00
      cycle: 'biweekly',
      anchorDate: '2026-10-15'
    },
    bills: [
      {
        id: 'bill-rent',
        name: 'Rent',
        amount: 50000, // $500.00
        dueDay: 5,
        recurrence: 'monthly',
        paidDates: [],
        paidAt: {}
      }
    ],
    envelopes: [
      {
        id: 'env-food',
        name: 'Food',
        category: 'Food',
        cap: 30000 // $300.00
      }
    ],
    goals: [
      {
        id: 'g-1',
        name: 'Emergency Fund',
        targetAmount: 100000, // $1,000.00
        savedAmount: 40000, // $400.00
        monthlyAllocation: 10000 // $100.00
      }
    ],
    debts: [
      {
        id: 'd-1',
        name: 'Credit Card',
        balance: 100000, // $1,000.00
        apr: 20.0,
        minPayment: 5000 // $50.00
      },
      {
        id: 'd-2',
        name: 'Loan',
        balance: 50000, // $500.00
        apr: 10.0,
        minPayment: 3000 // $30.00
      }
    ],
    debtStrategy: 'snowball',
    transactions: [],
    setAside: 10000, // $100.00
    ...overrides
  };
}

describe('Engine: Currency Formatter', () => {
  it('formats multiple currencies properly', () => {
    expect(formatCurrency(123450, 'USD')).toBe('$1,234.50');
    expect(formatCurrency(123450, 'IDR')).toBe('Rp 1.234');
    expect(formatCurrency(123450, 'EUR')).toContain('1.234,50');
    expect(formatCurrency(123450, 'GBP')).toBe('£1,234.50');
    expect(formatCurrency(123450, 'JPY')).toBe('¥1,234');
  });
});

describe('Engine: Helper Utilities', () => {
  it('correctly compares timestamps with isTransactionAfterBalance', () => {
    expect(isTransactionAfterBalance('2026-10-02', 100, '2026-10-01', 200)).toBe(true);
    expect(isTransactionAfterBalance('2026-09-30', 300, '2026-10-01', 200)).toBe(false);
    expect(isTransactionAfterBalance('2026-10-01', 250, '2026-10-01', 200)).toBe(true);
    expect(isTransactionAfterBalance('2026-10-01', 150, '2026-10-01', 200)).toBe(false);
  });

  it('correctly checks isBillPaidAfterBalance', () => {
    expect(isBillPaidAfterBalance(500, 300)).toBe(true);
    expect(isBillPaidAfterBalance(200, 300)).toBe(false);
    expect(isBillPaidAfterBalance(undefined, 300)).toBe(false);
  });

  it('adds transaction and updates state', () => {
    let state = createMockState();
    state = addTransaction(state, 1500, 'Lunch', '2026-10-02');
    expect(state.transactions.length).toBe(1);
    expect(state.transactions[0].amount).toBe(1500);
    expect(state.transactions[0].category).toBe('Lunch');
  });

  it('toggles markBillPaid correctly', () => {
    let state = createMockState();
    state = markBillPaid(state, 'bill-rent', '2026-10-05', true);
    expect(state.bills[0].paidDates).toContain('2026-10-05');
    expect(state.bills[0].paidAt['2026-10-05']).toBeTypeOf('number');

    state = markBillPaid(state, 'bill-rent', '2026-10-05', false);
    expect(state.bills[0].paidDates).not.toContain('2026-10-05');
  });

  it('updates checking balance and refreshes timestamps', () => {
    let state = createMockState();
    const oldMs = state.account.balanceAsOfMs;
    state = updateCheckingBalance(state, 250000, '2026-10-02');
    expect(state.account.balance).toBe(250000);
    expect(state.account.balanceAsOf).toBe('2026-10-02');
    expect(state.account.balanceAsOfMs).toBeGreaterThanOrEqual(oldMs);
  });

  it('manages envelopes correctly', () => {
    let state = createMockState();
    state = saveEnvelope(state, 'Fun', 'Entertainment', 10000);
    expect(state.envelopes.length).toBe(2);
    expect(state.envelopes[1].name).toBe('Fun');

    const envId = state.envelopes[1].id;
    state = deleteEnvelope(state, envId);
    expect(state.envelopes.length).toBe(1);
  });
});

describe('Engine: Double-Counting Prevention and Annual Bills', () => {
  it('does NOT subtract transactions created before balanceAsOfMs', () => {
    const baseTime = 1700000000000;
    const state = createMockState({
      account: {
        id: 'acct-1',
        name: 'Checking',
        balance: 100000,
        balanceAsOf: '2026-10-01',
        balanceAsOfMs: baseTime
      },
      transactions: [
        {
          id: 'tx-old',
          amount: 5000,
          category: 'Coffee',
          date: '2026-10-01',
          createdAt: baseTime - 1000
        }
      ]
    });

    const result = calculateSafeToSpend(state, '2026-10-01');
    expect(result.spentAfterBalanceCents).toBe(0);
    expect(result.safeUntilPayday).toBe(40000);
  });

  it('subtracts today spending directly from daily safe to spend allowance', () => {
    const baseTime = 1700000000000;
    const state = createMockState({
      account: {
        id: 'acct-1',
        name: 'Checking',
        balance: 140000, // $1,400.00
        balanceAsOf: '2026-10-01',
        balanceAsOfMs: baseTime
      },
      bills: [],
      setAside: 0,
      transactions: [
        {
          id: 'tx-coffee',
          amount: 400, // $4.00
          category: 'Coffee',
          date: '2026-10-01',
          createdAt: baseTime + 1000
        }
      ]
    });

    const result = calculateSafeToSpend(state, '2026-10-01');
    expect(result.dailyStartingAllowance).toBe(10000);
    expect(result.spentTodayCents).toBe(400);
    expect(result.safeToSpendToday).toBe(9600);
    expect(result.safeUntilPayday).toBe(139600);
  });

  it('reserves monthly share for annual bills', () => {
    const state = createMockState({
      bills: [
        {
          id: 'bill-ins',
          name: 'Car Insurance (Annual)',
          amount: 120000, // $1,200/yr -> $100/mo reserve = 10000 cents
          dueDay: 10,
          dueMonth: 12,
          recurrence: 'annual',
          paidDates: [],
          paidAt: {}
        }
      ]
    });

    const result = calculateSafeToSpend(state, '2026-10-01');
    expect(result.annualReserveCents).toBe(10000);
    // Safe = $1,000 (checking) - $100 (annual reserve) - $100 (set aside) = $800 = 80000 cents
    expect(result.safeUntilPayday).toBe(80000);
  });
});

describe('Engine: Payday Cycle and Daily Pacing', () => {
  it('correctly calculates next biweekly payday and days left', () => {
    const paycheck = {
      id: 'pay-1',
      label: 'Job',
      amount: 200000,
      cycle: 'biweekly' as const,
      anchorDate: '2026-10-15'
    };

    expect(getNextPayday(paycheck, '2026-10-01')).toBe('2026-10-15');
    expect(getDaysLeft('2026-10-01', '2026-10-15')).toBe(14);
    expect(getDaysLeft('2026-10-14', '2026-10-15')).toBe(1);
    expect(getNextPayday(paycheck, '2026-10-15')).toBe('2026-10-29');
    expect(getDaysLeft('2026-10-15', '2026-10-29')).toBe(14);
    expect(getNextPayday(paycheck, '2026-10-16')).toBe('2026-10-29');
    expect(getDaysLeft('2026-10-16', '2026-10-29')).toBe(13);
  });
});

describe('Engine: Goals, Debt, Envelopes and Calendar Modules', () => {
  it('calculates envelopes spending vs cap', () => {
    const state = createMockState({
      envelopes: [
        { id: 'e1', name: 'Groceries', category: 'Food', cap: 40000 }
      ],
      transactions: [
        { id: 't1', amount: 5000, category: 'Food', date: '2026-10-05', createdAt: 1700000000000 }
      ]
    });

    const status = calculateEnvelopes(state, '2026-10-05');
    expect(status.totalCaps).toBe(40000);
    expect(status.totalSpent).toBe(5000);
    expect(status.totalLeft).toBe(35000);
    expect(status.items[0].percentUsed).toBe(13);
    expect(status.items[0].isOver).toBe(false);
  });

  it('generates month calendar days with bills and paydays', () => {
    const state = createMockState();
    const days = getMonthCalendarDays(state, 2026, 9, '2026-10-08'); // October 2026
    expect(days.length).toBe(31);

    const oct5 = days.find(d => d.dayNumber === 5);
    expect(oct5?.events.some(e => e.type === 'bill')).toBe(true);

    const oct15 = days.find(d => d.dayNumber === 15);
    expect(oct15?.isPayday).toBe(true);
  });

  it('calculates savings goals and months remaining', () => {
    let state = createMockState();
    const goalsData = calculateGoals(state);
    expect(goalsData.totalTarget).toBe(100000);
    expect(goalsData.totalSaved).toBe(40000);
    expect(goalsData.items[0].percent).toBe(40);
    expect(goalsData.items[0].monthsRemaining).toBe(6); // ($1000 - $400) / $100 = 6 months

    state = saveGoal(state, 'New Car', 200000, 50000, 15000);
    expect(state.goals.length).toBe(2);

    state = deleteGoal(state, state.goals[1].id);
    expect(state.goals.length).toBe(1);
  });

  it('calculates debt strategies (snowball vs avalanche)', () => {
    let state = createMockState({ debtStrategy: 'snowball' });
    let debtData = calculateDebts(state);
    // Snowball sorts lowest balance first: d-2 ($500) then d-1 ($1000)
    expect(debtData.items[0].debt.id).toBe('d-2');

    state = { ...state, debtStrategy: 'avalanche' };
    debtData = calculateDebts(state);
    // Avalanche sorts highest APR first: d-1 (20%) then d-2 (10%)
    expect(debtData.items[0].debt.id).toBe('d-1');

    state = saveDebt(state, 'Store Card', 30000, 24.0, 2000);
    expect(state.debts.length).toBe(3);

    state = deleteDebt(state, state.debts[2].id);
    expect(state.debts.length).toBe(2);
  });

  it('manages extra income tracking and monthly cashflow summary', () => {
    let state = createMockState({
      incomes: [
        { id: 'inc-1', source: 'Design Gig', amount: 35000, date: '2026-10-05', status: 'arrived' },
        { id: 'inc-2', source: 'Sold Chair', amount: 8000, date: '2026-10-12', status: 'arrived' },
        { id: 'inc-3', source: 'Invoice #104', amount: 50000, date: '2026-10-20', status: 'soon' },
        { id: 'inc-4', source: 'Tax Refund', amount: 120000, date: '2026-11-01', status: 'later' }
      ]
    });

    const summaryOct = calculateIncomeSummary(state, '2026-10');
    // Arrived in Oct: 35000 + 8000 = 43000 cents ($430.00)
    expect(summaryOct.arrivedCents).toBe(43000);
    // Soon in Oct: 50000 cents ($500.00)
    expect(summaryOct.soonCents).toBe(50000);
    // Later total across all: 120000 cents ($1,200.00)
    expect(summaryOct.laterCents).toBe(120000);
    expect(summaryOct.totalCents).toBe(213000);

    // Add new income item
    state = addIncome(state, {
      id: 'inc-5',
      source: 'Bonus',
      amount: 25000,
      date: '2026-10-18',
      status: 'soon'
    });
    expect(state.incomes?.length).toBe(5);

    // Update status from soon to arrived
    state = updateIncomeStatus(state, 'inc-5', 'arrived');
    const updatedItem = state.incomes?.find(i => i.id === 'inc-5');
    expect(updatedItem?.status).toBe('arrived');

    // Delete income item
    state = deleteIncome(state, 'inc-1');
    expect(state.incomes?.length).toBe(4);
    expect(state.incomes?.some(i => i.id === 'inc-1')).toBe(false);
  });

  it('respects kindSide mapping when classifying transactions in month summary', () => {
    // By default 'Coffee' is fun and 'Food' is living.
    // When moved via kindSide: Coffee -> living, Food -> fun
    const state = createMockState({
      kindSide: {
        'Coffee': 'living',
        'Food': 'fun'
      },
      transactions: [
        { id: 'tx-1', amount: 500, category: 'Coffee', date: '2026-10-02', createdAt: 1700000000000 },
        { id: 'tx-2', amount: 2000, category: 'Food', date: '2026-10-03', createdAt: 1700000000001 }
      ]
    });

    const summary = calculateMonthSummary(state, '2026-10-05');
    // Coffee ($5.00) classified as living:
    expect(summary.livingAndFoodCents).toBe(500);
    // Food ($20.00) classified as fun:
    expect(summary.funAndFriendsCents).toBe(2000);
  });
});
