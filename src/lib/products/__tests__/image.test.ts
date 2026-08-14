import { describe, expect, it } from "vitest";
import {
  PRODUCT_IMAGE_MAX_BYTES,
  getProductImagePath,
  validateProductImage,
} from "../image";

describe("validateProductImage", () => {
  it("lolos untuk tipe & ukuran valid", () => {
    expect(validateProductImage({ type: "image/jpeg", size: 100_000 })).toBeNull();
    expect(validateProductImage({ type: "image/png", size: PRODUCT_IMAGE_MAX_BYTES })).toBeNull();
    expect(validateProductImage({ type: "image/webp", size: 1 })).toBeNull();
  });

  it("ditolak untuk tipe file yang tidak diizinkan", () => {
    expect(validateProductImage({ type: "image/gif", size: 1000 })).toBeTruthy();
    expect(validateProductImage({ type: "application/pdf", size: 1000 })).toBeTruthy();
    expect(validateProductImage({ type: "", size: 1000 })).toBeTruthy();
  });

  it("ditolak kalau ukuran melebihi batas, walau tipenya valid", () => {
    expect(
      validateProductImage({ type: "image/jpeg", size: PRODUCT_IMAGE_MAX_BYTES + 1 })
    ).toBeTruthy();
  });
});

describe("getProductImagePath", () => {
  it("deterministik: businessId/productId.jpg", () => {
    expect(getProductImagePath("biz-1", "prod-1")).toBe("biz-1/prod-1.jpg");
  });

  it("path yang sama untuk input yang sama (upsert-friendly)", () => {
    const a = getProductImagePath("biz-1", "prod-1");
    const b = getProductImagePath("biz-1", "prod-1");
    expect(a).toBe(b);
  });
});
