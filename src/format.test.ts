import { test, expect } from "bun:test";
import { secToHMS, secToH, secToMin, km, n, mps } from "./format.ts";

test("secToHMS shows H:MM:SS when over an hour, M:SS otherwise", () => {
  expect(secToHMS(3661)).toBe("1:01:01");
  expect(secToHMS(125)).toBe("2:05");
  expect(secToHMS(5)).toBe("0:05");
});

test("secToH and secToMin round sensibly", () => {
  expect(secToH(5400)).toBe("1.5h");
  expect(secToMin(150)).toBe("3 min"); // 2.5 → 3
});

test("km formats meters to 1-decimal kilometres, dash for null", () => {
  expect(km(5000)).toBe("5.0 km");
  expect(km(null)).toBe("—");
});

test("n rounds integers and respects a decimal count, dash for null", () => {
  expect(n(3.6)).toBe("4");
  expect(n(3.6, 1)).toBe("3.6");
  expect(n(null)).toBe("—");
});

test("mps converts m/s to min:sec per km pace", () => {
  // 1000 / 2.5 = 400s = 6:40 /km
  expect(mps(2.5)).toBe("6:40/km");
  expect(mps(0)).toBe("—");
  expect(mps(null)).toBe("—");
});
