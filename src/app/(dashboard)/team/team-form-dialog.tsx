"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { saveMembership, type MembershipFormState } from "./actions";
import { assignableMembershipRoles } from "@/lib/memberships/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { id as strings } from "@/lib/i18n/id";

export type OutletOption = { id: string; name: string };

const roleLabel: Record<(typeof assignableMembershipRoles)[number], string> = {
  manager: "Manajer",
  cashier: "Kasir",
  waiter: "Waiter",
  kitchen: "Dapur",
  warehouse: "Gudang",
};

export type MembershipFormValue = {
  id: string;
  fullName: string;
  email: string | null;
  role: string;
  outletIds: string[] | null;
  isActive: boolean;
  auditAllOutlets: boolean;
};

const initialState: MembershipFormState = {};

/**
 * TeamFormDialog cuma memegang `open` + `formKey`. Isi form (termasuk
 * useActionState) ada di MembershipFormBody, DI-REMOUNT PENUH tiap dialog
 * dibuka (key={formKey}, dinaikkan tiap onOpenChange(true)) -- ini cara
 * "reset state" yang React sarankan untuk kasus begini (bukan menulis
 * setState di dalam useEffect, yang ditolak eslint react-hooks/
 * set-state-in-effect DAN memang bisa memicu render berantai). Efek
 * sampingnya pas: tautan undangan (tampil sekali, lib/memberships/
 * manage.ts tidak pernah menyimpannya) otomatis "terlupakan" begitu
 * dialog ditutup lalu dibuka lagi untuk anggota lain, tanpa perlu
 * membersihkannya secara manual.
 */
export function TeamFormDialog(props: {
  membership?: MembershipFormValue;
  outlets: OutletOption[];
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setFormKey((k) => k + 1);
        }
      }}
    >
      <DialogTrigger render={props.trigger} />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <MembershipFormBody
          key={formKey}
          membership={props.membership}
          outlets={props.outlets}
          onRequestClose={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function MembershipFormBody({
  membership,
  outlets,
  onRequestClose,
}: {
  membership?: MembershipFormValue;
  outlets: OutletOption[];
  onRequestClose: () => void;
}) {
  const [state, formAction, isPending] = useActionState(saveMembership, initialState);
  const [scope, setScope] = useState<"all" | "specific">(
    membership && membership.outletIds ? "specific" : "all"
  );
  const [selectedOutletIds, setSelectedOutletIds] = useState<Set<string>>(
    new Set(membership?.outletIds ?? [])
  );

  useEffect(() => {
    if (state.error) {
      toast.error(state.error);
    }
    // Pola sama outlet-form-dialog.tsx: tutup begitu submit selesai --
    // KECUALI ada tautan undangan untuk ditampilkan (satu-satunya alasan
    // dialog ini tetap terbuka setelah submit sukses). `state !==
    // initialState` membedakan "baru mount, belum pernah submit" dari
    // "action sudah selesai sekali" (initialState referensi stabil level
    // modul, actions.ts selalu mengembalikan objek BARU).
    if (state !== initialState && !state.inviteLink) {
      onRequestClose();
    }
  }, [state, onRequestClose]);

  if (state.inviteLink) {
    return (
      <div className="flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle>{strings.team.inviteLinkTitle}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{strings.team.inviteLinkHint}</p>
        <Input readOnly value={state.inviteLink} onFocus={(e) => e.currentTarget.select()} />
        {state.inviteLinkGeneratedAt ? (
          <p className="text-xs text-muted-foreground">
            {strings.team.inviteLinkGeneratedAtLabel}: {new Date(state.inviteLinkGeneratedAt).toLocaleString("id-ID")}
          </p>
        ) : null}
        <p className="rounded-lg border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
          {strings.team.inviteLinkExpiryHint}
        </p>
        <DialogFooter>
          <Button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(state.inviteLink ?? "");
              toast.success(strings.team.inviteLinkCopied);
            }}
          >
            {strings.common.apply}
          </Button>
          <Button type="button" variant="outline" onClick={onRequestClose}>
            {strings.common.cancel}
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form action={formAction}>
      <DialogHeader>
        <DialogTitle>{membership ? strings.team.editTitle : strings.team.addTitle}</DialogTitle>
      </DialogHeader>
      {membership ? <input type="hidden" name="id" value={membership.id} /> : null}
      <div className="flex flex-col gap-4 py-4">
        {membership ? (
          <div className="flex flex-col gap-1">
            <Label>{strings.team.email}</Label>
            <p className="text-sm">{membership.email ?? "-"}</p>
            <p className="text-xs text-muted-foreground">{strings.team.emailLockedHint}</p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">{strings.team.email}</Label>
              <Input id="email" name="email" type="email" placeholder={strings.team.emailPlaceholder} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="fullName">{strings.team.fullName}</Label>
              <Input id="fullName" name="fullName" required />
            </div>
          </>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="role">{strings.team.role}</Label>
          <select
            id="role"
            name="role"
            defaultValue={membership?.role ?? assignableMembershipRoles[0]}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
          >
            {assignableMembershipRoles.map((r) => (
              <option key={r} value={r}>
                {roleLabel[r]}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">{strings.team.roleOwnerAccountantHint}</p>
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-input p-3">
          <Label>{strings.team.outletScope}</Label>
          <div className="flex items-center gap-2">
            <input
              type="radio"
              id="scopeAll"
              name="outletScope"
              value="all"
              checked={scope === "all"}
              onChange={() => setScope("all")}
            />
            <Label htmlFor="scopeAll" className="text-sm font-normal">
              {strings.team.outletScopeAll}
            </Label>
          </div>
          <p className="pl-6 text-xs text-muted-foreground">{strings.team.outletScopeAllHint}</p>
          <div className="flex items-center gap-2">
            <input
              type="radio"
              id="scopeSpecific"
              name="outletScope"
              value="specific"
              checked={scope === "specific"}
              onChange={() => setScope("specific")}
            />
            <Label htmlFor="scopeSpecific" className="text-sm font-normal">
              {strings.team.outletScopeSpecific}
            </Label>
          </div>
          <p className="pl-6 text-xs text-muted-foreground">{strings.team.outletScopeSpecificHint}</p>
          {scope === "specific" ? (
            <div className="flex flex-col gap-1 pl-6">
              {outlets.map((o) => (
                <div key={o.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`outlet-${o.id}`}
                    name="outletIds"
                    value={o.id}
                    checked={selectedOutletIds.has(o.id)}
                    onCheckedChange={(checked) => {
                      setSelectedOutletIds((prev) => {
                        const next = new Set(prev);
                        if (checked) {
                          next.add(o.id);
                        } else {
                          next.delete(o.id);
                        }
                        return next;
                      });
                    }}
                  />
                  <Label htmlFor={`outlet-${o.id}`} className="text-sm font-normal">
                    {o.name}
                  </Label>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {membership ? (
          <div className="flex items-center gap-2">
            <Checkbox id="isActive" name="isActive" defaultChecked={membership.isActive} />
            <Label htmlFor="isActive" className="text-sm font-normal">
              {strings.team.isActive}
            </Label>
          </div>
        ) : null}
        {membership ? <p className="text-xs text-muted-foreground">{strings.team.deactivateHint}</p> : null}

        {membership ? (
          <div className="flex flex-col gap-1 rounded-lg border border-input p-3">
            <div className="flex items-center gap-2">
              <Checkbox id="auditAllOutlets" name="auditAllOutlets" defaultChecked={membership.auditAllOutlets} />
              <Label htmlFor="auditAllOutlets" className="text-sm font-normal">
                {strings.team.auditAllOutlets}
              </Label>
            </div>
            <p className="pl-6 text-xs text-muted-foreground">{strings.team.auditAllOutletsHint}</p>
          </div>
        ) : null}
      </div>
      <DialogFooter>
        <Button type="submit" disabled={isPending}>
          {isPending ? strings.common.saving : strings.common.save}
        </Button>
      </DialogFooter>
    </form>
  );
}
