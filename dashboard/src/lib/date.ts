import { addDays, addMonths, addWeeks, format, parseISO, subDays, subMonths, subWeeks } from 'date-fns';
import { it } from 'date-fns/locale';
import type { Period } from '../types';

export function todayIso(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

export function shiftDate(date: string, amount: number): string {
  const base = parseISO(date);
  return format(amount >= 0 ? addDays(base, amount) : subDays(base, Math.abs(amount)), 'yyyy-MM-dd');
}

export function shiftDateByPeriod(date: string, period: Period, amount: number): string {
  const base = parseISO(date);
  if (period === 'week') {
    return format(amount >= 0 ? addWeeks(base, amount) : subWeeks(base, Math.abs(amount)), 'yyyy-MM-dd');
  }
  if (period === 'month') {
    return format(amount >= 0 ? addMonths(base, amount) : subMonths(base, Math.abs(amount)), 'yyyy-MM-dd');
  }
  return shiftDate(date, amount);
}

export function readableDate(date: string): string {
  return format(parseISO(date), 'EEEE d MMMM yyyy', { locale: it });
}

export function monthLabel(date: string): string {
  return format(parseISO(date), 'MMMM yyyy', { locale: it });
}
