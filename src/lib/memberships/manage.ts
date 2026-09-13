import { z } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { UserDbHandle } from "@/lib/db/client";
import { auditLogs, memberships, outlets, profiles } from "@/lib/db/schema";
import { assertRowsAffected } from "@/lib/db/errors";
import { generateId } from "@/lib/utils/id";
import { createSupabaseAdminClient } from "@/lib/auth/supabase";
import { assignableMembershipRoles } from "./roles";
import { id as strings } from "@/lib/i18n/id";

export { assignableMembershipRoles };

/**
 * lib/memberships/manage.ts — pembatasan akses per outlet, Tahap 0 (13
 * September 2026, docs/RENCANA-PEMBANGUNAN-KASIR-THRIFTING.md §14b).
 * Pola thin-wrapper sama lib/outlets/manage.ts/lib/employees/manage.ts.
 *
 * KENAPA createSupabaseAdminClient() DIPAKAI DI SINI (bukan cuma db user
 * lewat requirePermissionDb): profiles TIDAK PUNYA kolom email (satu-
 * satunya sumber email adalah auth.users, hanya terbaca lewat service
 * role — sama batasan yang membuat lib/auth/pin.ts memakainya untuk PIN
 * kasir). Dan profiles TIDAK PUNYA policy INSERT sama sekali (baris profil
 * selama ini SELALU dibuat lewat getAdminDb() di skrip bootstrap/seed,
 * tidak pernah lewat request user biasa) — membuat akun baru untuk
 * anggota yang diundang butuh jalan yang sama.
 *
 * INI TETAP BEDA dari getAdminDb(): admin client di sini HANYA menyentuh
 * Supabase Auth (cari/buat user by email) dan profiles (buat profil untuk
 * user baru) — GRANT akses sungguhan (baris memberships) SELALU ditulis
 * lewat db user (RLS beneran berlaku, lihat policy memberships_insert/
 * memberships_update baru di schema.ts). requirePermission("membership.
 * manage") sudah memastikan pemanggil owner SEBELUM baris ini pernah
 * dieksekusi — admin client bukan jalan pintas melewati izin, cuma
 * jalan teknis yang memang butuh service role.
 */

type Db = UserDbHandle["db"];

const outletIdsSchema = z.union([
  z.null(),
  z.array(z.string().uuid()).min(1, strings.team.outletsRequiredWhenScoped),
]);

const inviteMembershipSchema = z.object({
  email: z.string().trim().toLowerCase().email(strings.team.emailInvalid),
  fullName: z.string().trim().min(1, strings.common.requiredField),
  role: z.enum(assignableMembershipRoles),
  outletIds: outletIdsSchema,
});

const updateMembershipSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(assignableMembershipRoles),
  outletIds: outletIdsSchema,
  isActive: z.boolean(),
});

export type MembershipActionResult = {
  error?: string;
  success?: { membershipId: string; inviteLink?: string; inviteLinkGeneratedAt?: string };
};

export type MembershipRow = {
  id: string;
  userId: string;
  fullName: string;
  email: string | null;
  role: string;
  outletIds: string[] | null;
  isActive: boolean;
};

export type MembershipListResult = {
  rows: MembershipRow[];
  // true kalau auth.users di project ini SUDAH/HAMPIR melebihi perPage --
  // lihat catatan listUsers({perPage:1000}) di bawah. Kalau true, sebagian
  // email (atau bahkan sebagian anggota kalau suatu saat listUsers dipakai
  // untuk lebih dari email) BISA hilang diam-diam dari halaman ini --
  // halaman WAJIB menampilkan peringatan eksplisit, bukan gagal senyap
  // (keputusan CEO 13 September 2026).
  emailListTruncated: boolean;
};

/**
 * listMembershipsWithDb() — daftar anggota bisnis ini. Email diambil
 * terpisah lewat admin.auth.admin.listUsers() (lihat catatan file di
 * atas soal kenapa) — perPage 1000 sama seperti scripts/bootstrap-
 * production.ts, cukup untuk ukuran bisnis saat ini (26 orang, 13
 * September 2026). `data.total` (dikembalikan Supabase, BUKAN cuma
 * `users.length`) dipakai untuk mendeteksi truncation dengan benar --
 * `users.length === perPage` saja salah kalau total PERSIS 1000.
 */
export async function listMembershipsWithDb(db: Db, businessId: string): Promise<MembershipListResult> {
  const rows = await db
    .select({
      id: memberships.id,
      userId: memberships.userId,
      fullName: profiles.fullName,
      role: memberships.role,
      outletIds: memberships.outletIds,
      isActive: memberships.isActive,
    })
    .from(memberships)
    .innerJoin(profiles, eq(profiles.id, memberships.userId))
    .where(eq(memberships.businessId, businessId))
    .orderBy(asc(profiles.fullName));

  if (rows.length === 0) {
    return { rows: [], emailListTruncated: false };
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const emailByUserId = new Map<string, string>();
  let emailListTruncated = false;
  if (!error) {
    for (const u of data.users) {
      if (u.email) {
        emailByUserId.set(u.id, u.email);
      }
    }
    emailListTruncated = data.total > data.users.length;
  }

  return {
    rows: rows.map((r) => ({ ...r, email: emailByUserId.get(r.userId) ?? null })),
    emailListTruncated,
  };
}

async function validateOutletIds(
  db: Db,
  businessId: string,
  outletIds: string[]
): Promise<string | undefined> {
  const rows = await db
    .select({ id: outlets.id })
    .from(outlets)
    .where(and(inArray(outlets.id, outletIds), eq(outlets.businessId, businessId)));
  return rows.length === outletIds.length ? undefined : strings.team.outletNotFound;
}

/**
 * Cari user Supabase Auth berdasarkan email. Kalau belum ada, buat lewat
 * admin.generateLink(type: "invite") -- dipilih dibanding admin.
 * inviteUserByEmail() atau admin.createUser()+password karena TIDAK
 * bergantung SMTP terkonfigurasi (inviteUserByEmail mengirim email lewat
 * Supabase, gagal kalau provider email belum diset) DAN tidak pernah
 * membuat password yang harus ditampilkan (masalah yang sama persis
 * dihindari scripts/bootstrap-production.ts untuk password owner).
 * action_link hasil generateLink dikembalikan APA ADANYA ke pemanggil
 * (ditampilkan SEKALI di UI, TIDAK PERNAH ditulis ke audit_logs -- itu
 * bearer token, menyimpannya sama saja menyimpan kredensial).
 *
 * generatedAt dikembalikan supaya UI bisa tampilkan "dibuat jam X" --
 * Supabase TIDAK mengembalikan waktu kedaluwarsa link lewat API generate-
 * Link sama sekali (dicek langsung ke tipe GenerateLinkProperties, tidak
 * ada field expires_at). Default project Supabase adalah 24 jam sejak
 * dibuat, bisa diubah admin lewat Authentication > Email > "Email OTP
 * expiration" -- daripada menampilkan angka pasti yang BISA salah untuk
 * project ini, UI menampilkan waktu dibuat + asumsi default (jelas
 * dilabeli sebagai default, bukan fakta pasti project ini).
 */
async function findOrInviteAuthUser(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  email: string
): Promise<{ userId: string; inviteLink?: string; inviteLinkGeneratedAt?: string }> {
  const { data: listData, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) {
    throw listError;
  }
  const existing = listData.users.find((u) => u.email?.toLowerCase() === email);
  if (existing) {
    return { userId: existing.id };
  }

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "invite",
    email,
  });
  if (linkError || !linkData.user) {
    throw linkError ?? new Error("Gagal membuat akun undangan");
  }
  return {
    userId: linkData.user.id,
    inviteLink: linkData.properties.action_link,
    inviteLinkGeneratedAt: new Date().toISOString(),
  };
}

async function ensureProfile(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  fullName: string
): Promise<void> {
  const { data: existing } = await admin.from("profiles").select("id").eq("id", userId).maybeSingle();
  if (!existing) {
    await admin.from("profiles").insert({ id: userId, full_name: fullName });
  }
}

async function writeMembershipAuditLog(
  db: Db,
  params: {
    businessId: string;
    actorUserId: string;
    membershipId: string;
    action: "membership_invited" | "membership_updated" | "membership_reactivated";
    targetEmail: string | null;
    // true kalau langkah ini SUNGGUHAN memicu admin.generateLink (akun
    // Supabase Auth baru dibuat) -- false kalau emailnya sudah jadi user
    // terdaftar sebelumnya (tidak ada undangan baru yang dibuat, cuma
    // baris membership yang berubah). CEO 13 September 2026: audit log
    // wajib catat BAHWA undangan dibuat, siapa-ke-siapa-kapan -- TANPA
    // tautannya sendiri (bearer token, lihat findOrInviteAuthUser).
    inviteLinkGenerated: boolean;
    before: { role: string; outletIds: string[] | null; isActive?: boolean } | null;
    after: { role: string; outletIds: string[] | null; isActive?: boolean };
  }
): Promise<void> {
  await db.insert(auditLogs).values({
    id: generateId(),
    businessId: params.businessId,
    outletId: null,
    employeeId: null,
    action: params.action,
    refType: "membership",
    refId: params.membershipId,
    reason: null,
    metadata: {
      actorUserId: params.actorUserId,
      targetEmail: params.targetEmail,
      inviteLinkGenerated: params.inviteLinkGenerated,
      before: params.before,
      after: params.after,
    },
  });
}

/**
 * inviteMembershipWithDb() — tambah anggota baru (atau aktifkan ulang
 * kalau email ini sudah pernah jadi anggota bisnis ini sebelumnya, lihat
 * catatan di bawah). role WAJIB dari assignableMembershipRoles -- owner/
 * accountant tidak pernah bisa diberikan lewat sini (skema zod menolak
 * sebelum sampai ke database sama sekali, keputusan CEO 13 September
 * 2026).
 */
export async function inviteMembershipWithDb(
  db: Db,
  businessId: string,
  actorUserId: string,
  rawInput: unknown
): Promise<MembershipActionResult> {
  const parsed = inviteMembershipSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const data = parsed.data;

  if (data.outletIds) {
    const outletError = await validateOutletIds(db, businessId, data.outletIds);
    if (outletError) {
      return { error: outletError };
    }
  }

  const admin = createSupabaseAdminClient();
  let authUser: { userId: string; inviteLink?: string; inviteLinkGeneratedAt?: string };
  try {
    authUser = await findOrInviteAuthUser(admin, data.email);
    await ensureProfile(admin, authUser.userId, data.fullName);
  } catch {
    return { error: strings.team.inviteFailed };
  }

  const [existingMembership] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.businessId, businessId), eq(memberships.userId, authUser.userId)));

  if (existingMembership) {
    if (existingMembership.role === "owner" || existingMembership.role === "accountant") {
      return { error: strings.team.cannotManageOwnerAccountant };
    }
    const before = { role: existingMembership.role, outletIds: existingMembership.outletIds };
    const updated = await db
      .update(memberships)
      .set({ role: data.role, outletIds: data.outletIds, isActive: true })
      .where(eq(memberships.id, existingMembership.id))
      .returning({ id: memberships.id });
    assertRowsAffected(updated, "membership");

    await writeMembershipAuditLog(db, {
      businessId,
      actorUserId,
      membershipId: existingMembership.id,
      action: "membership_reactivated",
      targetEmail: data.email,
      inviteLinkGenerated: Boolean(authUser.inviteLink),
      before,
      after: { role: data.role, outletIds: data.outletIds },
    });
    return {
      success: {
        membershipId: existingMembership.id,
        inviteLink: authUser.inviteLink,
        inviteLinkGeneratedAt: authUser.inviteLinkGeneratedAt,
      },
    };
  }

  const membershipId = generateId();
  await db.insert(memberships).values({
    id: membershipId,
    businessId,
    userId: authUser.userId,
    role: data.role,
    outletIds: data.outletIds,
    isActive: true,
  });

  await writeMembershipAuditLog(db, {
    businessId,
    actorUserId,
    membershipId,
    action: "membership_invited",
    targetEmail: data.email,
    inviteLinkGenerated: Boolean(authUser.inviteLink),
    before: null,
    after: { role: data.role, outletIds: data.outletIds },
  });

  return {
    success: {
      membershipId,
      inviteLink: authUser.inviteLink,
      inviteLinkGeneratedAt: authUser.inviteLinkGeneratedAt,
    },
  };
}

/**
 * updateMembershipWithDb() — ubah role/outlet_ids/status anggota yang
 * SUDAH ada. Dua pengaman TAMBAHAN di luar permintaan eksplisit CEO
 * (dicatat di sini supaya jelas ini keputusan desain, bukan aturan yang
 * diminta -- boleh dicabut kalau CEO tidak mau):
 * 1. Tidak bisa mengubah baris milik diri sendiri lewat halaman ini --
 *    mencegah owner tidak sengaja mengunci diri sendiri (menonaktifkan
 *    diri, atau -- kalau suatu saat assignableMembershipRoles berubah --
 *    menurunkan role sendiri).
 * 2. Baris dengan role owner/accountant SAAT INI tidak bisa diubah lewat
 *    sini sama sekali (bukan cuma role barunya yang dibatasi) -- baris
 *    itu dikelola di luar halaman ini (scripts/bootstrap-production.ts).
 */
export async function updateMembershipWithDb(
  db: Db,
  businessId: string,
  actorUserId: string,
  rawInput: unknown
): Promise<MembershipActionResult> {
  const parsed = updateMembershipSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const data = parsed.data;

  const [current] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.id, data.id), eq(memberships.businessId, businessId)));
  if (!current) {
    return { error: strings.common.unexpectedError };
  }

  if (current.userId === actorUserId) {
    return { error: strings.team.cannotEditSelf };
  }
  if (current.role === "owner" || current.role === "accountant") {
    return { error: strings.team.cannotManageOwnerAccountant };
  }

  if (data.outletIds) {
    const outletError = await validateOutletIds(db, businessId, data.outletIds);
    if (outletError) {
      return { error: outletError };
    }
  }

  const updated = await db
    .update(memberships)
    .set({ role: data.role, outletIds: data.outletIds, isActive: data.isActive })
    .where(and(eq(memberships.id, data.id), eq(memberships.businessId, businessId)))
    .returning({ id: memberships.id });
  assertRowsAffected(updated, "membership");

  await writeMembershipAuditLog(db, {
    businessId,
    actorUserId,
    membershipId: data.id,
    action: "membership_updated",
    targetEmail: null,
    inviteLinkGenerated: false,
    before: { role: current.role, outletIds: current.outletIds, isActive: current.isActive },
    after: { role: data.role, outletIds: data.outletIds, isActive: data.isActive },
  });

  return { success: { membershipId: data.id } };
}
