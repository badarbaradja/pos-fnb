"use client";

import { useState, useEffect, useCallback } from "react";
import type { PendingOrderSummary } from "@/lib/order-guest";

function formatTime(date: Date): string {
  return new Date(date).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRp(amount: string): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(parseFloat(amount));
}

type Props = {
  outletId: string;
  /** Dipanggil saat kasir mengambil satu order — mengisi keranjang kasir */
  onTakeOrder: (order: PendingOrderSummary) => void;
};

/**
 * Badge + panel "Pesanan Masuk" di layar kasir.
 * Polling tiap 15 detik ke /api/pos/pending-orders?outletId=xxx.
 */
export function PendingOrdersBadge({ outletId, onTakeOrder }: Props) {
  const [orders, setOrders] = useState<PendingOrderSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [isTaking, setIsTaking] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch(`/api/pos/pending-orders?outletId=${outletId}`);
      if (!res.ok) return;
      const data = await res.json() as { orders: PendingOrderSummary[] };
      setOrders(data.orders ?? []);
    } catch {
      // silent -- jangan ganggu kasir kalau jaringan sesaat bermasalah
    }
  }, [outletId]);

  // Polling tiap 15 detik
  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 15_000);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  async function handleTake(order: PendingOrderSummary) {
    setIsTaking(order.id);
    try {
      onTakeOrder(order);
      // Hapus dari list lokal sementara (akan diperbarui oleh polling berikutnya)
      setOrders((prev) => prev.filter((o) => o.id !== order.id));
      setOpen(false);
    } finally {
      setIsTaking(null);
    }
  }

  if (orders.length === 0) return null;

  return (
    <>
      {/* Badge */}
      <button
        onClick={() => setOpen(true)}
        className="relative flex h-10 items-center gap-2 rounded-xl bg-orange-500 px-3 text-sm font-semibold text-white shadow-md hover:bg-orange-600 active:scale-95 transition-all"
        aria-label={`${orders.length} pesanan masuk dari customer`}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        <span>{orders.length} Pesanan</span>
        {/* Animasi berkedip */}
        <span className="absolute -right-1 -top-1 flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-300 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-orange-400" />
        </span>
      </button>

      {/* Panel slide-in */}
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setOpen(false)}
          />
          <div className="relative flex w-full max-w-sm flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-base font-bold text-gray-900">
                Pesanan Masuk ({orders.length})
              </h2>
              <button
                onClick={() => setOpen(false)}
                className="rounded-full p-1 text-gray-400 hover:bg-gray-100"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {orders.map((order) => (
                <div
                  key={order.id}
                  className="mb-3 rounded-xl border border-orange-100 bg-orange-50 p-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="rounded-lg bg-orange-500 px-2 py-0.5 text-sm font-bold text-white">
                        #{order.queueNumber}
                      </span>
                      <span className="text-xs text-gray-500">
                        {formatTime(order.openedAt)}
                      </span>
                    </div>
                    <span className="text-sm font-bold text-gray-800">
                      {formatRp(order.total)}
                    </span>
                  </div>
                  <div className="mb-3 space-y-0.5">
                    {order.items.map((item, i) => (
                      <p key={i} className="text-xs text-gray-700">
                        <span className="font-medium">{item.qty}×</span> {item.name}
                        {item.note ? (
                          <span className="italic text-gray-400"> — {item.note}</span>
                        ) : null}
                      </p>
                    ))}
                  </div>
                  {order.note && (
                    <p className="mb-2 text-xs text-gray-500">{order.note}</p>
                  )}
                  <button
                    onClick={() => handleTake(order)}
                    disabled={isTaking === order.id}
                    className="w-full rounded-lg bg-orange-500 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50"
                  >
                    {isTaking === order.id ? "Memproses..." : "Ambil & Proses"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
