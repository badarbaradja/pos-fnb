import { uuidv7 } from "uuidv7";

/**
 * Generate primary key UUID v7 (time-sortable). Dipakai di client untuk
 * orders, order_items, payments, shifts (syarat mode offline) — lihat
 * CLAUDE.md §3.4.
 */
export function generateId(): string {
  return uuidv7();
}
