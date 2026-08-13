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

  // h-dvh + overflow-hidden HANYA dari md ke atas -- itu yang mengaktifkan
  // rantai tinggi pasti (min-h-0/flex-1) yang dipakai product-grid.tsx dan
  // cart-panel.tsx untuk scroll internal per kolom di desktop. Di layar
  // sempit, ProductGrid dan CartPanel jadi dua baris bertumpuk (grid-cols-1
  // di pos-screen.tsx), dan tumpukan auto-row itu TIDAK ikut terbagi rapi
  // oleh min-h-0/flex-1 -- CartPanel jadi tumbuh sebebas kontennya, lalu
  // overflow-hidden di sini memotongnya (footer/tombol Bayar "tenggelam",
  // tidak bisa di-scroll ke sana sama sekali). Makanya di layar sempit
  // biarkan halaman tumbuh & scroll alami (min-h-dvh, tanpa overflow-hidden)
  // -- tombol Bayar tetap kelihatan lewat position:fixed di cart-panel.tsx,
  // bukan lewat pemotongan tinggi presisi.
  return <div className="min-h-dvh md:h-dvh md:overflow-hidden">{children}</div>;
}
