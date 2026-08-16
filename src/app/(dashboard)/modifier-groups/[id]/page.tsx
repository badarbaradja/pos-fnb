import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, and, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { modifierGroups, modifiers } from "@/lib/db/schema";
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
import { ModifierFormDialog } from "./modifier-form-dialog";
import { ModifierDeleteButton, ModifierToggleActiveButton } from "./modifier-row-actions";

export default async function ModifierGroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: modifierGroupId } = await params;
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "product.manage"
  );

  let group;
  let rows;
  try {
    [group] = await db
      .select()
      .from(modifierGroups)
      .where(
        and(
          eq(modifierGroups.id, modifierGroupId),
          eq(modifierGroups.businessId, businessId)
        )
      );
    if (!group) {
      return notFound();
    }
    rows = await db
      .select()
      .from(modifiers)
      .where(eq(modifiers.modifierGroupId, modifierGroupId))
      .orderBy(asc(modifiers.sortOrder), asc(modifiers.name));
  } finally {
    await closeDb();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/modifier-groups"
          className="text-sm text-muted-foreground hover:underline"
        >
          {"< "}
          {strings.modifierGroups.backToGroups}
        </Link>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            {strings.modifiers.title} — {group.name}
          </h1>
        </div>
        <ModifierFormDialog
          modifierGroupId={modifierGroupId}
          trigger={<Button>{strings.modifiers.addButton}</Button>}
        />
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{strings.modifiers.empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{strings.modifiers.name}</TableHead>
              <TableHead>{strings.modifiers.price}</TableHead>
              <TableHead>{strings.modifiers.sortOrder}</TableHead>
              <TableHead>{strings.modifiers.colStatus}</TableHead>
              <TableHead className="text-right">
                {strings.common.actions}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.name}</TableCell>
                <TableCell>{row.price}</TableCell>
                <TableCell>{row.sortOrder}</TableCell>
                <TableCell>
                  <Badge variant={row.isActive ? "default" : "secondary"}>
                    {row.isActive ? strings.common.active : strings.common.inactive}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <ModifierFormDialog
                      modifierGroupId={modifierGroupId}
                      modifier={row}
                      trigger={
                        <Button variant="ghost" size="sm">
                          {strings.common.edit}
                        </Button>
                      }
                    />
                    <ModifierToggleActiveButton
                      modifierId={row.id}
                      modifierGroupId={modifierGroupId}
                      isActive={row.isActive}
                    />
                    <ModifierDeleteButton
                      modifierId={row.id}
                      modifierGroupId={modifierGroupId}
                    />
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
