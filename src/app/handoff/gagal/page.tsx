import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { id } from "@/lib/i18n/id";

/**
 * Halaman gagal handoff (lihat app/handoff/route.ts). SENGAJA cuma dua
 * pesan, keduanya generik -- jangan ditambah alasan lebih spesifik di sini
 * (mis. "email tidak terdaftar"), itu justru kebocoran yang mau dihindari.
 */
export default async function HandoffGagalPage({
  searchParams,
}: {
  searchParams: Promise<{ alasan?: string }>;
}) {
  const { alasan } = await searchParams;
  const belumDipetakan = alasan === "belum_dipetakan";

  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            {belumDipetakan ? id.handoff.notProvisionedTitle : id.handoff.tokenInvalidTitle}
          </CardTitle>
          <CardDescription>
            {belumDipetakan ? id.handoff.notProvisionedBody : id.handoff.tokenInvalidBody}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button render={<Link href="/login">{id.handoff.backToLogin}</Link>} />
        </CardContent>
      </Card>
    </div>
  );
}
