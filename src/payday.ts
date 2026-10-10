import { Paycheck } from './types';

export function parseISODate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatISODate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(dateStr: string, days: number): string {
  const d = parseISODate(dateStr);
  d.setDate(d.getDate() + days);
  return formatISODate(d);
}

export function daysBetween(fromStr: string, toStr: string): number {
  const from = parseISODate(fromStr);
  const to = parseISODate(toStr);
  const diffTime = to.getTime() - from.getTime();
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Calculates the upcoming payday strictly after `todayStr`.
 * When today is payday, your new pay arrives and the budget spans to the next payday.
 */
export function getNextPayday(paycheck: Paycheck, todayStr: string): string {
  const today = parseISODate(todayStr);
  const anchor = parseISODate(paycheck.anchorDate);

  if (paycheck.cycle === 'weekly' || paycheck.cycle === 'biweekly') {
    const stepDays = paycheck.cycle === 'weekly' ? 7 : 14;
    const diffMs = today.getTime() - anchor.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) {
      return paycheck.anchorDate;
    }
    
    const steps = Math.floor(diffDays / stepDays) + 1;
    const nextDate = new Date(anchor);
    nextDate.setDate(anchor.getDate() + steps * stepDays);
    return formatISODate(nextDate);
  }

  if (paycheck.cycle === 'monthly') {
    const anchorDay = anchor.getDate();
    let targetYear = today.getFullYear();
    let targetMonth = today.getMonth();

    const maxDayThisMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
    const thisMonthDay = Math.min(anchorDay, maxDayThisMonth);
    const candidateThisMonth = new Date(targetYear, targetMonth, thisMonthDay);

    if (candidateThisMonth.getTime() > today.getTime()) {
      return formatISODate(candidateThisMonth);
    }

    targetMonth += 1;
    if (targetMonth > 11) {
      targetMonth = 0;
      targetYear += 1;
    }
    const maxDayNextMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
    const nextMonthDay = Math.min(anchorDay, maxDayNextMonth);
    const candidateNextMonth = new Date(targetYear, targetMonth, nextMonthDay);
    return formatISODate(candidateNextMonth);
  }

  // Semimonthly: 15th and end of month
  const day = today.getDate();
  const year = today.getFullYear();
  const month = today.getMonth();

  if (day < 15) {
    return formatISODate(new Date(year, month, 15));
  } else {
    const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
    if (day < lastDayOfMonth) {
      return formatISODate(new Date(year, month + 1, 0));
    } else {
      return formatISODate(new Date(year, month + 1, 15));
    }
  }
}

/**
 * Days left until next payday (inclusive of today, minimum 1).
 */
export function getDaysLeft(todayStr: string, nextPaydayStr: string): number {
  const diff = daysBetween(todayStr, nextPaydayStr);
  return Math.max(1, diff);
}
