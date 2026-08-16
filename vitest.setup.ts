import dns from "node:dns";

/**
 * "TypeError: fetch failed" muncul sporadis di test yang memanggil Supabase
 * HTTP API (auth.admin.createUser, storage, dst.) -- BUKAN di query Postgres
 * langsung (getAdminDb/getUserDb tidak lewat fetch sama sekali). Ini gejala
 * klasik Node lebih memilih hasil resolusi IPv6 dulu (Happy Eyeballs), dan
 * kalau jalur IPv6 di jaringan/mesin ini lambat atau macet, percobaan
 * pertama gagal/timeout sebelum sempat fallback ke IPv4 -- lihat isu Node
 * yang sama di banyak proyek Next.js/Supabase di Windows. Paksa IPv4 dulu
 * supaya resolusi DNS tidak pernah menunggu IPv6 yang bermasalah.
 */
dns.setDefaultResultOrder("ipv4first");
