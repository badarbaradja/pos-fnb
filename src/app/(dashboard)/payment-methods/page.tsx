import { asc, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { paymentMethods } from "@/lib/db/schema";
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
import { PaymentMethodFormDialog } from "./payment-method-form-dialog";
import {
  PaymentMethodDeleteButton,
  PaymentMethodToggleActiveButton,
} from "./payment-method-row-actions";

const typeLabels: Record<string, string> = {
  cash: strings.paymentMethods.typeCash,
  card: strings.paymentMethods.typeCard,
  ewallet: strings.paymentMethods.typeEwallet,
  qris: strings.paymentMethods.typeQris,
  transfer: strings.paymentMethods.typeTransfer,
  voucher: strings.paymentMethods.typeVoucher,
  credit: strings.paymentMethods.typeCredit,
};

export default async function PaymentMethodsPage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "price.manage"
  );

  let rows;
  try {
    rows = await db
      .select()
      .from(paymentMethods)
      .where(eq(paymentMethods.businessId, businessId))
      .orderBy(asc(paymentMethods.sortOrder), asc(paymentMethods.code));
  } finally {
    await closeDb();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{strings.paymentMethods.title}</h1>
          <p className="text-sm text-muted-foreground">
            {strings.paymentMethods.subtitle}
          </p>
        </div>
        <PaymentMethodFormDialog
          trigger={<Button>{strings.paymentMethods.addButton}</Button>}
        />
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{strings.paymentMethods.empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{strings.paymentMethods.colCode}</TableHead>
              <TableHead>{strings.paymentMethods.colName}</TableHead>
              <TableHead>{strings.paymentMethods.colType}</TableHead>
              <TableHead>{strings.paymentMethods.colStatus}</TableHead>
              <TableHead className="text-right">{strings.common.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-xs">{row.code}</TableCell>
                <TableCell>{row.name}</TableCell>
                <TableCell>{typeLabels[row.type] ?? row.type}</TableCell>
                <TableCell>
                  <Badge variant={row.isActive ? "default" : "secondary"}>
                    {row.isActive ? strings.common.active : strings.common.inactive}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <PaymentMethodFormDialog
                      paymentMethod={row}
                      trigger={
                        <Button variant="ghost" size="sm">
                          {strings.common.edit}
                        </Button>
                      }
                    />
                    <PaymentMethodToggleActiveButton
                      paymentMethodId={row.id}
                      isActive={row.isActive}
                    />
                    <PaymentMethodDeleteButton paymentMethodId={row.id} />
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
