import { asc, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { pemilik } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { id as strings } from "@/lib/i18n/id";
import { PemilikFormDialog } from "./pemilik-form-dialog";
import { PemilikToggleActiveButton } from "./pemilik-row-actions";

export default async function PemilikPage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "pemilik.manage"
  );

  let rows;
  try {
    rows = await db
      .select()
      .from(pemilik)
      .where(eq(pemilik.businessId, businessId))
      .orderBy(asc(pemilik.nama));
  } finally {
    await closeDb();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{strings.pemilik.title}</h1>
          <p className="text-sm text-muted-foreground">{strings.pemilik.subtitle}</p>
          <p className="text-xs text-muted-foreground">{strings.pemilik.noDeleteHint}</p>
        </div>
        <PemilikFormDialog trigger={<Button>{strings.pemilik.addButton}</Button>} />
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{strings.pemilik.empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{strings.pemilik.nama}</TableHead>
              <TableHead>{strings.pemilik.kode}</TableHead>
              <TableHead>{strings.pemilik.kontak}</TableHead>
              <TableHead className="text-right">{strings.pemilik.persenBagi}</TableHead>
              <TableHead>{strings.pemilik.colStatus}</TableHead>
              <TableHead className="text-right">{strings.common.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.nama}</TableCell>
                <TableCell className="font-mono text-xs">{row.kode ?? "-"}</TableCell>
                <TableCell>{row.kontak ?? "-"}</TableCell>
                <TableCell className="text-right">{row.persenBagi}%</TableCell>
                <TableCell>
                  <Badge variant={row.isActive ? "default" : "secondary"}>
                    {row.isActive ? strings.common.active : strings.common.inactive}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <PemilikFormDialog
                      pemilik={row}
                      trigger={
                        <Button variant="ghost" size="sm">
                          {strings.common.edit}
                        </Button>
                      }
                    />
                    <PemilikToggleActiveButton pemilikId={row.id} isActive={row.isActive} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
