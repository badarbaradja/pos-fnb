import { and, desc, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { outletScopeCondition } from "@/lib/auth/outlet-scope";
import { barang, categories, outlets, pemilik } from "@/lib/db/schema";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatIDR } from "@/lib/utils/money";
import { Decimal } from "decimal.js";
import { id as strings } from "@/lib/i18n/id";
import { BarangIntakeForm } from "./barang-intake-form";
import { BarangLabelLink, BarangStatusActions } from "./barang-row-actions";

const statusLabels: Record<string, string> = {
  baru_masuk: "Baru Masuk",
  siap_jual: "Siap Jual",
  terjual: "Terjual",
  rusak: "Rusak",
};

const statusVariant: Record<string, "default" | "secondary" | "outline"> = {
  baru_masuk: "outline",
  siap_jual: "default",
  terjual: "secondary",
  rusak: "secondary",
};

export default async function BarangPage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, allowedOutletIds } = await requirePermissionDb(
    supabase,
    "barang.manage"
  );

  // Pembatasan akses per outlet, Tahap 3 (13 September 2026, §24) --
  // MEMOTONG SELURUH halaman termasuk form intake (bukan cuma daftar):
  // kalau scope kosong, dropdown outlet form intake juga akan kosong,
  // membingungkan tanpa pesan jelas. "Barang (daftar + cetak label)" --
  // halaman tulis (Server Action intake) SENGAJA TIDAK disentuh (Tahap
  // 3 cuma baca-saja); ini murni memotong RENDER, bukan mengubah izin.
  if (allowedOutletIds !== null && allowedOutletIds.length === 0) {
    await closeDb();
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">{strings.barang.title}</h1>
        <p className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {strings.common.noOutletAccess}
        </p>
      </div>
    );
  }

  let outletOptions, categoryOptions, pemilikOptions, rows;
  try {
    [outletOptions, categoryOptions, pemilikOptions] = await Promise.all([
      // Dropdown form intake TIDAK PERNAH menampilkan outlet di luar
      // cakupan (keputusan CEO: outlet yang muncul lalu ditolak server
      // itu membingungkan) -- Server Action intake-nya sendiri TETAP
      // TIDAK disentuh, ini murni narrowing tampilan.
      db
        .select({ id: outlets.id, name: outlets.name })
        .from(outlets)
        .where(
          and(
            eq(outlets.businessId, businessId),
            eq(outlets.posMode, "thrifting"),
            eq(outlets.isActive, true),
            outletScopeCondition(allowedOutletIds, outlets.id)
          )
        ),
      db
        .select({ id: categories.id, name: categories.name })
        .from(categories)
        .where(
          and(
            eq(categories.businessId, businessId),
            eq(categories.scope, "thrifting"),
            eq(categories.isActive, true)
          )
        ),
      db
        .select({ id: pemilik.id, nama: pemilik.nama })
        .from(pemilik)
        .where(and(eq(pemilik.businessId, businessId), eq(pemilik.isActive, true))),
    ]);

    rows = await db
      .select({
        id: barang.id,
        kode: barang.kode,
        nama: barang.nama,
        ukuran: barang.ukuran,
        warna: barang.warna,
        hargaJual: barang.hargaJual,
        status: barang.status,
        categoryName: categories.name,
        pemilikNama: pemilik.nama,
        masukPada: barang.masukPada,
      })
      .from(barang)
      .leftJoin(categories, eq(barang.categoryId, categories.id))
      .leftJoin(pemilik, eq(barang.pemilikId, pemilik.id))
      .where(and(eq(barang.businessId, businessId), outletScopeCondition(allowedOutletIds, barang.outletId)))
      .orderBy(desc(barang.masukPada))
      .limit(200);
  } finally {
    await closeDb();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{strings.barang.title}</h1>
        <p className="text-sm text-muted-foreground">{strings.barang.subtitle}</p>
      </div>

      <BarangIntakeForm
        outlets={outletOptions}
        categories={categoryOptions}
        pemilikList={pemilikOptions}
      />

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">{strings.barang.listTitle}</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{strings.barang.empty}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{strings.barang.colKode}</TableHead>
                <TableHead>{strings.barang.nama}</TableHead>
                <TableHead>{strings.barang.category}</TableHead>
                <TableHead>{strings.barang.pemilik}</TableHead>
                <TableHead className="text-right">{strings.barang.hargaJual}</TableHead>
                <TableHead>{strings.barang.colStatus}</TableHead>
                <TableHead className="text-right">{strings.common.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">{row.kode}</TableCell>
                  <TableCell>
                    {row.nama}
                    {row.ukuran ? (
                      <span className="text-muted-foreground"> · {row.ukuran}</span>
                    ) : null}
                    {row.warna ? (
                      <span className="text-muted-foreground"> · {row.warna}</span>
                    ) : null}
                  </TableCell>
                  <TableCell>{row.categoryName ?? "-"}</TableCell>
                  <TableCell>{row.pemilikNama ?? strings.barang.pemilikTokoSendiri}</TableCell>
                  <TableCell className="text-right">
                    {formatIDR(new Decimal(row.hargaJual))}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant[row.status] ?? "outline"}>
                      {statusLabels[row.status] ?? row.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <BarangLabelLink barangId={row.id} />
                      <BarangStatusActions barangId={row.id} status={row.status} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
