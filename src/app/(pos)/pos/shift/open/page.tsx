import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { businesses } from "@/lib/db/schema";
import { checkShiftSellability, getOpenShiftForDevice } from "@/lib/pos/shift";
import { getPairedDevice } from "@/lib/pos/device-pairing";
import { OpenShiftForm } from "@/components/pos/shift/open-shift-form";
import { id as strings } from "@/lib/i18n/id";

export default async function OpenShiftPage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "shift.open_close"
  );

  try {
    // T22e -- outlet+device tablet ini WAJIB sudah ter-pairing, bukan
    // ditebak (dulu di sini ada duplikat resolusi "outlet aktif pertama"
    // yang sama dengan get-pos-catalog.ts -- sekarang satu sumber
    // kebenaran, lib/pos/device-pairing.ts).
    const paired = await getPairedDevice(db, businessId);
    if (!paired) {
      redirect("/pos/setup");
    }
    const { outlet, device } = paired;

    const [business] = await db
      .select({ timezone: businesses.timezone })
      .from(businesses)
      .where(eq(businesses.id, businessId));
    const businessTimezone = business?.timezone ?? "Asia/Jakarta";

    const existing = await getOpenShiftForDevice(db, businessId, device.id);
    const existingIssue = existing
      ? checkShiftSellability(existing, businessTimezone, outlet.dayCutoffTime)
      : "no_shift";
    if (existingIssue === null) {
      redirect("/pos");
    }
    if (existingIssue === "closing_in_progress") {
      redirect("/pos/shift/close");
    }
    // existingIssue === "stale" -> JANGAN redirect ke /pos/shift/close --
    // itu untuk shift MILIK SENDIRI yang sedang mid-close, sementara shift
    // basi ini bisa saja bukan milik orang yang berdiri di depan perangkat
    // sekarang. Tetap di halaman ini (sudah pas), cuma tampilkan alasannya
    // (§14 prasyarat shift, 13 September 2026) -- shift lama itu sendiri
    // TIDAK disentuh di sini, menunggu manajer menutupnya lewat fitur
    // force-close.
    const isStale = existingIssue === "stale";

    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-4">
        <div className="flex w-full max-w-sm flex-col gap-1">
          <h1 className="text-lg font-semibold">{strings.shift.openTitle}</h1>
          <p className="text-xs text-muted-foreground">
            {strings.pos.outletDeviceLabel
              .replace("{outlet}", outlet.name)
              .replace("{device}", device.name)}
          </p>
          {isStale ? (
            <p className="text-sm font-medium text-destructive">{strings.shift.staleShiftHint}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{strings.shift.openHint}</p>
          )}
        </div>
        <OpenShiftForm outletId={outlet.id} deviceId={device.id} cashEnabled={outlet.cashEnabled} />
      </div>
    );
  } finally {
    await closeDb();
  }
}
