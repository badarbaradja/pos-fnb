import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  /* config options here */
  // Cegah `next dev`/`next build` menulis blok "agent rules" ke CLAUDE.md —
  // file itu sudah dikelola manual dan tidak boleh diubah otomatis oleh tooling.
  agentRules: false,
};

export default nextConfig;

// Cuma aktif saat `next dev` -- bikin binding Cloudflare (env vars dari
// .dev.vars, dst.) tersedia di dev server lokal supaya perilakunya dekat
// dengan Workers produksi (T19).
initOpenNextCloudflareForDev();
