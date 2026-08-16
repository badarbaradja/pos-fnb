"use client";

import { deleteUnit } from "./actions";
import { DeleteConfirmButton } from "@/components/dashboard/delete-confirm-button";
import { id as strings } from "@/lib/i18n/id";

export function UnitDeleteButton({ unitId }: { unitId: string }) {
  return (
    <DeleteConfirmButton
      onDelete={() => deleteUnit(unitId)}
      confirmTitle={strings.units.deleteConfirmTitle}
      confirmHint={strings.units.deleteConfirmHint}
      successMessage={strings.units.deleteSuccess}
      buttonLabel={strings.units.deleteButton}
    />
  );
}
