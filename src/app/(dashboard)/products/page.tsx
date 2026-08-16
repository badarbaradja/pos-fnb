import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { categories, products } from "@/lib/db/schema";
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
import { ProductToggleActiveButton } from "./product-row-actions";

export default async function ProductsPage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "product.manage"
  );

  let rows;
  try {
    rows = await db
      .select({
        id: products.id,
        name: products.name,
        productType: products.productType,
        isActive: products.isActive,
        categoryName: categories.name,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(eq(products.businessId, businessId))
      .orderBy(asc(products.sortOrder), asc(products.name));
  } finally {
    await closeDb();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{strings.products.title}</h1>
          <p className="text-sm text-muted-foreground">
            {strings.products.subtitle}
          </p>
          <p className="text-xs text-muted-foreground">{strings.products.noDeleteHint}</p>
        </div>
        <Button
          nativeButton={false}
          render={<Link href="/products/new">{strings.products.addButton}</Link>}
        />
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{strings.products.empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{strings.products.name}</TableHead>
              <TableHead>{strings.products.category}</TableHead>
              <TableHead>{strings.products.isActive}</TableHead>
              <TableHead className="text-right">
                {strings.common.actions}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.name}</TableCell>
                <TableCell>{row.categoryName ?? strings.products.categoryNone}</TableCell>
                <TableCell>
                  <Badge variant={row.isActive ? "secondary" : "outline"}>
                    {row.isActive ? strings.common.active : strings.common.inactive}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      nativeButton={false}
                      render={<Link href={`/products/${row.id}`}>{strings.common.edit}</Link>}
                    />
                    <ProductToggleActiveButton
                      productId={row.id}
                      isActive={row.isActive}
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
