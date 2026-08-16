import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { modifierGroups } from "@/lib/db/schema";
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
import { ModifierGroupFormDialog } from "./modifier-group-form-dialog";
import {
  ModifierGroupDeleteButton,
  ModifierGroupToggleActiveButton,
} from "./modifier-group-row-actions";

export default async function ModifierGroupsPage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "product.manage"
  );

  let rows;
  try {
    rows = await db
      .select()
      .from(modifierGroups)
      .where(eq(modifierGroups.businessId, businessId))
      .orderBy(asc(modifierGroups.name));
  } finally {
    await closeDb();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{strings.modifierGroups.title}</h1>
          <p className="text-sm text-muted-foreground">
            {strings.modifierGroups.subtitle}
          </p>
        </div>
        <ModifierGroupFormDialog
          trigger={<Button>{strings.modifierGroups.addButton}</Button>}
        />
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {strings.modifierGroups.empty}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{strings.modifierGroups.name}</TableHead>
              <TableHead>{strings.modifierGroups.minSelect}</TableHead>
              <TableHead>{strings.modifierGroups.maxSelect}</TableHead>
              <TableHead>{strings.modifierGroups.isRequired}</TableHead>
              <TableHead>{strings.modifierGroups.colStatus}</TableHead>
              <TableHead className="text-right">
                {strings.common.actions}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.name}</TableCell>
                <TableCell>{row.minSelect}</TableCell>
                <TableCell>{row.maxSelect}</TableCell>
                <TableCell>
                  {row.isRequired ? strings.common.active : strings.common.inactive}
                </TableCell>
                <TableCell>
                  <Badge variant={row.isActive ? "default" : "secondary"}>
                    {row.isActive ? strings.common.active : strings.common.inactive}
                  </Badge>
                </TableCell>
                <TableCell className="flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    nativeButton={false}
                    render={
                      <Link href={`/modifier-groups/${row.id}`}>
                        {strings.modifierGroups.manageModifiers}
                      </Link>
                    }
                  />
                  <ModifierGroupFormDialog
                    modifierGroup={row}
                    trigger={
                      <Button variant="ghost" size="sm">
                        {strings.common.edit}
                      </Button>
                    }
                  />
                  <ModifierGroupToggleActiveButton
                    modifierGroupId={row.id}
                    isActive={row.isActive}
                  />
                  <ModifierGroupDeleteButton modifierGroupId={row.id} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
