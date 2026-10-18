// Compact workout spec → Garmin Connect workout JSON (pure, no network).
//
// Spec shape:
//   {
//     "name": "Intervals 5x1k", "sport": "running", "description": "...",
//     "steps": [
//       { "type": "warmup", "time": "10:00", "hrZone": 2 },
//       { "repeat": 5, "steps": [
//         { "type": "interval", "distance": "1km", "pace": ["4:50", "5:00"] },
//         { "type": "recovery", "time": "2:00" }
//       ]},
//       { "type": "cooldown", "lap": true, "note": "easy jog home" }
//     ]
//   }
//
// End condition: time ("mm:ss", "h:mm:ss" or seconds), distance ("5km",
// "400m" or metres), reps (strength), or lap (default).
// Targets: hr [lo, hi] bpm, hrZone n, pace ["m:ss", "m:ss"] per km,
// power [lo, hi] W, cadence [lo, hi]. Up to two; "primary" picks which
// one drives alerts, otherwise the first in that order wins.

export interface StepSpec {
  type?: "warmup" | "cooldown" | "interval" | "recovery" | "rest" | "other";
  note?: string;
  time?: string | number;
  distance?: string | number;
  reps?: number;
  lap?: boolean;
  hr?: [number, number];
  hrZone?: number;
  pace?: [string, string];
  power?: [number, number];
  cadence?: [number, number];
  primary?: TargetKey;
  /** Strength: Garmin exercise category and name, e.g. "SQUAT", "GOBLET_SQUAT" */
  category?: string;
  exercise?: string;
  weightKg?: number;
}

export interface RepeatSpec {
  repeat: number;
  steps: StepSpec[];
}

export interface WorkoutSpec {
  name: string;
  sport?: string;
  description?: string;
  steps: (StepSpec | RepeatSpec)[];
}

type TargetKey = "hr" | "hrZone" | "pace" | "power" | "cadence";

const SPORTS: Record<string, number> = {
  running: 1,
  cycling: 2,
  other: 3,
  swimming: 4,
  strength_training: 5,
  cardio_training: 6,
  yoga: 7,
  pilates: 8,
  hiit: 9,
};

const STEP_TYPES: Record<string, number> = {
  warmup: 1,
  cooldown: 2,
  interval: 3,
  recovery: 4,
  rest: 5,
  repeat: 6,
  other: 7,
};

const END: Record<string, number> = {
  "lap.button": 1,
  time: 2,
  distance: 3,
  iterations: 7,
  reps: 10,
};

const TARGETS: Record<string, number> = {
  "no.target": 1,
  "power.zone": 2,
  "cadence.zone": 3,
  "heart.rate.zone": 4,
  "pace.zone": 6,
};

const TARGET_ORDER: TargetKey[] = ["hr", "hrZone", "pace", "power", "cadence"];

/** "1:05:00" | "10:00" | 600 → seconds */
export function parseDuration(v: string | number): number {
  if (typeof v === "number") return v;
  const parts = v.trim().split(":").map(Number);
  if (parts.length < 1 || parts.length > 3 || parts.some((p) => !Number.isFinite(p))) {
    throw new Error(`Bad duration "${v}" (use m:ss, h:mm:ss or seconds)`);
  }
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** "5km" | "400m" | "1.5 km" | 5000 → metres */
export function parseDistance(v: string | number): number {
  if (typeof v === "number") return v;
  const m = v.trim().toLowerCase().match(/^([\d.]+)\s*(km|m)?$/);
  if (!m) throw new Error(`Bad distance "${v}" (use 5km, 400m or metres)`);
  const n = parseFloat(m[1]!);
  return m[2] === "km" ? n * 1000 : n;
}

/** "5:00" per km → metres per second */
export function paceToMps(pace: string): number {
  const sec = parseDuration(pace);
  if (sec <= 0) throw new Error(`Bad pace "${pace}"`);
  return Math.round((1000 / sec) * 10000) / 10000;
}

function typeRef(key: string, id: number) {
  return { stepTypeId: id, stepTypeKey: key };
}

function sportRef(sport: string) {
  const id = SPORTS[sport];
  if (!id) throw new Error(`Unknown sport "${sport}" (one of: ${Object.keys(SPORTS).join(", ")})`);
  return { sportTypeId: id, sportTypeKey: sport };
}

function targetFields(step: StepSpec, key: TargetKey | undefined, prefix: "" | "secondary") {
  const p = (name: string) => (prefix ? prefix + name[0]!.toUpperCase() + name.slice(1) : name);
  const ref = (k: string) => ({ workoutTargetTypeId: TARGETS[k], workoutTargetTypeKey: k });
  const out: Record<string, unknown> = {};
  const set = (typeKey: string, one: number | null, two: number | null, zone: number | null) => {
    out[p("targetType")] = ref(typeKey);
    out[p("targetValueOne")] = one;
    out[p("targetValueTwo")] = two;
    out[prefix ? "secondaryZoneNumber" : "zoneNumber"] = zone;
  };

  switch (key) {
    case undefined:
      if (!prefix) set("no.target", null, null, null);
      break;
    case "hr": {
      const [lo, hi] = step.hr!;
      set("heart.rate.zone", lo, hi, null);
      break;
    }
    case "hrZone":
      set("heart.rate.zone", null, null, step.hrZone!);
      break;
    case "pace": {
      // Garmin wants speed: valueOne is the fast end, valueTwo the slow end.
      const speeds = step.pace!.map(paceToMps).sort((a, b) => b - a);
      set("pace.zone", speeds[0]!, speeds[1]!, null);
      break;
    }
    case "power": {
      const [lo, hi] = step.power!;
      set("power.zone", lo, hi, null);
      break;
    }
    case "cadence": {
      const [lo, hi] = step.cadence!;
      set("cadence.zone", lo, hi, null);
      break;
    }
  }
  return out;
}

function pickTargets(step: StepSpec): [TargetKey | undefined, TargetKey | undefined] {
  const present = TARGET_ORDER.filter((k) => step[k] !== undefined);
  if (present.length > 2) throw new Error(`Step has ${present.length} targets (${present.join(", ")}); max 2`);
  if (step.hr && step.hrZone !== undefined) throw new Error("Use hr or hrZone, not both");
  if (step.primary) {
    if (!present.includes(step.primary)) throw new Error(`primary "${step.primary}" has no value on the step`);
    return [step.primary, present.find((k) => k !== step.primary)];
  }
  return [present[0], present[1]];
}

function endFields(step: StepSpec) {
  const ends = [step.time, step.distance, step.reps, step.lap].filter((v) => v !== undefined && v !== false);
  if (ends.length > 1) throw new Error("Step has more than one end condition (time, distance, reps, lap)");
  const ref = (k: string) => ({ conditionTypeId: END[k], conditionTypeKey: k });
  if (step.time !== undefined) {
    return { endCondition: ref("time"), endConditionValue: parseDuration(step.time) };
  }
  if (step.distance !== undefined) {
    return {
      endCondition: ref("distance"),
      endConditionValue: parseDistance(step.distance),
      preferredEndConditionUnit: { unitKey: "kilometer" },
    };
  }
  if (step.reps !== undefined) {
    return { endCondition: ref("reps"), endConditionValue: step.reps };
  }
  return { endCondition: ref("lap.button"), endConditionValue: null };
}

function isRepeat(s: StepSpec | RepeatSpec): s is RepeatSpec {
  return (s as RepeatSpec).repeat !== undefined;
}

export function buildWorkout(spec: WorkoutSpec): Record<string, unknown> {
  if (!spec.name) throw new Error("Workout needs a name");
  if (!Array.isArray(spec.steps) || spec.steps.length === 0) throw new Error(`"${spec.name}" has no steps`);
  const sport = sportRef(spec.sport ?? "running");
  let order = 0;

  const executable = (step: StepSpec) => {
    const type = step.type ?? "interval";
    const typeId = STEP_TYPES[type];
    if (!typeId || typeId === STEP_TYPES.repeat) throw new Error(`Unknown step type "${type}"`);
    const [primary, secondary] = pickTargets(step);
    return {
      type: "ExecutableStepDTO",
      stepOrder: ++order,
      stepType: typeRef(type, typeId),
      description: step.note ?? null,
      ...endFields(step),
      ...targetFields(step, primary, ""),
      ...targetFields(step, secondary, "secondary"),
      ...(step.category ? { category: step.category, exerciseName: step.exercise ?? null } : {}),
      ...(step.weightKg !== undefined ? { weightValue: step.weightKg, weightUnit: { unitKey: "kilogram" } } : {}),
    };
  };

  const steps = spec.steps.map((s) => {
    if (!isRepeat(s)) return executable(s);
    if (!Number.isInteger(s.repeat) || s.repeat < 1) throw new Error(`Bad repeat count ${s.repeat}`);
    if (!s.steps?.length) throw new Error("Repeat group has no steps");
    const groupOrder = ++order;
    return {
      type: "RepeatGroupDTO",
      stepOrder: groupOrder,
      stepType: typeRef("repeat", STEP_TYPES.repeat!),
      numberOfIterations: s.repeat,
      smartRepeat: false,
      endCondition: { conditionTypeId: END.iterations, conditionTypeKey: "iterations" },
      endConditionValue: s.repeat,
      workoutSteps: s.steps.map((child) => {
        if (isRepeat(child as StepSpec | RepeatSpec)) throw new Error("Nested repeat groups are not supported");
        return executable(child);
      }),
    };
  });

  return {
    workoutName: spec.name,
    description: spec.description ?? null,
    sportType: sport,
    workoutSegments: [{ segmentOrder: 1, sportType: sport, workoutSteps: steps }],
  };
}

/** Accept either a compact spec or raw Garmin workout JSON. */
export function toGarmin(input: Record<string, unknown>): Record<string, unknown> {
  if ("workoutSegments" in input) return input;
  return buildWorkout(input as unknown as WorkoutSpec);
}

// ── Plans ─────────────────────────────────────────────────────────

export interface PlanSpec {
  plan: string;
  workouts: (WorkoutSpec & { date: string })[];
}

/** Description marker that ties a Garmin workout to the plan that created it. */
export function planMarker(plan: string): string {
  return `[cadence:${plan}]`;
}

export function withPlanMarker(workout: Record<string, unknown>, plan: string): Record<string, unknown> {
  const desc = (workout.description as string | null) ?? "";
  const marker = planMarker(plan);
  return { ...workout, description: desc ? `${desc}\n\n${marker}` : marker };
}

export function validatePlan(plan: PlanSpec): void {
  if (!plan.plan || !/^[\w.-]+$/.test(plan.plan)) throw new Error('Plan needs an id in "plan" (letters, digits, . _ -)');
  if (!Array.isArray(plan.workouts) || plan.workouts.length === 0) throw new Error("Plan has no workouts");
  for (const w of plan.workouts) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(w.date ?? "")) throw new Error(`"${w.name}" needs a date (YYYY-MM-DD)`);
    buildWorkout(w);
  }
}
