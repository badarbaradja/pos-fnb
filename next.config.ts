import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Cegah `next dev`/`next build` menulis blok "agent rules" ke CLAUDE.md —
  // file itu sudah dikelola manual dan tidak boleh diubah otomatis oleh tooling.
  agentRules: false,
};

export default nextConfig;
