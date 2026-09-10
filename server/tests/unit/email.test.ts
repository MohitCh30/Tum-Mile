import { describe, it, expect } from "vitest";
import { normaliseEmail, canonicalEmail } from "../../src/lib/email.js";

describe("collapsing aliases of one inbox", () => {
  it("ignores dots and tags on Gmail", () => {
    const forms = [
      "mohit@gmail.com",
      "Mohit@Gmail.com",
      "m.o.h.i.t@gmail.com",
      "mohit+tummile@gmail.com",
      "m.ohit+3@googlemail.com",
      "  mohit@gmail.com  ",
    ];
    const keys = new Set(forms.map((f) => canonicalEmail(f)));
    expect(keys).toEqual(new Set(["mohit@gmail.com"]));
  });

  it("strips tags elsewhere but keeps dots, which are significant there", () => {
    expect(canonicalEmail("first.last+news@outlook.com")).toBe("first.last@outlook.com");
    expect(canonicalEmail("first.last@proton.me")).toBe("first.last@proton.me");
    // Dots matter outside Gmail: these are genuinely two different people.
    expect(canonicalEmail("firstlast@outlook.com")).not.toBe(
      canonicalEmail("first.last@outlook.com")
    );
  });

  it("folds provider domains onto one name", () => {
    expect(canonicalEmail("a@googlemail.com")).toBe("a@gmail.com");
    expect(canonicalEmail("a@hotmail.com")).toBe("a@outlook.com");
    expect(canonicalEmail("a@protonmail.com")).toBe("a@proton.me");
  });

  it("leaves unknown providers exactly as they are", () => {
    // No assumptions about a college domain's aliasing rules.
    expect(canonicalEmail("mohit.c@msit.edu.in")).toBe("mohit.c@msit.edu.in");
    expect(canonicalEmail("mohit.c+x@msit.edu.in")).toBe("mohit.c+x@msit.edu.in");
  });

  it("keeps what was typed, for delivery", () => {
    const result = normaliseEmail("M.o.hit+tag@Gmail.com")!;
    expect(result.address).toBe("m.o.hit+tag@gmail.com");
    expect(result.canonical).toBe("mohit@gmail.com");
  });

  it("refuses nonsense", () => {
    for (const bad of ["", "  ", "no-at-sign", "@gmail.com", "a@", "a@b", "+tag@gmail.com"]) {
      expect(canonicalEmail(bad)).toBeNull();
    }
  });
});

describe("throwaway inboxes", () => {
  it("recognises the common ones", () => {
    for (const domain of ["mailinator.com", "yopmail.com", "10minutemail.com", "temp-mail.org"]) {
      expect(normaliseEmail(`someone@${domain}`)?.disposable).toBe(true);
    }
  });

  it("does not flag real providers", () => {
    for (const domain of ["gmail.com", "outlook.com", "proton.me", "msit.edu.in"]) {
      expect(normaliseEmail(`someone@${domain}`)?.disposable).toBe(false);
    }
  });
});
