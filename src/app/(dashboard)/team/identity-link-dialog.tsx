"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { saveIdentityLink, type IdentityLinkFormState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { id as strings } from "@/lib/i18n/id";

export type PosMemberOption = { userId: string; fullName: string; email: string | null };

const initialState: IdentityLinkFormState = {};

/**
 * Dialog tautan handoff (lihat lib/auth/identity-links.ts). Pola remount
 * penuh via `key` sama seperti TeamFormDialog -- reset form tiap dibuka.
 */
export function IdentityLinkDialog(props: { members: PosMemberOption[]; trigger: React.ReactElement }) {
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
      <DialogContent>
        <IdentityLinkFormBody
          key={formKey}
          members={props.members}
          onSuccess={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function IdentityLinkFormBody(props: { members: PosMemberOption[]; onSuccess: () => void }) {
  const [state, formAction, isPending] = useActionState(saveIdentityLink, initialState);

  useEffect(() => {
    if (state.success) {
      toast.success(strings.common.saveSuccess);
      props.onSuccess();
    } else if (state.error === "duplicate") {
      toast.error(strings.team.identityLinksDuplicate);
    } else if (state.error) {
      toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{strings.team.identityLinksAddButton}</DialogTitle>
      </DialogHeader>

      <div className="flex flex-col gap-2">
        <Label htmlFor="reportEmail">{strings.team.identityLinksReportEmail}</Label>
        <Input
          id="reportEmail"
          name="reportEmail"
          type="email"
          required
          placeholder={strings.team.identityLinksReportEmailPlaceholder}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="posProfileId">{strings.team.identityLinksPosMember}</Label>
        <select
          id="posProfileId"
          name="posProfileId"
          required
          defaultValue=""
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          <option value="" disabled>
            {strings.team.identityLinksPosMemberPlaceholder}
          </option>
          {props.members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.fullName} {m.email ? `(${m.email})` : ""}
            </option>
          ))}
        </select>
      </div>

      <DialogFooter>
        <Button type="submit" disabled={isPending}>
          {isPending ? strings.common.saving : strings.common.save}
        </Button>
      </DialogFooter>
    </form>
  );
}
