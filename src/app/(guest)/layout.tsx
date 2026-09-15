import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pesan Sekarang",
  description: "Pesan langsung dari meja Anda",
};

/**
 * Layout untuk halaman publik customer (/order/[token]).
 * Tidak ada auth check, tidak ada sidebar dashboard, tidak ada header kasir.
 * Murni halaman publik -- siapapun bisa akses kalau punya token yang valid.
 */
export default function GuestLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-gray-50">
      {children}
    </div>
  );
}
