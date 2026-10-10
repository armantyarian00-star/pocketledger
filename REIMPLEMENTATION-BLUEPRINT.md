# REIMPLEMENTATION-BLUEPRINT.md: PocketLedger Implementation Plan

Rencana tahapan implementasi PocketLedger yang terukur dan berurutan.

## Phase 0: Project Setup & Baseline Tooling
1. Inisialisasi package `pocketledger` dengan TypeScript dan Vite.
2. Konfigurasi tooling pengujian (`vitest`).
3. Definisi model tipe data (`types.ts`) sesuai `TECHNICAL-ARCHITECTURE.md`.
4. Verifikasi baseline: build & test runner berfungsi.

## Phase 1: Core Financial Engine
1. Implementasi modul kalkulasi siklus gajian (`payday.ts`):
   - Hitung tanggal gajian berikutnya berdasarkan anchor dan siklus (weekly, biweekly, monthly).
   - Hitung `daysLeft`.
2. Implementasi modul kalkulasi "Safe to Spend" (`engine.ts`):
   - Hitung $B_{\text{due}}$ (unpaid bills).
   - Hitung $B_{\text{paid-after}}$ (bills paid after balance entry).
   - Hitung $E_{\text{after}}$ (expenses created after balance entry).
   - Hitung `safeUntilPayday` dan `safeToSpendToday`.
3. Unit test komprehensif (`engine.test.ts`):
   - Kasus saldo baru entered vs pengeluaran lama.
   - Kasus tagihan dibayar sebelum vs sesudah balance entered (uji double-counting).
   - Kasus pergantian hari/payday.

## Phase 2: Persistence & State Management
1. Implementasi storage adapter (`storage.ts`):
   - LocalStorage save & load dengan validasi schema version 1.
   - Default seed data jika storage kosong.
2. Fitur Export / Import:
   - Export backup ke `.json`.
   - Restore dari file backup `.json`.
   - Export riwayat transaksi ke `.csv`.

## Phase 3: User Interface & Views
1. Tampilan Utama (Today Screen):
   - Hero Card: Angka "Safe to Spend Today" & "Days to Payday".
   - Accordion Rincian: "How is this worked out?".
   - Quick Log Spending (tombol cepat & custom input).
   - Daftar pengeluaran hari ini + tombol Undo.
2. Tampilan Tagihan (Bills Screen):
   - Daftar tagihan jatuh tempo bulan ini.
   - Checkbox / Toggle "Mark as Paid".
   - Form tambah & hapus tagihan.
3. Tampilan Pengaturan (Settings Screen):
   - Update saldo checking (`balanceAsOf` otomatis diset ke `Date.now()`).
   - Konfigurasi tanggal & siklus gajian.
   - Pilihan mata uang (USD, IDR, EUR, GBP, dll.).
   - Tombol Backup & Restore.

## Phase 4: PWA Offline Shell & Build Verification
1. Manifest PWA (`manifest.webmanifest`).
2. Service Worker (`sw.ts` / `sw.js`) untuk caching offline.
3. Build production (`npm run build`).
4. Verifikasi verifikasi akhir dan pelaporan hasil pengujian.
