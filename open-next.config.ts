import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Minimal -- aplikasi ini tidak pakai ISR/fetch cache/route cache (semua
// Server Component dinamis, mutasi lewat revalidatePath), jadi belum perlu
// binding KV/R2/DO untuk incremental cache. Tambahkan kalau nanti ISR dipakai.
export default defineCloudflareConfig();
