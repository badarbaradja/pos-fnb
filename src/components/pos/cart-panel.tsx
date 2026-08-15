"use client";

import { createPortal } from "react-dom";
import { useCartStore } from "@/lib/store/cart-store";
import type { CalcResult } from "@/lib/calc/order-calculator";
import type { PosPaymentMethod } from "@/app/(pos)/pos/get-pos-catalog";
import { useIsClient } from "@/lib/hooks/use-is-client";
import { CartLineRow } from "./cart-line-row";
import { CartSummary } from "./cart-summary";
import { id as strings } from "@/lib/i18n/id";

/**
 * Panel keranjang sisi kanan -- tablet (md:, 768px+) dan desktop (lg:,
 * 1024px+). Disembunyikan total di mobile (hidden) -- mobile pakai
 * MobileCartBar + MobileCartSheet (T18b), lihat pos-screen.tsx.
 *
 * Semua angka di panel ini (per baris maupun total) datang dari satu
 * `calcResult` yang dihitung SEKALI lewat useCartCalculation() di
 * pos-screen.tsx -- panel ini tidak pernah menjumlahkan apa pun sendiri
 * (kesepakatan T12).
 */
export function CartPanel({
  calcResult,
  paymentMethods,
  outletId,
  deviceId,
  priceTierId,
}: {
  calcResult: CalcResult;
  paymentMethods: PosPaymentMethod[];
  outletId: string;
  deviceId: string;
  priceTierId: string;
}) {
  const isClient = useIsClient();
  const lines = useCartStore((s) => s.lines);
  const removeLine = useCartStore((s) => s.removeLine);
  const setQty = useCartStore((s) => s.setQty);
  const setItemDiscount = useCartStore((s) => s.setItemDiscount);
  const setNote = useCartStore((s) => s.setNote);

  const resultById = new Map(calcResult.lines.map((l) => [l.id, l]));

  const footer = (
    // fixed + portal ke document.body (bukan child biasa di pohon React) --
    // ini percobaan kedua untuk bug "tombol Bayar tenggelam". Percobaan
    // pertama (fixed biasa, tanpa portal, cuma beda class per breakpoint)
    // TERBUKTI TIDAK CUKUP di pengujian nyata -- dilaporkan tombol tetap
    // ikut ke-scroll hilang walau sudah `position:fixed` dan hard refresh.
    // Dugaan kuat: ada leluhur (kemungkinan dari base-ui Dialog/Portal yang
    // pernah terbuka, atau sesuatu yang belum ketemu lewat audit kode) yang
    // membentuk containing block baru (transform/filter/contain), yang
    // bikin `fixed` jadi relatif ke leluhur itu, bukan ke viewport. Portal
    // React memindahkan node ini jadi ANAK LANGSUNG document.body -- keluar
    // total dari pohon DOM CartPanel/pos-screen/(pos)-layout, jadi kebal
    // terhadap containing block leluhur mana pun yang belum ketemu itu.
    // Lebar mengikuti breakpoint kolom keranjang di pos-screen.tsx
    // (md:280px tablet, lg:360px desktop, T18b) -- hidden di mobile karena
    // panel ini sendiri (root, di bawah) hidden mobile.
    <div className="fixed inset-x-0 bottom-0 z-40 hidden flex-col gap-3 border-t bg-background p-4 md:inset-x-auto md:right-0 md:flex md:w-[280px] md:border-l lg:w-[360px]">
      <CartSummary
        calcResult={calcResult}
        paymentMethods={paymentMethods}
        outletId={outletId}
        deviceId={deviceId}
        priceTierId={priceTierId}
      />
    </div>
  );

  return (
    <div className="hidden flex-col border-l bg-background md:flex md:h-full">
      <div className="shrink-0 border-b p-4">
        <h2 className="text-sm font-semibold">{strings.pos.cartTitle}</h2>
      </div>

      {/* pb besar supaya baris terakhir tidak ketutup footer yang sekarang
          melayang (portal) di atas konten, bukan lagi bagian dari alur
          normal kolom ini. */}
      <div className="p-4 pb-[480px] md:min-h-0 md:flex-1 md:overflow-y-auto">
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">{strings.pos.cartEmpty}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {lines.map((line) => (
              <CartLineRow
                key={line.id}
                line={line}
                result={resultById.get(line.id)}
                onRemove={() => removeLine(line.id)}
                onQtyChange={(qty) => setQty(line.id, qty)}
                onItemDiscountChange={(amount) => setItemDiscount(line.id, amount)}
                onNoteChange={(note) => setNote(line.id, note)}
              />
            ))}
          </div>
        )}
      </div>

      {isClient ? createPortal(footer, document.body) : null}
    </div>
  );
}
