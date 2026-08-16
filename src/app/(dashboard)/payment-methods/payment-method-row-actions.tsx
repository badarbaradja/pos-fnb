"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { deletePaymentMethod, setPaymentMethodActive } from "./actions";
import { Button } from "@/components/ui/button";
import { DeleteConfirmButton } from "@/components/dashboard/delete-confirm-button";
import { id as strings } from "@/lib/i18n/id";

export function PaymentMethodToggleActiveButton({
  paymentMethodId,
  isActive,
}: {
  paymentMethodId: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleToggle() {
    setIsPending(true);
    try {
      const result = await setPaymentMethodActive(paymentMethodId, !isActive);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(
        isActive
          ? strings.paymentMethods.deactivateSuccess
          : strings.paymentMethods.activateSuccess
      );
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleToggle} disabled={isPending}>
      {isActive ? strings.paymentMethods.deactivateButton : strings.paymentMethods.activateButton}
    </Button>
  );
}

export function PaymentMethodDeleteButton({ paymentMethodId }: { paymentMethodId: string }) {
  return (
    <DeleteConfirmButton
      onDelete={() => deletePaymentMethod(paymentMethodId)}
      confirmTitle={strings.paymentMethods.deleteConfirmTitle}
      confirmHint={strings.paymentMethods.deleteConfirmHint}
      successMessage={strings.paymentMethods.deleteSuccess}
      buttonLabel={strings.paymentMethods.deleteButton}
    />
  );
}
