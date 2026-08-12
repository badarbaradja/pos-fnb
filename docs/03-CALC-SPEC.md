# 03 — Spesifikasi Kalkulasi (Sumber Kebenaran)

> Ini dokumen paling penting di repo. Semua angka yang muncul di layar klien berasal dari sini.
> Agent: **jangan mengimplementasikan rumus di luar dokumen ini.** Kalau ada kasus yang tidak tercakup, tanya.
> Semua test case di bawah harus jadi test otomatis di `src/lib/calc/__tests__/`.

---

## Notasi Angka

Dokumen ini memakai notasi Indonesia pada narasi dan tabel:
**titik = pemisah ribuan, koma = desimal.**
Contoh: `99.849` = 99849, dan `7.858,30` = 7858.30.

**Di dalam kode dan test**, semua angka ditulis sebagai numerik polos tanpa pemisah ribuan
dan dengan titik sebagai desimal:

| Notasi dokumen | Nilai numerik polos (kode/test) |
|---|---|
| `99.849` | `99849` |
| `7.858,30` | `7858.30` |
| `18,5` | `18.5` |
| `3.333,33` | `3333.33` |

---

## A. Kalkulator Struk (`lib/calc/order-calculator.ts`)

### A.1 Signature

```ts
type CalcLine = {
  id: string;
  qty: Decimal;
  unitPrice: Decimal;
  modifierTotal: Decimal;   // total harga modifier per 1 unit
  itemDiscount: Decimal;    // nominal, sudah dikonversi dari persen kalau perlu
  isTaxable: boolean;
};

type CalcSettings = {
  orderDiscountPercent: Decimal;   // 0 kalau tidak ada
  orderDiscountAmount: Decimal;    // dipakai kalau diskon nominal
  maxDiscount: Decimal | null;     // cap
  serviceChargePercent: Decimal;
  taxPercent: Decimal;
  taxInclusive: boolean;
  serviceChargeInTaxBase: boolean; // setting per outlet, default true
  roundingTo: number;              // 100 = bulatkan ke Rp 100
  roundingMode: 'nearest' | 'up' | 'down';  // default 'nearest'
  // 'nearest' → rounding bisa negatif, rentang (−roundingTo/2, +roundingTo/2]
  // 'up'      → selalu ke atas, rounding >= 0
  // 'down'    → selalu ke bawah, rounding <= 0
};

type CalcResult = {
  lines: Array<{ id, grossAmount, itemDiscount, allocatedOrderDiscount, netAmount }>;
  subtotal, itemDiscountTotal, orderDiscount, discountTotal,
  netSales, serviceCharge, taxBase, taxAmount,
  totalBeforeRounding, rounding, total: Decimal;
};

export function calculateOrder(lines: CalcLine[], s: CalcSettings): CalcResult
```

### A.2 Definisi fungsi pembantu

```
round2(x)   = pembulatan ke 2 desimal, mode HALF_UP.
              Semua perhitungan antara (langkah 1–9) menggunakan round2.
              Hanya `total` akhir yang dibulatkan ke roundingTo.

roundTo(x, roundingTo, mode):
  'nearest' → Math.round(x / roundingTo) * roundingTo
              rounding bisa negatif, rentang (−roundingTo/2, +roundingTo/2]
  'up'      → Math.ceil(x / roundingTo) * roundingTo
              rounding selalu >= 0
  'down'    → Math.floor(x / roundingTo) * roundingTo
              rounding selalu <= 0
```

### A.3 Urutan langkah (WAJIB berurutan)

```
1.  grossAmount_i        = qty_i × (unitPrice_i + modifierTotal_i)
2.  afterItemDisc_i      = grossAmount_i − itemDiscount_i
3.  subtotal             = Σ grossAmount_i
    itemDiscountTotal    = Σ itemDiscount_i
    discountBase         = Σ afterItemDisc_i
4.  orderDiscount        = orderDiscountAmount, ATAU
                           orderDiscountPercent × discountBase
    orderDiscount        = min(orderDiscount, maxDiscount)      [kalau maxDiscount ada]
    orderDiscount        = min(orderDiscount, discountBase)     [tidak boleh melebihi tagihan]
5.  allocated_i          = round2(orderDiscount × afterItemDisc_i / discountBase)
    → baris TERAKHIR = orderDiscount − Σ(allocated selain terakhir)   [serap sisa]
    netAmount_i          = afterItemDisc_i − allocated_i
6.  netSales             = subtotal − itemDiscountTotal − orderDiscount
7.  serviceCharge        = round2(serviceChargePercent × netSales)
8.  taxBase              = Σ netAmount_i untuk baris isTaxable
                           + serviceCharge (kalau serviceChargeInTaxBase = true)
9.  taxInclusive = false → taxAmount = round2(taxPercent × taxBase)
                           totalBeforeRounding = netSales + serviceCharge + taxAmount
    taxInclusive = true  → taxAmount = round2(taxBase − taxBase / (1 + taxPercent))
                           totalBeforeRounding = netSales + serviceCharge
10. total                = roundTo(totalBeforeRounding, roundingTo, roundingMode)
    rounding             = total − totalBeforeRounding
```

Catatan: `discountBase = 0` → semua alokasi 0, jangan bagi nol.

### A.4 Golden test cases

**TC-01 — Kasus standar (wajib lolos persis)**

Input:
```
Line 1: Latte,       qty 2, unitPrice 28.000 (28000), modifier 5.000 (5000), itemDiscount 0
Line 2: Nasi Goreng, qty 1, unitPrice 35.000 (35000), modifier 0,            itemDiscount 5.000 (5000)
Settings: orderDiscountPercent 10%, maxDiscount 15.000 (15000),
          serviceCharge 5%, tax 10%, taxInclusive false, roundingTo 100, roundingMode 'nearest'
```
Expected:
```
grossAmount L1        = 66.000   (66000)
grossAmount L2        = 35.000   (35000)
subtotal              = 101.000  (101000)
itemDiscountTotal     =   5.000  (5000)
discountBase          =  96.000  (96000)
orderDiscount         =   9.600  (9600)
allocated L1          =   6.600  (6600)
allocated L2          =   3.000  (3000)
netAmount L1          =  59.400  (59400)
netAmount L2          =  27.000  (27000)
netSales              =  86.400  (86400)
serviceCharge         =   4.320  (4320)
taxBase               =  90.720  (90720)
taxAmount             =   9.072  (9072)
totalBeforeRounding   =  99.792  (99792)
total                 =  99.800  (99800)
rounding              =       8  (8)
```

**TC-02 — Tanpa pajak & tanpa service charge**
```
1 × Kopi Tubruk 15.000 (15000), tax 0%, service 0%, roundingTo 100
→ total = 15.000 (15000), rounding = 0, taxAmount = 0
```

**TC-03 — Harga sudah termasuk pajak (taxInclusive = true)**
```
1 × Menu 110.000 (110000), tax 10%, service 0%, roundingTo 1
→ taxBase  = 110.000 (110000)
→ taxAmount = 110.000 − (110.000 / 1,1) = 10.000   (110000 − (110000 / 1.1) = 10000)
→ total     = 110.000 (110000)  (pelanggan tetap bayar 110.000)
```

**TC-04 — Sisa pembulatan alokasi diserap baris terakhir**
```
3 baris @ 10.000 (10000) (total 30.000 / 30000), orderDiscount 10.000 (10000)
→ alokasi naif: 3.333,33 (3333.33) × 3 = 9.999,99 (9999.99) ≠ 10.000 (10000)
→ Expected: 3.333,33 / 3.333,33 / 3.333,34   (3333.33 / 3333.33 / 3333.34)
  → Σ = 10.000 (10000) PERSIS
Assertion wajib: Σ allocated === orderDiscount
```

**TC-05 — Diskon melebihi tagihan**
```
subtotal 50.000 (50000), orderDiscountAmount 80.000 (80000)
→ orderDiscount di-cap jadi 50.000 (50000), netSales = 0, total = 0
→ tidak boleh menghasilkan angka negatif
```

**TC-06 — Item non-taxable dicampur**
```
Line 1: Makanan 100.000 (100000), isTaxable true
Line 2: Voucher parkir 5.000 (5000), isTaxable false
tax 10%, service 0%
→ taxBase  = 100.000 (100000)  (bukan 105.000 / 105000)
→ taxAmount = 10.000 (10000)
→ total     = 115.000 (115000)
```

**TC-07 — Properti invarian (property-based test)**
Untuk input acak apa pun:
```
Σ netAmount_i        === netSales
Σ allocated_i        === orderDiscount
total                >= 0
rounding (mode 'nearest')  berada di rentang (−roundingTo/2, +roundingTo/2]
rounding (mode 'up')       selalu >= 0
rounding (mode 'down')     selalu <= 0
```

**TC-16 — roundingMode 'nearest', rounding negatif**
```
totalBeforeRounding 99.849 (99849), roundingTo 100, roundingMode 'nearest'
→ total   99.800 (99800)
→ rounding    −49
Assertion: total − totalBeforeRounding === rounding PERSIS
```

**TC-17 — roundingMode 'up', rounding selalu positif**
```
totalBeforeRounding 99.201 (99201), roundingTo 100, roundingMode 'up'
→ total   99.300 (99300)
→ rounding   +99
Assertion: rounding >= 0
```

---

## B. HPP / COGS (`lib/calc/cogs.ts`)

### B.1 HPP per produk dari resep

```
Untuk tiap bahan dalam resep:
  effectiveQty  = recipeQty × (1 + wastePercent/100)
  effectiveCost = avgCost / (yieldPercent / 100)
  lineCost      = effectiveQty × effectiveCost

hppProduk = Σ lineCost + (overheadCost / outputQty)
```

Kalau bahan berstatus `is_semi_finished`, jalankan resepnya secara rekursif.
**Batas rekursi maksimal 5 level**, dan wajib deteksi circular reference → lempar error jelas.

**TC-08 — HPP Caffe Latte**
```
Biji kopi   18 g   × avgCost 145       (145),    yield 100%, waste 3%  → 2.688,30  (2688.30)
Susu UHT   200 ml  × avgCost 18,5      (18.5),   yield 100%, waste 0%  → 3.700,00  (3700.00)
Gula cair   10 ml  × avgCost 12        (12),      yield 100%, waste 0%  →   120,00  (120.00)
Cup + lid    1 pcs × avgCost 1.350     (1350),    yield 100%, waste 0%  → 1.350,00  (1350.00)
────────────────────────────────────────────────────────────────────────────────────────────────
hpp = 7.858,30  (7858.30)
```
Turunan: harga jual 28.000 (28000) → foodCostPercent = 28,06% (28.06%)

**TC-09 — Yield di bawah 100%**
```
Ayam fillet: recipeQty 150 g, avgCost 45/g (45), yield 80%
→ effectiveCost = 45 / 0,8   (45 / 0.8)   = 56,25  (56.25)
→ lineCost      = 150 × 56,25 (150 × 56.25) = 8.437,50 (8437.50)
```

### B.2 Weighted Average Cost

```
newAvgCost = (qtyLama × avgCostLama + qtyMasuk × costMasuk) / (qtyLama + qtyMasuk)

costMasuk per base unit =
  (hargaBeliPerPurchaseUnit − diskonPerUnit + alokasiOngkirPerUnit) / purchaseFactor

alokasiOngkir_i = ongkirTotal × (lineTotal_i / Σ lineTotal)
```

**TC-10 — WAC dasar**
```
Stok 1000 g @ 145 (145), masuk 1000 g @ 160 (160)
→ newAvgCost = (145.000 + 160.000) / 2000   (145000 + 160000) / 2000   = 152,50 (152.50)
```

**TC-11 — Stok nol atau negatif**
```
qtyLama <= 0 → newAvgCost = costMasuk (jangan pakai rumus rata-rata)
```

**TC-12 — Alokasi ongkir**
```
Beli: kopi 5 kg @ 145.000 (145000) = 725.000 (725000)
      susu 20 l  @  18.500 (18500)  = 370.000 (370000)
Ongkir 50.000 (50000)
→ alokasi kopi = 50.000 × 725/1095 (50000 × 725/1095) = 33.105,02 (33105.02) → per gram +6,62 (+6.62)
→ alokasi susu = 50.000 × 370/1095 (50000 × 370/1095) = 16.894,98 (16894.98) → per ml   +0,84 (+0.84)
Assertion: Σ alokasi === ongkirTotal
```

### B.3 Variance

```
pemakaianTeoritis = Σ (qtyTerjual × recipeQty)
pemakaianAktual   = stokAwal + pembelian − stokAkhir
varianceQty       = pemakaianAktual − pemakaianTeoritis
varianceValue     = varianceQty × avgCost
variancePercent   = varianceQty / pemakaianTeoritis × 100
```
`pemakaianTeoritis = 0` → `variancePercent = null`, bukan Infinity.

---

## C. Laba Rugi (`lib/calc/pnl.ts`)

```
grossSales      = Σ order.subtotal            [order status = paid]
discountTotal   = Σ order.discountTotal
refundTotal     = Σ refund.amount
netSales        = grossSales − discountTotal − refundTotal

cogs            = Σ orderItem.cogsAmount + wasteValue
grossProfit     = netSales − cogs
grossMarginPct  = grossProfit / netSales × 100

opex            = laborCost + occupancy + utility + marketing
                + commission + mdr + supplies + admin + depreciation
operatingProfit = grossProfit − opex
netProfit       = operatingProfit + otherIncome − otherExpense − incomeTax
```

Aturan penting:
- Pajak (PB1) dan service charge **tidak masuk** `netSales`. Keduanya bukan pendapatan usaha.
- Penjualan marketplace dicatat **gross**; komisi masuk sebagai beban terpisah.
- `netSales = 0` → semua persentase bernilai `null`, jangan bagi nol.

**TC-13 — P&L satu hari**
```
grossSales 10.000.000 (10000000) ; diskon 500.000 (500000) ; refund 200.000 (200000)
→ netSales        = 9.300.000 (9300000)
cogs 2.900.000 (2900000)
→ grossProfit     = 6.400.000 (6400000)  (68,82% / 68.82%)
labor 1.800.000 (1800000) + sewa 500.000 (500000) + utilitas 300.000 (300000)
  + penyusutan 200.000 (200000) = 2.800.000 (2800000)
→ operatingProfit = 3.600.000 (3600000)
pajak 0
→ netProfit       = 3.600.000 (3600000)  (38,71% / 38.71%)
```

---

## D. KPI (`lib/calc/kpi.ts`)

```
foodCostPercent   = cogs / netSales × 100
laborCostPercent  = laborCost / netSales × 100
primeCostPercent  = foodCostPercent + laborCostPercent     // target ≤ 65%
averageCheck      = netSales / orderCount
salesPerGuest     = netSales / guestCount
voidRate          = voidCount / orderCount × 100
discountRate      = discountTotal / grossSales × 100
wastePercent      = wasteValue / cogs × 100

contributionMarginRatio = (netSales − variableCost) / netSales
bepRupiah               = fixedCost / contributionMarginRatio
marginOfSafetyPercent   = (netSales − bepRupiah) / netSales × 100
```

Semua pembagi nol → hasil `null`, bukan `NaN` atau `Infinity`. Wajib ada test untuk ini.

---

## E. Rekonsiliasi Kas Shift (`lib/calc/shift.ts`)

```
expectedCash = openingCash
             + Σ payment tunai
             − Σ kembalian
             + Σ cashIn
             − Σ cashOut
             − Σ refund tunai

cashVariance = countedCash − expectedCash
```

Aturan UI yang harus ditegakkan di server juga: `countedCash` bersifat **write-once**. Setelah tersimpan, tidak bisa diubah — kasir tidak boleh menyesuaikan angka setelah melihat `expectedCash`.

**TC-14**
```
openingCash 500.000 (500000) ; tunai masuk 3.200.000 (3200000) ; kembalian 150.000 (150000)
cashIn 0 ; cashOut 75.000 (75000) (beli galon) ; refund tunai 0
→ expectedCash  = 3.475.000 (3475000)
countedCash 3.460.000 (3460000)
→ cashVariance  = −15.000 (−15000)  (kurang)
```

---

## F. Business Date (`lib/utils/business-date.ts`)

```
businessDate(createdAt, timezone, dayCutoffTime):
  local = konversi createdAt ke timezone outlet
  kalau jam(local) < dayCutoffTime → tanggal(local) − 1 hari
  selain itu                       → tanggal(local)
```

**TC-15**
```
cutoff 04:00, tz Asia/Jakarta
2026-08-12 01:30 WIB → businessDate 2026-08-11
2026-08-12 03:59 WIB → businessDate 2026-08-11
2026-08-12 04:00 WIB → businessDate 2026-08-12
2026-08-12 23:00 WIB → businessDate 2026-08-12
```
Wajib ada test untuk outlet zona WITA juga, dengan server berjalan di UTC.
