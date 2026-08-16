import { asc, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { categories } from "@/lib/db/schema";
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
import { CategoryFormDialog } from "./category-form-dialog";
import { CategoryToggleActiveButton, CategoryDeleteButton } from "./category-row-actions";

export default async function CategoriesPage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "product.manage"
  );

  let rows;
  try {
    rows = await db
      .select()
      .from(categories)
      .where(eq(categories.businessId, businessId))
      .orderBy(asc(categories.sortOrder), asc(categories.name));
  } finally {
    await closeDb();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{strings.categories.title}</h1>
          <p className="text-sm text-muted-foreground">
            {strings.categories.subtitle}
          </p>
        </div>
        <CategoryFormDialog
          trigger={<Button>{strings.categories.addButton}</Button>}
        />
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {strings.categories.empty}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{strings.categories.name}</TableHead>
              <TableHead>{strings.categories.sortOrder}</TableHead>
              <TableHead>{strings.categories.colStatus}</TableHead>
              <TableHead className="text-right">
                {strings.common.actions}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="flex items-center gap-2">
                  <span
                    className="h-3 w-3 shrink-0 rounded-full border"
                    style={{ backgroundColor: row.color ?? undefined }}
                  />
                  {row.name}
                </TableCell>
                <TableCell>{row.sortOrder}</TableCell>
                <TableCell>
                  <Badge variant={row.isActive ? "default" : "secondary"}>
                    {row.isActive ? strings.common.active : strings.common.inactive}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <CategoryFormDialog
                      category={row}
                      trigger={
                        <Button variant="ghost" size="sm">
                          {strings.common.edit}
                        </Button>
                      }
                    />
                    <CategoryToggleActiveButton
                      categoryId={row.id}
                      isActive={row.isActive}
                    />
                    <CategoryDeleteButton categoryId={row.id} />
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
