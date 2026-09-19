import { NextResponse } from "next/server";
import { ambilOmzetHarianIntegrasi, RentangTidakValid } from "@/lib/integrasi/omzet-harian";
import { bacaKonfigurasiIntegrasi, tokenIntegrasiValid } from "@/lib/integrasi/token";

/**
 * GET /api/integrasi/omzet-harian?dari=yyyy-MM-dd&sampai=yyyy-MM-dd
 *
 * Endpoint TARIKAN baca-saja untuk sistem laporan Koperumnas (19 September
 * 2026, lihat lib/integrasi/omzet-harian.ts untuk kontrak dan definisi
 * angka). Bukan endpoint pengguna: tidak ada sesi Supabase, dijaga token
 * Bearer statis (INTEGRASI_LAPORAN_TOKEN) dan terikat ke SATU bisnis
 * (INTEGRASI_BUSINESS_ID). Pengecualian tertulis untuk koneksi admin
 * dicatat di CLAUDE.md §3.4 -- pemanggilan koneksinya ada di lib/, bukan di
 * sini.
 *
 * Kode status: 503 = belum dikonfigurasi, 401 = token salah/tidak ada,
 * 400 = parameter tidak valid, 500 = galat (pesan generik, detail hanya di log).
 * Tidak pernah di-cache -- angka hari berjalan berubah terus.
 */
export const dynamic = "force-dynamic";

const HEADER_TANPA_CACHE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const konfigurasi = bacaKonfigurasiIntegrasi();
  if (!konfigurasi) {
    return NextResponse.json(
      { galat: "Integrasi belum dikonfigurasi." },
      { status: 503, headers: HEADER_TANPA_CACHE }
    );
  }

  const sah = await tokenIntegrasiValid(request.headers.get("authorization"), konfigurasi.token);
  if (!sah) {
    return NextResponse.json(
      { galat: "Tidak berwenang." },
      { status: 401, headers: { ...HEADER_TANPA_CACHE, "WWW-Authenticate": "Bearer" } }
    );
  }

  const url = new URL(request.url);
  const dari = url.searchParams.get("dari");
  const sampai = url.searchParams.get("sampai");

  try {
    const data = await ambilOmzetHarianIntegrasi({ businessId: konfigurasi.businessId, dari, sampai });
    return NextResponse.json(data, { status: 200, headers: HEADER_TANPA_CACHE });
  } catch (err) {
    // Parameter tanggal buruk (divalidasi di lib dengan zona waktu bisnis, bukan zona server).
    if (err instanceof RentangTidakValid) {
      return NextResponse.json({ galat: err.message }, { status: 400, headers: HEADER_TANPA_CACHE });
    }
    // Jangan bocorkan detail ke pemanggil; jangan pernah mencatat token.
    console.error("[integrasi/omzet-harian] gagal:", err instanceof Error ? err.message : "galat tidak dikenal");
    return NextResponse.json(
      { galat: "Gagal menyusun ringkasan omzet." },
      { status: 500, headers: HEADER_TANPA_CACHE }
    );
  }
}
