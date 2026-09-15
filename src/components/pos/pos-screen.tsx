"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { Decimal } from "decimal.js";
import { toast } from "sonner";
import type {
  PosCategory,
  PosDevice,
  PosOutlet,
  PosPaymentMethod,
  PosPriceTier,
  PosProduct,
} from "@/app/(pos)/pos/get-pos-catalog";
import { useCartStore } from "@/lib/store/cart-store";
import { useCartCalculation } from "@/lib/pos/use-cart-calculation";
import { ProductGrid } from "./product-grid";
import { CartPanel } from "./cart-panel";
import { AddToCartDialog } from "./add-to-cart-dialog";
import { PriceTierSelector } from "./price-tier-selector";
import { MobileCartBar } from "./mobile-cart-bar";
import { MobileCartSheet } from "./mobile-cart-sheet";
import { CashMovementDialog } from "./shift/cash-movement-dialog";
import { PendingOrdersBadge } from "./pending-orders-badge";
import { Button } from "@/components/ui/button";
import { id as strings } from "@/lib/i18n/id";
import type { PendingOrderSummary } from "@/lib/order-guest";

export function PosScreen({
  outlet,
  device,
  paymentMethods,
  priceTiers,
  defaultPriceTierId,
  categories,
  products,
  shift,
}: {
  outlet: PosOutlet;
  device: PosDevice;
  paymentMethods: PosPaymentMethod[];
  priceTiers: PosPriceTier[];
  defaultPriceTierId: string;
  categories: PosCategory[];
  products: PosProduct[];
  shift: { id: string; employeeName: string };
}) {
  const [priceTierId, setPriceTierId] = useState(defaultPriceTierId);
  const [selectedProduct, setSelectedProduct] = useState<PosProduct | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const addLine = useCartStore((s) => s.addLine);
  const clearCart = useCartStore((s) => s.clear);
  const cartLines = useCartStore((s) => s.lines);
  const cartItemCount = cartLines.reduce((sum, l) => sum.plus(l.qty), new Decimal(0));

  // Saat kasir "ambil" draft order dari customer, isi keranjang kasir
  // dengan item pesanan. Harga tidak disimpan di cart (diambil live dari
  // katalog saat calculateOrder), jadi cukup productId + variantId + qty.
  const handleTakeGuestOrder = useCallback(
    (order: PendingOrderSummary) => {
      // Bersihkan keranjang dulu kalau ada isinya
      if (cartLines.length > 0) {
        clearCart();
      }
      for (const item of order.items) {
        // Cari produk di katalog berdasarkan nama (fallback -- idealnya by id,
        // tapi draft order dari guest tidak selalu sesuai dengan id yang ada
        // di memori. Lebih aman: kasir cek dan tambah manual kalau perlu).
        const found = products.find((p) => p.name === item.name);
        if (!found) continue;
        addLine({
          productId: found.id,
          productName: found.name,
          categoryName: found.categoryName,
          variantId: null,
          variantName: null,
          modifiers: [],
          qty: new Decimal(item.qty),
          isTaxable: found.isTaxable,
          note: item.note ?? "",
        });
      }
      toast.success(`Pesanan antrian #${order.queueNumber} diambil ke keranjang`);
    },
    [products, cartLines, addLine, clearCart]
  );

  // Satu-satunya pemanggilan calculateOrder() di layar ini -- hasilnya
  // diturunkan ke CartPanel lewat props (kesepakatan T12). Baris keranjang
  // tidak menyimpan harga sendiri, jadi cukup oper `products` + priceTierId
  // yang sedang dipilih -- ganti tier otomatis menghitung ulang semuanya
  // dari katalog yang sudah di memori, tanpa query baru.
  const calcResult = useCartCalculation(products, priceTierId, {
    taxPercent: outlet.taxPercent,
    taxInclusive: outlet.taxInclusive,
    serviceChargePercent: outlet.serviceChargePercent,
    serviceChargeInTaxBase: outlet.serviceChargeInTaxBase,
    roundingTo: outlet.roundingTo,
  });

  function handleSelectProduct(product: PosProduct) {
    // Produk tanpa varian/modifier langsung masuk keranjang, tidak perlu
    // dialog -- mempercepat alur untuk item sederhana (mayoritas menu
    // makanan/snack/dessert di seed data).
    if (product.variants.length === 0 && product.modifierGroups.length === 0) {
      addLine({
        productId: product.id,
        productName: product.name,
        categoryName: product.categoryName,
        variantId: null,
        variantName: null,
        modifiers: [],
        qty: new Decimal(1),
        isTaxable: product.isTaxable,
      });
      toast.success(strings.pos.addedToCart);
      return;
    }
    setSelectedProduct(product);
    setDialogOpen(true);
  }

  return (
    <div className="flex min-h-dvh flex-col md:h-full">
      <PriceTierSelector
        priceTiers={priceTiers}
        value={priceTierId}
        onChange={setPriceTierId}
        trailing={
          <div className="flex items-center gap-2">
            {/* T22e -- begitu ada >1 outlet, ini satu-satunya cara kasir
                lihat tabletnya tersambung ke outlet yang benar SEBELUM
                transaksi (bukan ketahuan setelah stok terpotong dari
                outlet keliru). Permanen di layar, sengaja kecil. */}
            <span className="whitespace-nowrap text-xs font-medium text-muted-foreground">
              {strings.pos.outletDeviceLabel
                .replace("{outlet}", outlet.name)
                .replace("{device}", device.name)}
            </span>
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {strings.shift.activeShiftLabel}: {shift.employeeName}
            </span>
            {outlet.cashEnabled ? <CashMovementDialog shiftId={shift.id} /> : null}
            {/* Badge pesanan masuk dari customer self-order (TT-SELFORDER) */}
            <PendingOrdersBadge
              outletId={outlet.id}
              onTakeOrder={handleTakeGuestOrder}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-11"
              nativeButton={false}
              render={<Link href="/pos/shift/close">{strings.shift.closeShiftButton}</Link>}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-11"
              nativeButton={false}
              render={<Link href="/pos/receipt">{strings.pos.todaysTransactionsButton}</Link>}
            />
          </div>
        }
      />
      {/* Tablet (md:, 768px+): dua kolom, keranjang 280px. Desktop (lg:,
          1024px+): keranjang 360px seperti sebelumnya. Mobile: satu
          kolom penuh -- CartPanel disembunyikan sendiri (hidden md:flex,
          lihat cart-panel.tsx), diganti MobileCartBar+MobileCartSheet
          di bawah (T18b). */}
      <div className="grid grid-cols-1 md:min-h-0 md:flex-1 md:grid-cols-[1fr_280px] lg:grid-cols-[1fr_360px]">
        <ProductGrid
          products={products}
          categories={categories}
          priceTierId={priceTierId}
          onSelectProduct={handleSelectProduct}
        />
        <CartPanel
          calcResult={calcResult}
          paymentMethods={paymentMethods}
          outletId={outlet.id}
          deviceId={device.id}
          priceTierId={priceTierId}
        />
        <AddToCartDialog
          key={selectedProduct?.id ?? "none"}
          product={selectedProduct}
          priceTierId={priceTierId}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onConfirm={(line) => {
            addLine(line);
            toast.success(strings.pos.addedToCart);
          }}
        />
      </div>
      <MobileCartBar
        itemCount={cartItemCount}
        total={calcResult.total}
        onOpen={() => setMobileCartOpen(true)}
      />
      <MobileCartSheet
        open={mobileCartOpen}
        onOpenChange={setMobileCartOpen}
        calcResult={calcResult}
        paymentMethods={paymentMethods}
        outletId={outlet.id}
        deviceId={device.id}
        priceTierId={priceTierId}
      />
    </div>
  );
}
