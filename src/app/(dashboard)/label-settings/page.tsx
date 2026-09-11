import { requirePermissionDb } from "@/lib/auth/permissions";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { getLabelSettingsWithDb } from "@/lib/labels/manage";
import { LabelSettingsForm } from "./label-settings-form";
import { id as strings } from "@/lib/i18n/id";

export default async function LabelSettingsPage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "settings.business");

  try {
    const settings = await getLabelSettingsWithDb(db, businessId);

    return (
      <div className="flex max-w-2xl flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">{strings.labelSettings.title}</h1>
          <p className="text-sm text-muted-foreground">{strings.labelSettings.subtitle}</p>
        </div>
        <LabelSettingsForm initialSettings={settings} />
      </div>
    );
  } finally {
    await closeDb();
  }
}
