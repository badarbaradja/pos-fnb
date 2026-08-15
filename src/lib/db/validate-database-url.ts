/**
 * Validasi bentuk DATABASE_URL SEBELUM koneksi dibuka -- ditambahkan
 * setelah insiden T19: password produksi mengandung "@" dan "]" yang
 * tidak di-URL-encode, membuat drizzle-kit/postgres.js salah mem-parsing
 * batas userinfo/host lalu mengirim kredensial yang salah ke Postgres --
 * muncul sebagai `28P01 password authentication failed`, pesan yang
 * MENYESATKAN (menunjuk ke "password salah", padahal penyebabnya parsing).
 *
 * CATATAN EMPIRIS: `new URL()` di Node TERNYATA cukup toleran -- "@"
 * berganda dan "]" liar TIDAK membuatnya throw, cuma di-percent-encode
 * diam-diam (diverifikasi manual sebelum menulis ini). Jadi pengecekan
 * `new URL()` sendirian TIDAK akan menangkap insiden yang sebenarnya
 * terjadi -- pengecekan jumlah "@" di bagian authority-lah yang
 * sesungguhnya menangkap kasus nyata ini. Keduanya tetap dipertahankan:
 * `new URL()` sebagai jaring pengaman untuk connection string yang rusak
 * dengan cara lain (skema hilang, host kosong, dst).
 */
export function assertValidDatabaseUrl(url: string): void {
  const hint =
    "password kemungkinan mengandung karakter khusus yang perlu di-URL-encode atau diganti";

  // Authority = bagian antara "skema://" dan "/"/"?"/"#" berikutnya --
  // seharusnya cuma ada SATU "@" di situ (pemisah userinfo dari host).
  // Lebih dari satu berarti password mengandung "@" yang tidak di-encode.
  const withoutScheme = url.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
  const authorityEnd = withoutScheme.search(/[/?#]/);
  const authority = authorityEnd === -1 ? withoutScheme : withoutScheme.slice(0, authorityEnd);
  const atCount = (authority.match(/@/g) ?? []).length;

  if (atCount > 1) {
    throw new Error(
      `DATABASE_URL punya ${atCount} tanda "@" di bagian user/host (seharusnya cuma 1) -- ${hint}.`
    );
  }

  try {
    new URL(url);
  } catch {
    throw new Error(`DATABASE_URL gagal di-parse sebagai URL -- ${hint}.`);
  }
}
