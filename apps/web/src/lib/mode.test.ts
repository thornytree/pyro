import { describe, expect, it } from "vitest";
import {
  clampHistoryDate,
  HISTORY_START,
  historyEnd,
  isIsoDate,
  LIVE,
  modeFromSearch,
  modeLabel,
  modeToSearch,
  referenceTime,
  sameMode,
  shiftDate,
} from "./mode";

const now = new Date("2026-11-14T12:00:00Z");

describe("isIsoDate", () => {
  it("accepts real days and rejects the rest", () => {
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2023-02-29")).toBe(false);
    expect(isIsoDate("2024-13-01")).toBe(false);
    expect(isIsoDate("2024-8-1")).toBe(false);
    expect(isIsoDate("yesterday")).toBe(false);
  });
});

describe("history range", () => {
  it("ends yesterday (UTC) and clamps to the archive", () => {
    expect(historyEnd(now)).toBe("2026-11-13");
    expect(clampHistoryDate("1999-01-01", now)).toBe(HISTORY_START);
    expect(clampHistoryDate("2026-11-14", now)).toBe("2026-11-13");
    expect(clampHistoryDate("2021-07-04", now)).toBe("2021-07-04");
  });
});

describe("URL round trip", () => {
  it("defaults to live", () => {
    expect(modeFromSearch("", now)).toEqual(LIVE);
    expect(modeFromSearch("?mode=bogus&date=2020-01-01", now)).toEqual(LIVE);
  });

  it("reads a historical date and repairs bad ones", () => {
    expect(modeFromSearch("?mode=historical&date=2021-08-20", now)).toEqual({
      kind: "historical",
      date: "2021-08-20",
    });
    expect(modeFromSearch("?mode=historical&date=nope", now)).toEqual({
      kind: "historical",
      date: "2026-11-13",
    });
    expect(modeFromSearch("?mode=historical&date=2030-01-01", now)).toEqual({
      kind: "historical",
      date: "2026-11-13",
    });
  });

  it("writes the mode and keeps other parameters", () => {
    const historical = { kind: "historical", date: "2021-08-20" } as const;
    expect(modeToSearch(historical, "?tile=r1c2")).toBe(
      "?tile=r1c2&mode=historical&date=2021-08-20",
    );
    expect(modeToSearch(LIVE, "?mode=historical&date=2021-08-20&tile=r1c2")).toBe("?tile=r1c2");
    expect(modeToSearch(LIVE, "?mode=historical&date=2021-08-20")).toBe("");
    expect(modeFromSearch(modeToSearch(historical, ""), now)).toEqual(historical);
  });
});

describe("referenceTime", () => {
  it("is now when live and the end of the day when historical", () => {
    expect(referenceTime(LIVE, now)).toBe(now);
    expect(referenceTime({ kind: "historical", date: "2021-08-20" }, now).toISOString()).toBe(
      "2021-08-20T23:59:59.000Z",
    );
  });
});

describe("sameMode / modeLabel", () => {
  it("compares kind and date", () => {
    expect(sameMode(LIVE, { kind: "live" })).toBe(true);
    expect(sameMode(LIVE, { kind: "historical", date: "2021-08-20" })).toBe(false);
    expect(
      sameMode({ kind: "historical", date: "2021-08-20" }, { kind: "historical", date: "2021-08-21" }),
    ).toBe(false);
  });

  it("labels each mode", () => {
    expect(modeLabel(LIVE)).toBe("Live / predictive");
    expect(modeLabel({ kind: "historical", date: "2021-08-20" })).toBe("Historical: Aug 20, 2021");
  });
});

describe("shiftDate", () => {
  it("steps by days across month ends and stops at the archive edges", () => {
    expect(shiftDate("2024-02-28", 1, now)).toBe("2024-02-29");
    expect(shiftDate("2024-03-01", -1, now)).toBe("2024-02-29");
    expect(shiftDate("2026-11-13", 1, now)).toBe("2026-11-13");
    expect(shiftDate(HISTORY_START, -1, now)).toBe(HISTORY_START);
  });
});
