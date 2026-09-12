import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { loadFinanceExpenses } from './finance-data.mjs';
import { isSupabaseEnabled, selectRows, upsertRows } from './clients/supabase.mjs';

const customFile = new URL('../data/dashboard/finance-expenses.custom.json', import.meta.url);
const customStateKey = 'finance_expenses_custom';
const DATE = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;

async function readCustom() {
  if (isSupabaseEnabled()) {
    try {
      const rows = await selectRows('app_state', { query: { key: `eq.${customStateKey}` }, limit: 1 });
      if (Array.isArray(rows[0]?.value)) return rows[0].value;
    } catch {
      // Keep the dashboard readable from the local compatibility copy during
      // a temporary persistence outage.
    }
  }
  try {
    const value = JSON.parse(await fs.readFile(customFile, 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeCustom(rows) {
  if (isSupabaseEnabled()) {
    await upsertRows('app_state', { key: customStateKey, value: rows, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  }
  try {
    await fs.mkdir(new URL('.', customFile), { recursive: true });
    await fs.writeFile(customFile, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
  } catch (error) {
    if (!isSupabaseEnabled()) throw error;
  }
}

function cents(value) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100000) throw new Error('finance_expense_amount_invalid');
  return Math.round(parsed * 100);
}

function validDate(value, field, required = true) {
  if (!value && !required) return null;
  if (!DATE.test(String(value || '')) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) throw new Error(`finance_expense_${field}_invalid`);
  return String(value);
}

export async function loadFinanceExpenseLedger() {
  const base = loadFinanceExpenses().map((item) => ({ ...item, editable: false }));
  const custom = (await readCustom()).map((item) => ({ ...item, editable: true }));
  return [...base, ...custom];
}

export async function addFinanceExpense(input = {}) {
  const name = String(input.name || '').trim();
  if (!name || name.length > 80) throw new Error('finance_expense_name_invalid');
  const type = String(input.type || 'recurring_monthly');
  if (!['recurring_monthly', 'one_off'].includes(type)) throw new Error('finance_expense_type_invalid');
  const startDate = validDate(input.startDate, 'start_date');
  const endDate = validDate(input.endDate, 'end_date', false);
  if (endDate && endDate < startDate) throw new Error('finance_expense_date_range_invalid');
  const row = {
    id: `custom-${crypto.randomUUID()}`,
    name,
    category: String(input.category || 'Otros').trim().slice(0, 40) || 'Otros',
    type,
    amount_cents: cents(input.amount),
    start_date: startDate,
    end_date: type === 'one_off' ? startDate : endDate,
    date: type === 'one_off' ? startDate : undefined,
    source: 'Panel de control · gasto añadido manualmente',
    created_at: new Date().toISOString()
  };
  const rows = await readCustom();
  rows.push(row);
  await writeCustom(rows);
  return { ...row, editable: true };
}

export async function removeFinanceExpense(id) {
  const rows = await readCustom();
  const next = rows.filter((row) => row.id !== id);
  if (next.length === rows.length) throw new Error('finance_expense_not_found_or_locked');
  await writeCustom(next);
  return { id };
}
