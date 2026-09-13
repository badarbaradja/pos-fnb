import { asc, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { outlets } from "@/lib/db/schema";
import { listMembershipsWithDb } from "@/lib/memberships/manage";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { id as strings } from "@/lib/i18n/id";
import { TeamFormDialog, type MembershipFormValue } from "./team-form-dialog";

export default async function TeamPage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "membership.manage");

  let memberRows;
  let emailListTruncated;
  let outletRows;
  try {
    const listResult = await listMembershipsWithDb(db, businessId);
    memberRows = listResult.rows;
    emailListTruncated = listResult.emailListTruncated;
    outletRows = await db
      .select({ id: outlets.id, name: outlets.name })
      .from(outlets)
      .where(eq(outlets.businessId, businessId))
      .orderBy(asc(outlets.name));
  } finally {
    await closeDb();
  }

  const outletNameById = new Map(outletRows.map((o) => [o.id, o.name]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{strings.team.title}</h1>
          <p className="text-sm text-muted-foreground">{strings.team.subtitle}</p>
        </div>
        <TeamFormDialog outlets={outletRows} trigger={<Button>{strings.team.addButton}</Button>} />
      </div>

      {emailListTruncated ? (
        <p className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
          {strings.team.emailListTruncatedWarning}
        </p>
      ) : null}

      {memberRows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{strings.team.empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{strings.team.colName}</TableHead>
              <TableHead>{strings.team.colEmail}</TableHead>
              <TableHead>{strings.team.colRole}</TableHead>
              <TableHead>{strings.team.colOutlets}</TableHead>
              <TableHead>{strings.team.colStatus}</TableHead>
              <TableHead className="text-right">{strings.team.colActions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {memberRows.map((row) => {
              const isManaged = row.role === "owner" || row.role === "accountant";
              const formValue: MembershipFormValue = {
                id: row.id,
                fullName: row.fullName,
                email: row.email,
                role: row.role,
                outletIds: row.outletIds,
                isActive: row.isActive,
              };
              return (
                <TableRow key={row.id}>
                  <TableCell>{row.fullName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{row.email ?? "-"}</TableCell>
                  <TableCell className="capitalize">{row.role}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.outletIds === null
                      ? strings.team.outletScopeAll
                      : row.outletIds.map((id) => outletNameById.get(id) ?? "?").join(", ")}
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.isActive ? "default" : "secondary"}>
                      {row.isActive ? strings.common.active : strings.common.inactive}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {isManaged ? (
                      <span className="text-xs text-muted-foreground">{strings.team.ownerAccountantBadge}</span>
                    ) : (
                      <TeamFormDialog
                        membership={formValue}
                        outlets={outletRows}
                        trigger={
                          <Button variant="ghost" size="sm">
                            {strings.common.edit}
                          </Button>
                        }
                      />
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
