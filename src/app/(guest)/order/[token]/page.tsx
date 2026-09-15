import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getGuestCatalog, resolveOutletToken } from "@/lib/order-guest";
import { SelfOrderScreen } from "./self-order-screen";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const resolved = await resolveOutletToken(token);
  if (!resolved) return { title: "Tidak ditemukan" };
  return {
    title: `Pesan di ${resolved.outlet.name}`,
    description: `Pesan langsung di ${resolved.outlet.name} tanpa perlu ke kasir`,
  };
}

export default async function OrderPage({ params }: Props) {
  const { token } = await params;

  const supabaseUrl = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  if (!supabaseUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL tidak diset");

  const resolved = await resolveOutletToken(token);
  if (!resolved) notFound();

  const catalog = await getGuestCatalog(
    resolved.businessId,
    resolved.outletId,
    resolved.outlet,
    supabaseUrl
  );

  return <SelfOrderScreen token={token} catalog={catalog} />;
}
