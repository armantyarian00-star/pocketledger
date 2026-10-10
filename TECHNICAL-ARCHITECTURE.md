# TECHNICAL-ARCHITECTURE.md: PocketLedger Technical Architecture

Dokumen ini merupakan otoritas teknis tertinggi untuk implementasi PocketLedger.

## 1. Tech Stack
- **Runtime & Build:** Node.js v26+, Vite, TypeScript.
- **Frontend Core:** Single Page Application (TypeScript + Modular Web Components / UI Views) tanpa dependensi runtime berat.
- **CSS Architecture:** Native CSS variables dengan tema adaptif (*Light* dan *Dark Mode*).
- **Offline / PWA:** Service Worker (`sw.ts`/`sw.js`) dengan strategi *Cache-First* untuk app shell, serta `manifest.webmanifest`.
- **Test Runner:** Vitest untuk unit test logika keuangan dan integrasi storage.

## 2. Model Moneter & Integritas Aritmatika
- **Integer Cents:** Seluruh representasi moneter disimpan dan dihitung dalam satuan integer sen (misal: $10.50 disimpan sebagai `1050`, Rp 100.000 disimpan sebagai `10000000` atau satuan sen standar).
- **Anti Floating-Point:** Dilarang menggunakan operasi desimal floating point (`Math.round`, integer division dengan pembulatan ke bawah `Math.floor`).

## 3. Formula "Safe to Spend" & Pencegahan Double-Counting

### A. Definisi Variabel
- $S$: Saldo checking saat ini (`account.balance`).
- $T_{\text{bal}}$: Waktu pencatatan saldo (`balanceAsOfMs`).
- $P$: Pemasukan tambahan yang tiba setelah $T_{\text{bal}}$ dan sebelum atau pada hari ini.
- $B_{\text{due}}$: Total tagihan yang jatuh tempo sebelum payday dan **belum ditandai lunas**.
- $B_{\text{paid-after}}$: Total tagihan yang **ditandai lunas setelah $T_{\text{bal}}$** (`bill.paidAt > balanceAsOfMs`).
- $E_{\text{after}}$: Total pengeluaran yang dicatat **setelah $T_{\text{bal}}$** (`tx.createdAt > balanceAsOfMs`).
- $R_{\text{aside}}$: Uang yang dialokasikan khusus (`setAside`).

### B. Rumus Saldo Aman
$$\text{Safe Until Payday} = S + P - B_{\text{due}} - B_{\text{paid-after}} - E_{\text{after}} - R_{\text{aside}}$$
$$\text{Safe to Spend Today} = \max\left(0, \left\lfloor \frac{\text{Safe Until Payday}}{\text{Days Left}} \right\rfloor\right)$$

### C. Logika Anti-Double Counting
1. **Pengeluaran ($E$):**
   - Jika `tx.date < balanceAsOf.date`: diabaikan (sudah tercermin pada saldo bank saat diinput).
   - Jika `tx.date === balanceAsOf.date`: hanya dihitung jika `tx.createdAt > balanceAsOfMs`.
   - Jika `tx.date > balanceAsOf.date`: dihitung.
2. **Tagihan Lunas ($B$):**
   - Jika tagihan ditandai lunas sebelum atau sama dengan $T_{\text{bal}}$: diabaikan (karena saldo bank yang diinput pengguna sudah berkurang saat tagihan tersebut terbayar).
   - Jika tagihan belum lunas: masuk ke $B_{\text{due}}$ (dipotong dari safe spend agar uangnya tidak terpakai).
   - Jika tagihan baru saja dibayar setelah $T_{\text{bal}}$: masuk ke $B_{\text{paid-after}}$ (dipotong karena uang baru keluar dari bank setelah saldo terakhir diinput).

## 4. Skema Data (Storage Schema v1)
```typescript
export interface Account {
  id: string;
  name: string;
  balance: number; // in cents
  balanceAsOf: string; // YYYY-MM-DD
  balanceAsOfMs: number; // timestamp ms
}

export interface Paycheck {
  id: string;
  label: string;
  amount: number; // in cents
  cycle: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly' | 'custom';
  anchorDate: string; // YYYY-MM-DD
}

export interface Bill {
  id: string;
  name: string;
  amount: number; // in cents
  dueDay: number; // 1-31
  recurrence: 'monthly';
  paidDates: string[]; // YYYY-MM-DD
  paidAt: Record<string, number>; // dateStr -> timestamp ms
}

export interface Transaction {
  id: string;
  amount: number; // in cents
  category: string;
  date: string; // YYYY-MM-DD
  createdAt: number; // timestamp ms
  note?: string;
}

export interface LedgerState {
  schemaVersion: 1;
  currency: string;
  account: Account;
  paycheck: Paycheck;
  bills: Bill[];
  transactions: Transaction[];
  setAside: number; // in cents
}
```
