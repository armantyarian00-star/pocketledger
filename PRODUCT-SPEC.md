# PRODUCT-SPEC.md: PocketLedger Functional Specification

## 1. Vision & Purpose
PocketLedger adalah aplikasi manajemen keuangan pribadi yang sederhana, tenang, privat, dan offline-first. Dirancang untuk menjawab satu pertanyaan penting setiap hari:
> **"Berapa uang yang aman untuk saya belanjakan hari ini?" (Safe to Spend Today)**

## 2. Otoritas Fungsional & Batasan MVP
Dokumen ini merupakan otoritas fungsional tertinggi untuk PocketLedger.

### Fitur Utama MVP (In Scope):
1. **Hero Metric ("Safe to Spend Today"):**
   - Menghitung nominal harian yang aman dibelanjakan hingga tanggal gajian berikutnya.
   - Pacing dinamis: `Safe Until Payday / Days Left`.
   - Rincian kalkulator transparan ("How is this worked out?"): Saldo Bank + Pemasukan Antara - Tagihan Belum Dibayar - Tagihan Dibayar Setelah Saldo - Pengeluaran Tercatat = Saldo Aman.
2. **Manajemen Saldo Rekening (Checking Account):**
   - Input saldo riil dari m-banking pengguna.
   - Pencatatan `balanceAsOf` (tanggal) dan `balanceAsOfMs` (timestamp milidetik).
   - Pengeluaran sebelum timestamp ini TIDAK dipotong dua kali dari saldo.
3. **Jadwal Siklus Gajian (Payday Schedules):**
   - Pilihan frekuensi: Mingguan (weekly), Dua mingguan (biweekly), Dua kali sebulan (semimonthly), Bulanan (monthly), atau Kustom/manual.
   - Penghitungan otomatis tanggal gajian berikutnya dan `daysLeft`.
4. **Tagihan & Komitmen Wajib (Must-Pays / Bills):**
   - Nama tagihan, nominal (dalam sen), tanggal jatuh tempo.
   - Status Bayar: Tombol toggle "Mark Paid" yang mencatat `paidAt` timestamp.
   - Tagihan yang belum dibayar otomatis ditahan dari Safe to Spend.
5. **Pencatatan Pengeluaran Cepat (Quick Logging):**
   - Input pengeluaran harian dengan kategori dasar (Food, Transport, Bills, Shopping, Other).
   - Tombol cepat untuk pengeluaran rutin (cth: Kopi, Makan Siang).
   - Riwayat transaksi terbaru dan fitur Undo.
6. **Penyimpanan Lokal & Backup Mandiri:**
   - Penyimpanan 100% lokal di browser (`localStorage`).
   - Ekspor & Impor file backup `.json`.
   - Ekspor transaksi ke `.csv`.
7. **PWA Offline Shell:**
   - Dapat diinstal di Home Screen (iOS Safari / Android Chrome / Desktop).
   - Berfungsi penuh tanpa koneksi internet.

### Fitur yang Dikecualikan (Out of Scope):
- **TIDAK ADA** Cloud Sync / server relay.
- **TIDAK ADA** Enkripsi pairing multi-device / WebCrypto ECDH / QR code pairing.
- **TIDAK ADA** Fitur ADHD-specific: Brain dump, reward gamifikasi/konfeti, milestone badges, atau pesan konseling psikologis.
- **TIDAK ADA** Koneksi API Bank pihak ketiga (Plaid, Open Banking).
