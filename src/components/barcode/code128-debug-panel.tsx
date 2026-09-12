import { debugEncodeCode128B } from "@/lib/barcode/code128";
import { id as strings } from "@/lib/i18n/id";

/**
 * components/barcode/code128-debug-panel.tsx — instruksi CEO 12 September
 * 2026, ronde kedua investigasi bug barcode salah baca. Dipakai TIGA
 * tempat: pratinjau /label-settings (data contoh) DAN kedua halaman cetak
 * sungguhan (/barang/[id]/label, /pos/thrift/label/[id]) -- yang terakhir
 * ini yang penting untuk pindai uji sungguhan, supaya CEO bisa
 * membandingkan STRING MENTAH yang benar-benar di-encode untuk barang
 * yang benar-benar dicetak, bukan cuma barang contoh.
 *
 * STRING MENTAH ditampilkan dalam kurung siku (spasi di tepi jadi
 * terlihat) DAN sebagai JSON.stringify (escape eksplisit untuk karakter
 * tak terlihat -- tab, newline, dll -- yang kurung siku saja tidak
 * mengungkap). Tabel per-simbol menampilkan charCode tiap karakter,
 * jadi karakter tersembunyi juga ketahuan dari situ.
 *
 * `print:hidden` di pemanggil (bukan di sini) -- panel ini tidak boleh
 * ikut tercetak di label fisik.
 */
export function Code128DebugPanel({ kode }: { kode: string }) {
  let debugInfo;
  try {
    debugInfo = debugEncodeCode128B(kode);
  } catch (err) {
    return (
      <p className="text-xs text-destructive">
        {err instanceof Error ? err.message : strings.common.unexpectedError}
      </p>
    );
  }

  return (
    <details className="w-full max-w-xs rounded-lg border p-2 text-xs">
      <summary className="cursor-pointer font-medium">{strings.labelSettings.debugTitle}</summary>
      <div className="mt-2 flex flex-col gap-2">
        <div>
          {strings.labelSettings.debugRawString}:{" "}
          <span className="font-mono">[{kode}]</span>
        </div>
        <div>
          {strings.labelSettings.debugRawStringEscaped}:{" "}
          <span className="font-mono">{JSON.stringify(kode)}</span>
        </div>
        <div>
          {strings.labelSettings.debugLength}: <span className="font-mono">{kode.length}</span>
        </div>
        <div>
          {strings.labelSettings.debugCodeSet}: <span className="font-mono">{debugInfo.codeSet}</span>
          {" · "}
          {strings.labelSettings.debugStartValue}: <span className="font-mono">{debugInfo.startValue}</span>
        </div>
        <table className="w-full border-collapse text-left font-mono text-[11px]">
          <thead>
            <tr className="border-b">
              <th className="pr-2">pos</th>
              <th className="pr-2">char</th>
              <th className="pr-2">code</th>
              <th className="pr-2">nilai</th>
            </tr>
          </thead>
          <tbody>
            {debugInfo.symbols.map((s) => (
              <tr key={s.position}>
                <td className="pr-2">{s.position}</td>
                <td className="pr-2">{s.char === " " ? "(spasi)" : s.char}</td>
                <td className="pr-2">{s.charCode}</td>
                <td className="pr-2">{s.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div>
          {strings.labelSettings.debugChecksum}:{" "}
          <span className="font-mono">{debugInfo.checksum}</span>
        </div>
        <div>
          {strings.labelSettings.debugStopValue}: <span className="font-mono">{debugInfo.stopValue}</span>
        </div>
      </div>
    </details>
  );
}
