import { test, expect } from "bun:test";
import {
  parseDuration,
  parseDistance,
  paceToMps,
  buildWorkout,
  toGarmin,
  withPlanMarker,
  validatePlan,
} from "./workout.ts";

const steps = (w: Record<string, unknown>) => (w.workoutSegments as any[])[0].workoutSteps as any[];

test("parseDuration handles m:ss, h:mm:ss and seconds", () => {
  expect(parseDuration("10:00")).toBe(600);
  expect(parseDuration("1:05:00")).toBe(3900);
  expect(parseDuration(90)).toBe(90);
  expect(() => parseDuration("ten")).toThrow();
});

test("parseDistance handles km, m and metres", () => {
  expect(parseDistance("5km")).toBe(5000);
  expect(parseDistance("1.5 km")).toBe(1500);
  expect(parseDistance("400m")).toBe(400);
  expect(parseDistance(800)).toBe(800);
  expect(() => parseDistance("5 miles")).toThrow();
});

test("paceToMps converts min/km to m/s", () => {
  expect(paceToMps("6:00")).toBe(2.7778);
  expect(paceToMps("5:00")).toBe(3.3333);
});

test("pace target puts the fast end in valueOne regardless of input order", () => {
  const w = buildWorkout({ name: "t", steps: [{ distance: "1km", pace: ["5:20", "5:00"] }] });
  const s = steps(w)[0];
  expect(s.targetType.workoutTargetTypeKey).toBe("pace.zone");
  expect(s.targetValueOne).toBe(3.3333);
  expect(s.targetValueTwo).toBe(3.125);
  expect(s.endCondition.conditionTypeKey).toBe("distance");
  expect(s.endConditionValue).toBe(1000);
});

test("hr primary with pace secondary, matching the race-plan shape", () => {
  const w = buildWorkout({ name: "t", steps: [{ distance: "5km", hr: [100, 150], pace: ["6:00", "6:20"] }] });
  const s = steps(w)[0];
  expect(s.targetType.workoutTargetTypeKey).toBe("heart.rate.zone");
  expect([s.targetValueOne, s.targetValueTwo]).toEqual([100, 150]);
  expect(s.secondaryTargetType.workoutTargetTypeKey).toBe("pace.zone");
  expect(s.secondaryTargetValueOne).toBe(2.7778);
});

test("primary flips which target drives alerts", () => {
  const w = buildWorkout({ name: "t", steps: [{ time: 600, hr: [120, 140], pace: ["6:00", "6:30"], primary: "pace" }] });
  const s = steps(w)[0];
  expect(s.targetType.workoutTargetTypeKey).toBe("pace.zone");
  expect(s.secondaryTargetType.workoutTargetTypeKey).toBe("heart.rate.zone");
});

test("hr zone, lap default and no target", () => {
  const w = buildWorkout({ name: "t", steps: [{ type: "warmup", hrZone: 2 }, { type: "cooldown" }] });
  const [a, b] = steps(w);
  expect(a.zoneNumber).toBe(2);
  expect(a.targetValueOne).toBeNull();
  expect(a.endCondition.conditionTypeKey).toBe("lap.button");
  expect(b.targetType.workoutTargetTypeKey).toBe("no.target");
  expect(b.secondaryTargetType).toBeUndefined();
});

test("repeat groups number steps in order", () => {
  const w = buildWorkout({
    name: "5x1k",
    steps: [
      { type: "warmup", time: "10:00" },
      { repeat: 5, steps: [{ distance: "1km" }, { type: "recovery", time: "2:00" }] },
      { type: "cooldown", time: "10:00" },
    ],
  });
  const [warm, group, cool] = steps(w);
  expect(warm.stepOrder).toBe(1);
  expect(group.type).toBe("RepeatGroupDTO");
  expect(group.numberOfIterations).toBe(5);
  expect(group.workoutSteps.map((s: any) => s.stepOrder)).toEqual([3, 4]);
  expect(group.stepOrder).toBe(2);
  expect(cool.stepOrder).toBe(5);
});

test("rejects ambiguous steps", () => {
  expect(() => buildWorkout({ name: "t", steps: [{ time: 60, distance: 100 }] })).toThrow();
  expect(() => buildWorkout({ name: "t", steps: [{ hr: [1, 2], pace: ["5:00", "6:00"], power: [1, 2] }] })).toThrow();
  expect(() => buildWorkout({ name: "t", steps: [{ hr: [1, 2], hrZone: 2 }] })).toThrow();
  expect(() => buildWorkout({ name: "t", sport: "darts", steps: [{ lap: true }] })).toThrow();
  expect(() => buildWorkout({ name: "t", steps: [] })).toThrow();
});

test("strength steps carry reps, exercise and weight", () => {
  const w = buildWorkout({
    name: "legs",
    sport: "strength_training",
    steps: [{ reps: 10, category: "SQUAT", exercise: "GOBLET_SQUAT", weightKg: 16 }],
  });
  const s = steps(w)[0];
  expect(w.sportType).toEqual({ sportTypeId: 5, sportTypeKey: "strength_training" });
  expect(s.endCondition.conditionTypeKey).toBe("reps");
  expect(s.category).toBe("SQUAT");
  expect(s.weightValue).toBe(16);
});

test("toGarmin passes raw Garmin JSON through untouched", () => {
  const raw = { workoutName: "x", workoutSegments: [] };
  expect(toGarmin(raw)).toBe(raw);
});

test("plan marker is appended to the description", () => {
  expect(withPlanMarker({ description: null }, "base").description).toBe("[cadence:base]");
  expect(withPlanMarker({ description: "easy" }, "base").description).toBe("easy\n\n[cadence:base]");
});

test("validatePlan requires ids and dates", () => {
  expect(() => validatePlan({ plan: "bad id", workouts: [] })).toThrow();
  expect(() => validatePlan({ plan: "p", workouts: [{ name: "a", date: "tomorrow", steps: [{ lap: true }] }] })).toThrow();
  expect(() => validatePlan({ plan: "p", workouts: [{ name: "a", date: "2026-10-20", steps: [{ lap: true }] }] })).not.toThrow();
});
