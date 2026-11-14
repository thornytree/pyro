import { describe, expect, it } from "vitest";
import { resolveClick, resolveZoom } from "./interaction";

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

describe("resolveZoom", () => {
  it("focuses a state once zoomed in past the national framing", () => {
    expect(resolveZoom(3.5, 3, null)).toEqual({ kind: "none" });
    expect(resolveZoom(4, 3, null)).toEqual({ kind: "focus" });
  });
  it("keeps the open state while near its framing", () => {
    expect(resolveZoom(6, 3, 6)).toEqual({ kind: "none" });
    expect(resolveZoom(9, 3, 6)).toEqual({ kind: "none" });
    expect(resolveZoom(5.5, 3, 6)).toEqual({ kind: "none" });
  });
  it("unfocuses once zoomed well out of the open state", () => {
    expect(resolveZoom(5, 3, 6)).toEqual({ kind: "unfocus" });
  });
});
