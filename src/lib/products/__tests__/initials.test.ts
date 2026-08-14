import { describe, expect, it } from "vitest";
import { getProductAvatarColors, getProductInitials } from "../initials";

describe("getProductInitials", () => {
  it("dua kata -> huruf pertama tiap kata", () => {
    expect(getProductInitials("Nasi Goreng")).toBe("NG");
  });

  it("satu kata -> dua huruf pertama", () => {
    expect(getProductInitials("Espresso")).toBe("ES");
  });

  it("string kosong -> fallback '?'", () => {
    expect(getProductInitials("   ")).toBe("?");
  });
});

describe("getProductAvatarColors", () => {
  it("deterministik untuk nama yang sama", () => {
    expect(getProductAvatarColors("Espresso")).toEqual(getProductAvatarColors("Espresso"));
  });

  it("beda nama biasanya beda warna", () => {
    expect(getProductAvatarColors("Espresso")).not.toEqual(getProductAvatarColors("Nasi Goreng"));
  });
});
