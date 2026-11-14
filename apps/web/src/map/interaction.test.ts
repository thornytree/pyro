import { describe, expect, it } from "vitest";
import { resolveClick } from "./interaction";

describe("resolveClick", () => {
  it("opens a state from the national view", () => {
    expect(resolveClick(null, "06")).toEqual({ kind: "open-state", fips: "06" });
  });
  it("loads a tile inside the open state", () => {
    expect(resolveClick("06", "06")).toEqual({ kind: "load-tile" });
  });
  it("switches to a neighbouring state", () => {
    expect(resolveClick("06", "32")).toEqual({ kind: "open-state", fips: "32" });
  });
  it("ignores clicks off any state", () => {
    expect(resolveClick(null, null)).toEqual({ kind: "none" });
    expect(resolveClick("06", null)).toEqual({ kind: "none" });
  });
});
