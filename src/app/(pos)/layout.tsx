import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";

export default async function PosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Sama seperti (dashboard)/layout.tsx -- tanpa gate di sini,
  // requirePermissionDb() di page.tsx melempar Error mentah (bukan
  // redirect) saat belum ada sesi, dan itu jadi 500, bukan ke /login.
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  // Dulu di sini ada h-dvh + overflow-hidden dari md ke atas, mengaktifkan
  // rantai tinggi pasti (min-h-0/flex-1) di pos-screen.tsx/product-grid.tsx
  // supaya ProductGrid scroll SENDIRI di kolomnya (bukan halaman). Rantai
  // itu terbukti rapuh -- product grid gagal discroll sama sekali di
  // pengujian nyata, dan cart-panel.tsx punya catatan soal leluhur tak
  // dikenal di pohon ini yang pernah bikin position:fixed salah anchor
  // (lihat komentar di cart-panel.tsx). Karena CartPanel SUDAH sepenuhnya
  // lepas dari flow halaman (fixed + portal ke document.body, lihat
  // cart-panel.tsx), rantai tinggi-pasti ini tidak lagi punya fungsi selain
  // bikin ProductGrid scroll sendiri -- diganti scroll halaman biasa di
  // semua breakpoint (lebih sederhana, tidak butuh setiap elemen di
  // tengah pohon menghitung tinggi pasti dengan benar). Header Tingkat
  // Harga tetap kelihatan waktu scroll lewat position:sticky di
  // price-tier-selector.tsx, bukan lewat pemotongan tinggi presisi.
  return <div className="min-h-dvh">{children}</div>;
}
