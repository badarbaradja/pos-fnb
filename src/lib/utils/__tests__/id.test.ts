import { describe, it, expect } from "vitest";
import { generateId } from "../id";

describe("generateId", () => {
  it("menghasilkan UUID v7 yang valid", () => {
    const id = generateId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("menghasilkan id yang berbeda tiap dipanggil", () => {
    const a = generateId();
    const b = generateId();
    expect(a).not.toBe(b);
  });

  it("id yang dibuat berurutan waktu bisa diurutkan secara leksikografis (UUID v7 sortable)", () => {
    const a = generateId();
    const b = generateId();
    expect(a < b).toBe(true);
  });
});
