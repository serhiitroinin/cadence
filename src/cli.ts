#!/usr/bin/env bun
import { Command } from "commander";
import { getSecret, hasSecret, deleteSecret } from "./lib/keychain.ts";
import * as out from "./lib/output.ts";
import { login, importTokens } from "./auth.ts";
import { importFromLuff } from "./lib/import-luff.ts";
import { garminProvider } from "./providers/garmin.ts";
import type { FitnessProvider } from "./types.ts";

const provider: FitnessProvider = garminProvider;

// ── Formatting helpers ───────────────────────────────────────────

function secToH(s: number): string {
  const h = Math.round((s / 3600) * 10) / 10;
  return `${h}h`;
}

function secToMin(s: number): string {
  return `${Math.round(s / 60)} min`;
}

function secToHMS(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function km(meters: number | null): string {
  if (meters == null) return "\u2014";
  return `${(meters / 1000).toFixed(1)} km`;
}

function n(v: number | null, decimals = 0): string {
  if (v == null) return "\u2014";
  return decimals > 0 ? v.toFixed(decimals) : String(Math.round(v));
}

function mps(speed: number | null): string {
  if (speed == null) return "\u2014";
  // m/s → min/km pace
  if (speed <= 0) return "\u2014";
  const paceSeconds = 1000 / speed;
  const m = Math.floor(paceSeconds / 60);
  const s = Math.floor(paceSeconds % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

// ── Program ──────────────────────────────────────────────────────

const program = new Command();
program
  .name("cadence")
  .description("Garmin Connect data CLI — training, sleep, HRV, body battery, activities")
  .version("0.2.0")
  .addHelpText("after", `
OVERVIEW
  Fetches health and fitness data live from the Garmin Connect API.
  All credentials are stored in macOS Keychain (service: cadence).
  All data commands accept an optional [days] argument (default: 7).
  Output is formatted tables to stdout; use 'json' for raw API data.

COMMAND CATEGORIES
  Auth:
    login <email> <pw>     Full SSO login (OAuth1 → SSO → OAuth2)
    import-tokens [dir]    One-time migration from garth/garmy tokens
    status                 Check token validity and expiry
    logout                 Remove all credentials from Keychain

  Core Health (default 7 days):
    overview [days]        Full dashboard — all metrics in one view
    training-readiness|tr  Readiness score + 5 contributing factors
    sleep                  Sleep score, stages, duration
    heart-rate|hr          Resting HR, min, max, 7-day average
    hrv                    Heart rate variability + baseline + status
    stress                 Average/max stress + qualifier
    body-battery|bb        Energy level: charge, drain, high, low, wake
    steps                  Steps, distance, goal, floors
    activities             Recent workouts with HR, calories, AE/AnE
    daily                  Combined daily summary (steps + HR + stress + BB)

  Advanced Metrics:
    vo2max [days]          VO2 Max running/cycling (default: 30 days)
    spo2 [days]            Blood oxygen levels
    respiration|resp       Breathing rates (waking + sleeping)
    training-status|ts     Training status, load focus, ACWR
    race-predictions|rp    Predicted race times (5K, 10K, half, marathon)
    weight [days]          Body weight + composition (default: 30 days)
    fitness-age|fa         Fitness age vs chronological age
    intensity|im           Moderate + vigorous activity minutes
    endurance|es           Endurance score + classification

  Activity Drill-Down:
    activity <id>          Full detail: splits, HR zones, pace, power, temp
    records|prs            Personal records (fastest times, farthest distances)
    gear                   Equipment tracking (shoes, etc.)

  Raw API:
    json <path> [k=v ...]  Raw JSON from any Garmin Connect API endpoint

METRIC QUICK REFERENCE
  Training Readiness (0–100):
    75–100  HIGH/PRIME  — Body ready, push hard
    50–74   MODERATE    — Normal training OK
    25–49   LOW         — Reduce intensity, focus recovery
    0–24    POOR        — Rest day recommended
    Factors (each 0–100): sleep, hrv, recovery, load, stress

  Body Battery (0–100):
    75–100  High energy  — Demanding tasks and workouts OK
    50–74   Moderate     — Normal activity
    25–49   Low          — Lighter activity recommended
    0–24    Very low     — Rest needed

  Stress (0–100):
    0–25    Rest         — Low/no stress
    26–50   Low          — Manageable stress
    51–75   Medium       — Elevated stress
    76–100  High         — Very high stress

  Training Status:
    PEAKING         — Ideal race form
    PRODUCTIVE      — Fitness improving
    MAINTAINING     — Fitness stable
    RECOVERY        — Light load, recovering
    UNPRODUCTIVE    — Load not improving fitness
    DETRAINING      — Load too low, fitness declining
    OVERREACHING    — Load too high, overtraining risk

  ACWR (Acute:Chronic Workload Ratio):
    < 0.8   Undertraining  — Detraining risk
    0.8–1.3 Sweet spot     — Optimal load balance
    > 1.5   Danger zone    — Overreaching risk

  HRV Status:
    BALANCED        — Normal variability
    UNBALANCED      — Below typical range
    LOW             — Significantly below baseline

  VO2 Max (ml/kg/min) — higher is better:
    < 30    Low
    30–39   Fair
    40–49   Good
    50–59   Excellent
    60+     Elite

  Sleep Score (0–100):
    80–100  Excellent
    60–79   Good
    40–59   Fair
    0–39    Poor

  Aerobic Training Effect (AE) 0.0–5.0:
    0.0–0.9  None
    1.0–1.9  Minor
    2.0–2.9  Maintaining
    3.0–3.9  Improving
    4.0–4.9  Highly improving
    5.0      Overreaching

  Anaerobic Training Effect (AnE) 0.0–5.0:
    Same scale as AE but for anaerobic capacity

EXAMPLES
  cadence tr                   Last 7 days training readiness
  cadence tr 1                 Today's readiness only
  cadence bb 14                Two weeks of body battery
  cadence overview             Full 7-day dashboard
  cadence activities 30        Last 30 days of workouts
  cadence activity 18765432    Full detail + splits + HR zones for activity
  cadence vo2max 90            VO2 Max trend over 90 days
  cadence weight 60            Weight history over 60 days
  cadence ts 14                Training status + ACWR over 2 weeks
  cadence json /fitnessstats   Raw JSON from any API path`);

// ── Auth commands ────────────────────────────────────────────────

program
  .command("login <email> <password>")
  .description("Login to Garmin Connect via SSO + OAuth token exchange")
  .addHelpText("after", `
Details:
  Performs full Garmin authentication: OAuth1 HMAC-SHA1 signing → SSO login
  with email/password → OAuth2 token exchange. All tokens are stored in
  macOS Keychain (service: cadence). OAuth1 tokens last ~1 year;
  OAuth2 access tokens ~24h (auto-refreshed on each API call).

Example:
  cadence login user@example.com MyPassword123`)
  .action(async (email: string, password: string) => {
    await login(email, password);
  });

program
  .command("import-tokens [dir]")
  .description("Import tokens from a garth/garmy directory (default: ~/.garmy)")
  .addHelpText("after", `
Details:
  One-time migration helper. Reads OAuth1 and OAuth2 tokens from an
  existing garth or garmy installation directory and saves them to
  macOS Keychain. After import, the garth/garmy directory is no longer needed.

  Looks for files: oauth1_token.json, oauth2_token.json in the directory.

Example:
  cadence import-tokens              Import from ~/.garmy (default)
  cadence import-tokens ~/garth      Import from custom directory`)
  .action((dir?: string) => {
    importTokens(dir ?? `${process.env.HOME}/.garmy`);
  });

program
  .command("status")
  .description("Check authentication status and token expiry")
  .addHelpText("after", `
Details:
  Shows current login state, access token validity (hours remaining),
  and refresh token validity (days remaining). If the access token is
  expired, it will auto-refresh on the next API call. If the refresh
  token is expired, a full re-login is required.

Output fields:
  User     — Garmin display name
  Token    — Access token status (valid with hours remaining, or expired)
  Refresh  — Refresh token status (valid with days remaining, or expired)

Example:
  cadence status`)
  .action(async () => {
    if (!hasSecret("oauth1-token")) {
      out.info("Not logged in. Run: cadence login <email> <password>");
      out.info("Or import existing tokens: cadence import-tokens");
      return;
    }

    const expiresAt = parseInt(getSecret("expires-at") ?? "0", 10);
    const refreshExpiresAt = parseInt(getSecret("refresh-expires-at") ?? "0", 10);
    const now = Math.floor(Date.now() / 1000);

    const displayName = getSecret("display-name") ?? "not cached yet";

    console.log(`User:    ${displayName}`);

    if (now >= expiresAt) {
      console.log("Token:   expired (will auto-refresh on next API call)");
    } else {
      const hrs = Math.round((expiresAt - now) / 3600 * 10) / 10;
      console.log(`Token:   valid (${hrs}h remaining)`);
    }

    if (now >= refreshExpiresAt) {
      console.log("Refresh: expired (re-login required)");
    } else {
      const days = Math.round((refreshExpiresAt - now) / 86400 * 10) / 10;
      console.log(`Refresh: valid (${days}d remaining)`);
    }

    out.info("Credentials: macOS Keychain (service: cadence)");
  });

program
  .command("logout")
  .description("Remove all Garmin credentials from macOS Keychain")
  .addHelpText("after", `
Details:
  Deletes all stored tokens and credentials from macOS Keychain:
  OAuth1 token/secret, OAuth2 access/refresh tokens, consumer key/secret,
  display name, and profile PK. After logout, run 'cadence login' to re-auth.

Example:
  cadence logout`)
  .action(() => {
    for (const key of [
      "oauth1-token", "oauth1-secret", "access-token", "refresh-token",
      "expires-at", "refresh-expires-at", "consumer-key", "consumer-secret",
      "display-name", "profile-pk",
    ]) {
      deleteSecret(key);
    }
    out.success("All Garmin credentials removed from Keychain.");
  });

program
  .command("auth-import-from-luff")
  .description("One-shot: copy Garmin auth from legacy luff-garmin Keychain entry")
  .addHelpText("after", `
Details:
  For users migrating from the older 'garmin' CLI shipped via the luff
  monorepo. Reads all credentials stored under the 'luff-garmin' Keychain
  service and copies them to 'cadence'. Idempotent — re-run is safe.

  The source entries are NOT deleted; remove them manually with:
    security delete-generic-password -s luff-garmin -a <account>

Example:
  cadence auth-import-from-luff`)
  .action(() => {
    const { copied, missing } = importFromLuff();
    if (copied.length === 0) {
      out.error("No entries found under luff-garmin. Nothing to import.");
      process.exit(1);
    }
    out.success(`Imported ${copied.length} entries from luff-garmin:`);
    for (const k of copied) console.log(`  + ${k}`);
    if (missing.length > 0) {
      out.blank();
      out.info(`Missing (not present in luff-garmin): ${missing.join(", ")}`);
    }
  });

// ── Core data commands ──────────────────────────────────────────

program
  .command("training-readiness [days]")
  .alias("tr")
  .description("Training readiness score (0–100) with contributing factors")
  .addHelpText("after", `
Columns:
  Date      — YYYY-MM-DD
  Score     — 0–100 overall readiness score
  Level     — PRIME, HIGH, MODERATE, LOW, or POOR
  Sleep     — 0–100 last night's sleep quality contribution
  HRV       — 0–100 HRV relative to personal baseline
  Recovery  — 0–100 recovery time remaining factor
  Load      — 0–100 acute:chronic workload ratio factor
  Stress    — 0–100 recent stress history factor

Interpretation:
  75–100 HIGH/PRIME  — Body is ready. Push hard, high-intensity training OK.
  50–74  MODERATE    — Normal training. Standard workout intensity.
  25–49  LOW         — Reduce intensity. Focus on recovery and easy sessions.
  0–24   POOR        — Rest day recommended. Prioritize sleep and recovery.

  Each factor (Sleep, HRV, Recovery, Load, Stress) is 0–100 where higher
  is better. A low individual factor pinpoints what's dragging readiness down.

Examples:
  cadence tr             Last 7 days (default)
  cadence tr 1           Today only
  cadence tr 14          Two-week trend`)
  .action(async (days?: string) => {
    const d = parseInt(days ?? "7", 10);
    const data = await provider.trainingReadiness(d);
    out.heading(`Training Readiness — last ${d} days`);
    out.blank();
    if (data.length === 0) { out.info("No data."); return; }

    out.table(
      ["Date", "Score", "Level", "Sleep", "HRV", "Recovery", "Load", "Stress"],
      data.map((r) => [
        r.date, String(r.score), r.level,
        String(r.sleepScore), String(r.hrvFactor),
        String(r.recoveryFactor), String(r.loadFactor), String(r.stressFactor),
      ]),
    );
  });

program
  .command("sleep [days]")
  .description("Sleep score (0–100), stages (REM/Deep/Light/Awake), duration")
  .addHelpText("after", `
Columns:
  Date    — YYYY-MM-DD
  Score   — 0–100 overall sleep quality score
  Total   — Total sleep time (hours)
  REM     — REM sleep duration (hours) — memory, learning, emotional processing
  Deep    — Deep/SWS sleep (hours) — physical recovery, immune, growth hormone
  Light   — Light sleep (hours) — transition, muscle recovery
  Awake   — Time awake during sleep period (hours)

Interpretation:
  Sleep Score: 80–100 excellent, 60–79 good, 40–59 fair, 0–39 poor
  Ideal stage distribution: REM 20–25%, Deep 15–20%, Light 50–55%, Awake <10%
  Total sleep target: 7–9 hours for most adults

Examples:
  cadence sleep            Last 7 days (default)
  cadence sleep 30         Monthly sleep trend`)
  .action(async (days?: string) => {
    const d = parseInt(days ?? "7", 10);
    const data = await provider.sleep(d);
    out.heading(`Sleep — last ${d} days`);
    out.blank();
    if (data.length === 0) { out.info("No data."); return; }

    out.table(
      ["Date", "Score", "Total", "REM", "Deep", "Light", "Awake"],
      data.map((r) => [
        r.date, r.score != null ? String(r.score) : "\u2014",
        secToH(r.totalSeconds), secToH(r.remSeconds),
        secToH(r.deepSeconds), secToH(r.lightSeconds), secToH(r.awakeSeconds),
      ]),
    );
  });

program
  .command("heart-rate [days]")
  .alias("hr")
  .description("Resting heart rate, daily min/max, 7-day average")
  .addHelpText("after", `
Columns:
  Date       — YYYY-MM-DD
  RHR        — Resting heart rate (bpm). Lower = better cardiovascular fitness.
  Min        — Lowest HR recorded that day (bpm)
  Max        — Highest HR recorded that day (bpm)
  7d Avg RHR — Rolling 7-day average of resting HR (bpm)

Interpretation:
  RHR trends down over time = improving fitness.
  Sudden RHR spike (5+ bpm above trend) may indicate illness, stress, or
  overtraining. Compare with HRV and recovery data.

Examples:
  cadence hr             Last 7 days (default)
  cadence hr 30          Monthly HR trend`)
  .action(async (days?: string) => {
    const d = parseInt(days ?? "7", 10);
    const data = await provider.heartRate(d);
    out.heading(`Heart Rate — last ${d} days`);
    out.blank();
    if (data.length === 0) { out.info("No data."); return; }

    out.table(
      ["Date", "RHR", "Min", "Max", "7d Avg RHR"],
      data.map((r) => [
        r.date,
        n(r.restingHr), n(r.minHr), n(r.maxHr), n(r.avgRhr7d),
      ]),
    );
  });

program
  .command("hr-recent")
  .alias("hrl")
  .description("Latest heart rate sample from Garmin Connect (2-min granularity)")
  .option("-w, --watch <seconds>", "poll every N seconds (Ctrl-C to stop)")
  .option("--json", "emit JSON instead of formatted text")
  .addHelpText("after", `
Details:
  Reads the timeseries embedded in /wellness-service/wellness/dailyHeartRate.
  Samples land in batches of ~2 minutes when the watch syncs to phone via
  Bluetooth. Lag depends on connectivity, not API limits.

  Note: during an active activity the watch may hold samples until the
  activity uploads. If lag stays above ~10 minutes, your watch is probably
  not paired with phone or LiveTrack is needed for true real-time.

Examples:
  cadence hr-recent              One reading
  cadence hrl -w 60              Poll every 60s
  cadence hr-recent --json       JSON for scripting`)
  .action(async (opts: { watch?: string; json?: boolean }) => {
    const pollSeconds = opts.watch ? parseInt(opts.watch, 10) : 0;
    const emitJson = !!opts.json;

    const tick = async () => {
      const r = await provider.recentHr();
      if (!r) {
        if (emitJson) out.json({ bpm: null, error: "no_samples_today" });
        else out.info("No HR samples available today.");
        return;
      }
      if (emitJson) {
        out.json(r);
        return;
      }
      const lagStr = r.lagMinutes < 1
        ? "<1min"
        : `${r.lagMinutes}min stale`;
      const tsStr = new Date(r.timestamp).toLocaleTimeString();
      console.log(`HR ${r.bpm} bpm @ ${tsStr} (${lagStr})`);
    };

    await tick();
    if (pollSeconds > 0) {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        await new Promise((res) => setTimeout(res, pollSeconds * 1000));
        await tick();
      }
    }
  });

program
  .command("hrv [days]")
  .description("Heart rate variability — nightly avg, weekly avg, baseline, status")
  .addHelpText("after", `
Columns:
  Date        — YYYY-MM-DD
  HRV         — Last night's average HRV (ms). Higher = better recovery.
  Weekly      — Rolling 7-day average HRV (ms)
  Night High  — Highest 5-minute HRV segment during last night (ms)
  Base Low    — Personal baseline lower bound (ms)
  Bal Low     — Balanced range lower bound (ms)
  Bal High    — Balanced range upper bound (ms)
  Status      — BALANCED, UNBALANCED, or LOW relative to personal baseline

Interpretation:
  HRV is highly individual — absolute values vary widely between people.
  What matters is your trend relative to your own baseline.
  BALANCED = within normal range. UNBALANCED = below typical. LOW = significantly below.
  Declining HRV over 3+ days may indicate overtraining, illness, or accumulated stress.

Examples:
  cadence hrv            Last 7 days (default)
  cadence hrv 30         Monthly HRV trend to spot patterns`)
  .action(async (days?: string) => {
    const d = parseInt(days ?? "7", 10);
    const data = await provider.hrv(d);
    out.heading(`HRV — last ${d} days`);
    out.blank();
    if (data.length === 0) { out.info("No data."); return; }

    out.table(
      ["Date", "HRV", "Weekly", "Night High", "Base Low", "Bal Low", "Bal High", "Status"],
      data.map((r) => [
        r.date,
        n(r.lastNightAvg), n(r.weeklyAvg), n(r.lastNight5MinHigh),
        n(r.baselineLow), n(r.baselineBalancedLow), n(r.baselineBalancedHigh),
        r.status ?? "\u2014",
      ]),
    );
  });

program
  .command("stress [days]")
  .description("Daily stress levels (0–100) with qualifier")
  .addHelpText("after", `
Columns:
  Date      — YYYY-MM-DD
  Avg       — Average stress level for the day (0–100)
  Max       — Maximum stress reading (0–100)
  Qualifier — Descriptive label: rest_of_day, low, medium, high, calm, balanced

Interpretation:
  0–25   Rest     — Low/no physiological stress
  26–50  Low      — Normal, manageable stress
  51–75  Medium   — Elevated stress, consider breaks
  76–100 High     — Very high stress, prioritize recovery

  Garmin measures stress via HRV-derived sympathetic nervous system activation.
  High stress all day = watch for burnout. Rest stress during sleep is normal.

Examples:
  cadence stress           Last 7 days (default)
  cadence stress 14        Two-week stress overview`)
  .action(async (days?: string) => {
    const d = parseInt(days ?? "7", 10);
    const data = await provider.stress(d);
    out.heading(`Stress — last ${d} days`);
    out.blank();
    if (data.length === 0) { out.info("No data."); return; }

    out.table(
      ["Date", "Avg", "Max", "Qualifier"],
      data.map((r) => [
        r.date, n(r.avgStress), n(r.maxStress), r.qualifier ?? "\u2014",
      ]),
    );
  });

program
  .command("body-battery [days]")
  .alias("bb")
  .description("Body battery energy level (0–100): charge, drain, high, low, wake value")
  .addHelpText("after", `
Columns:
  Date     — YYYY-MM-DD
  Charged  — Energy gained (mostly during sleep and rest)
  Drained  — Energy spent (activity, stress)
  Highest  — Peak body battery level during the day
  Lowest   — Lowest body battery level during the day
  At Wake  — Body battery level at wake time (most actionable value)

Interpretation:
  75–100  High energy    — Good for demanding tasks and intense workouts
  50–74   Moderate       — Normal activity and moderate workouts
  25–49   Low energy     — Consider lighter activity, more breaks
  0–24    Very low       — Rest needed, prioritize sleep and recovery

  Body Battery is Garmin's proprietary energy metric based on HRV, stress,
  sleep, and activity. It charges during rest and drains during activity.
  The "At Wake" value is most useful for morning planning.

Examples:
  cadence bb             Last 7 days (default)
  cadence bb 14          Two-week body battery trend`)
  .action(async (days?: string) => {
    const d = parseInt(days ?? "7", 10);
    const data = await provider.bodyBattery(d);
    out.heading(`Body Battery — last ${d} days`);
    out.blank();
    if (data.length === 0) { out.info("No data."); return; }

    out.table(
      ["Date", "Charged", "Drained", "Highest", "Lowest", "At Wake"],
      data.map((r) => [
        r.date, n(r.charged), n(r.drained), n(r.highest), n(r.lowest), n(r.atWake),
      ]),
    );
  });

program
  .command("steps [days]")
  .description("Daily step count, distance, goal progress, floors climbed")
  .addHelpText("after", `
Columns:
  Date     — YYYY-MM-DD
  Steps    — Total step count for the day
  Distance — Total distance walked/run (km)
  Goal     — Daily step goal set on the device (auto-adjusting)
  Floors   — Floors climbed (each floor ≈ 3 meters / 10 feet of elevation)

Examples:
  cadence steps           Last 7 days (default)
  cadence steps 30        Monthly step history`)
  .action(async (days?: string) => {
    const d = parseInt(days ?? "7", 10);
    const data = await provider.steps(d);
    out.heading(`Steps — last ${d} days`);
    out.blank();
    if (data.length === 0) { out.info("No data."); return; }

    out.table(
      ["Date", "Steps", "Distance", "Goal", "Floors"],
      data.map((r) => [
        r.date, String(r.totalSteps), km(r.distanceMeters),
        String(r.stepGoal), String(Math.round(r.floorsAscended)),
      ]),
    );
  });

program
  .command("activities [days]")
  .description("Recent workouts: name, type, duration, distance, HR, calories, training effect")
  .addHelpText("after", `
Columns:
  ID       — Garmin activity ID (use with 'cadence activity <id>' for full detail)
  Date     — YYYY-MM-DD
  Name     — Activity name (e.g., "Morning Run", "Indoor Cycling")
  Type     — Activity type (running, cycling, strength, etc.)
  Duration — Total activity duration
  Distance — Total distance (km), if applicable
  AvgHR    — Average heart rate during activity (bpm)
  kcal     — Calories burned
  Elev     — Elevation gain (meters)
  AE/AnE   — Aerobic/Anaerobic Training Effect (0.0–5.0 each)

Training Effect scale:
  0.0–0.9  No effect
  1.0–1.9  Minor benefit
  2.0–2.9  Maintaining current fitness
  3.0–3.9  Improving fitness
  4.0–4.9  Highly improving fitness
  5.0      Overreaching

Tip: Copy an activity ID from this list to drill into it:
  cadence activity <id>   — Shows splits, HR zones, pace, power, temperature

Examples:
  cadence activities        Last 7 days (default)
  cadence activities 30     Last 30 days of workouts`)
  .action(async (days?: string) => {
    const d = parseInt(days ?? "7", 10);
    const data = await provider.activities(d);
    out.heading(`Activities — last ${d} days`);
    out.blank();
    if (data.length === 0) { out.info("No activity data."); return; }

    out.table(
      ["ID", "Date", "Name", "Type", "Duration", "Distance", "AvgHR", "kcal", "Elev", "AE/AnE"],
      data.map((r) => [
        r.activityId != null ? String(r.activityId) : "\u2014",
        r.date, r.name, r.type, secToMin(r.durationSeconds), km(r.distanceMeters),
        n(r.avgHr), n(r.calories),
        r.elevationGain != null ? `${Math.round(r.elevationGain)}m` : "\u2014",
        r.aerobicEffect != null ? `${n(r.aerobicEffect, 1)}/${n(r.anaerobicEffect, 1)}` : "\u2014",
      ]),
    );
  });

program
  .command("daily [days]")
  .description("Combined daily summary: steps, distance, calories, HR, stress, body battery, floors")
  .addHelpText("after", `
Columns:
  Date       — YYYY-MM-DD
  Steps      — Total step count
  Distance   — Total distance (km)
  Active kcal — Active calories burned (excludes BMR)
  RHR        — Resting heart rate (bpm)
  Min HR     — Lowest heart rate (bpm)
  Max HR     — Highest heart rate (bpm)
  Avg Stress — Average stress level (0–100)
  BB Wake    — Body battery at wake time (0–100)
  Floors     — Floors climbed

  This is a combined view pulling from steps, heart rate, stress, and body
  battery data. Use individual commands for more detailed breakdowns.

Examples:
  cadence daily           Last 7 days (default)
  cadence daily 14        Two-week daily summary`)
  .action(async (days?: string) => {
    const d = parseInt(days ?? "7", 10);
    const data = await provider.daily(d);
    out.heading(`Daily Summary — last ${d} days`);
    out.blank();
    if (data.length === 0) { out.info("No data."); return; }

    out.table(
      ["Date", "Steps", "Distance", "Active kcal", "RHR", "Min HR", "Max HR", "Avg Stress", "BB Wake", "Floors"],
      data.map((r) => [
        r.date, String(r.totalSteps), km(r.distanceMeters), String(r.activeKcal),
        n(r.restingHr), n(r.minHr), n(r.maxHr), n(r.avgStress), n(r.bbAtWake),
        String(Math.round(r.floorsAscended)),
      ]),
    );
  });

// ── Advanced data commands ──────────────────────────────────────

program
  .command("vo2max [days]")
  .description("VO2 Max (ml/kg/min) for running and cycling, with fitness age")
  .addHelpText("after", `
Columns:
  Date        — YYYY-MM-DD
  Running     — VO2 Max estimated from running activities (ml/kg/min)
  Cycling     — VO2 Max estimated from cycling activities (ml/kg/min)
  Generic     — Generic/overall VO2 Max value (ml/kg/min)
  Fitness Age — Estimated fitness age based on VO2 Max

Interpretation (ml/kg/min, general adult population):
  < 30   Low          — Below average
  30–39  Fair         — Average
  40–49  Good         — Above average
  50–59  Excellent    — Well above average
  60+    Elite/Superior

  VO2 Max is the gold standard for aerobic fitness. Higher values indicate
  better cardiovascular fitness. Trending up = improving fitness.
  Garmin estimates VO2 Max from GPS-tracked running/cycling with heart rate.

  Default: 30 days (VO2 Max changes slowly, longer windows show trends better).

Examples:
  cadence vo2max           Last 30 days (default)
  cadence vo2max 90        Three-month VO2 Max trend
  cadence vo2max 365       Full year`)
  .action(async (days?: string) => {
    const d = parseInt(days ?? "30", 10);
    const data = await provider.vo2max(d);
    out.heading(`VO2 Max — last ${d} days`);
    out.blank();
    if (data.length === 0) { out.info("No data."); return; }

    out.table(
      ["Date", "Running", "Cycling", "Generic", "Fitness Age"],
      data.map((r) => [
        r.date, n(r.vo2MaxRunning, 1), n(r.vo2MaxCycling, 1),
        n(r.generic, 1), n(r.fitnessAge),
      ]),
    );
  });

program
  .command("spo2 [days]")
  .description("Blood oxygen saturation — sleep SpO2 average, lowest, latest")
  .addHelpText("after", `
Columns:
  Date      — YYYY-MM-DD
  Avg %     — Average SpO2 during sleep
  Lowest %  — Lowest SpO2 reading during sleep
  Latest %  — Most recent SpO2 reading

Interpretation:
  95–100%  Normal
  90–94%   Below normal — may indicate altitude, respiratory issues, or sleep apnea
  < 90%    Concerning — seek medical evaluation

  SpO2 is measured during sleep via the watch's pulse oximeter.
  Consistent low readings (especially <94%) warrant medical attention.

Examples:
  cadence spo2            Last 7 days (default)
  cadence spo2 30         Monthly SpO2 trend`)
  .action(async (days?: string) => {
    const d = parseInt(days ?? "7", 10);
    const data = await provider.spo2(d);
    out.heading(`SpO2 — last ${d} days`);
    out.blank();
    if (data.length === 0) { out.info("No data."); return; }

    out.table(
      ["Date", "Avg %", "Lowest %", "Latest %"],
      data.map((r) => [
        r.date, n(r.avgSpo2), n(r.lowestSpo2), n(r.latestSpo2),
      ]),
    );
  });

program
  .command("respiration [days]")
  .alias("resp")
  .description("Breathing rates — waking average, sleeping average, high, low")
  .addHelpText("after", `
Columns:
  Date          — YYYY-MM-DD
  Avg Waking    — Average breaths/min while awake
  Avg Sleeping  — Average breaths/min during sleep
  Highest       — Peak respiration rate (breaths/min)
  Lowest        — Lowest respiration rate (breaths/min)

Interpretation:
  Normal resting respiration: 12–20 breaths/min
  Sleep respiration is typically lower than waking.
  Sudden increases in sleeping respiration rate can indicate illness.
  Tracking trends is more useful than absolute values.

Examples:
  cadence resp           Last 7 days (default)
  cadence resp 14        Two-week respiration trend`)
  .action(async (days?: string) => {
    const d = parseInt(days ?? "7", 10);
    const data = await provider.respiration(d);
    out.heading(`Respiration — last ${d} days`);
    out.blank();
    if (data.length === 0) { out.info("No data."); return; }

    out.table(
      ["Date", "Avg Waking", "Avg Sleeping", "Highest", "Lowest"],
      data.map((r) => [
        r.date, n(r.avgWaking, 1), n(r.avgSleeping, 1),
        n(r.highest, 1), n(r.lowest, 1),
      ]),
    );
  });

program
  .command("training-status [days]")
  .alias("ts")
  .description("Training status (PEAKING/PRODUCTIVE/etc.), load focus, ACWR, VO2 Max")
  .addHelpText("after", `
Columns:
  Date    — YYYY-MM-DD
  Status  — Training status label (see below)
  Focus   — Load focus: LOW_AEROBIC, HIGH_AEROBIC, ANAEROBIC, or mixed
  Acute   — Acute training load (last 7 days)
  Chronic — Chronic training load (last 28 days)
  ACWR    — Acute:Chronic Workload Ratio (acute / chronic)
  VO2     — Current VO2 Max estimate (ml/kg/min)

Training Status labels:
  PEAKING       — Ideal race form, training load balanced, fitness peaked
  PRODUCTIVE    — Fitness improving, current training approach is effective
  MAINTAINING   — Fitness stable, not gaining or losing
  RECOVERY      — Light training load, body is recovering
  UNPRODUCTIVE  — Training load not translating to fitness gains
  DETRAINING    — Training load too low, fitness actively declining
  OVERREACHING  — Training load too high, overtraining risk

ACWR (Acute:Chronic Workload Ratio):
  < 0.8    Undertraining   — Risk of detraining, increase load
  0.8–1.3  Sweet spot      — Optimal training load balance
  1.3–1.5  Caution zone    — Load increasing, monitor recovery
  > 1.5    Danger zone     — High injury/overtraining risk

Examples:
  cadence ts             Last 7 days (default)
  cadence ts 28          Full training cycle (4 weeks)`)
  .action(async (days?: string) => {
    const d = parseInt(days ?? "7", 10);
    const data = await provider.trainingStatus(d);
    out.heading(`Training Status — last ${d} days`);
    out.blank();
    if (data.length === 0) { out.info("No data."); return; }

    out.table(
      ["Date", "Status", "Focus", "Acute", "Chronic", "ACWR", "VO2"],
      data.map((r) => [
        r.date, r.trainingStatus ?? "\u2014", r.loadFocus ?? "\u2014",
        n(r.acuteLoad), n(r.chronicLoad), n(r.acwrPercent, 2), n(r.vo2Max, 1),
      ]),
    );
  });

program
  .command("race-predictions")
  .alias("rp")
  .description("Predicted race times for 5K, 10K, half marathon, marathon")
  .addHelpText("after", `
Columns:
  Distance       — Race distance (5K, 10K, Half Marathon, Marathon)
  Predicted Time — Estimated finish time (H:MM:SS)

Details:
  Based on VO2 Max and recent training data. Predictions improve with
  more GPS-tracked running activities. Requires sufficient running history.

  Note: This endpoint may not be available for all Garmin device models.
  If no data is shown, race predictions are not available for your device.

Example:
  cadence rp`)
  .action(async () => {
    const data = await provider.racePredictions();
    out.heading("Race Predictions");
    out.blank();
    if (data.length === 0) { out.info("No data."); return; }

    out.table(
      ["Distance", "Predicted Time"],
      data.map((r) => [r.distance, r.predictedTime]),
    );
  });

program
  .command("weight [days]")
  .description("Body weight (kg), BMI, body fat %, muscle mass, bone mass, body water %")
  .addHelpText("after", `
Columns:
  Date        — YYYY-MM-DD
  Weight (kg) — Body weight in kilograms
  BMI         — Body Mass Index (weight / height^2)
  Body Fat %  — Body fat percentage (requires smart scale)
  Muscle (kg) — Muscle mass in kg (requires smart scale)
  Bone (kg)   — Bone mass in kg (requires smart scale)
  Water %     — Body water percentage (requires smart scale)

Details:
  Weight is synced from Garmin Index smart scale or manual entries.
  Body composition metrics (fat, muscle, bone, water) require a Garmin
  Index S2 smart scale or compatible body composition scale.

  Default: 30 days (weight trends are best viewed over longer periods).

Examples:
  cadence weight           Last 30 days (default)
  cadence weight 90        Three-month weight trend
  cadence weight 365       Full year`)
  .action(async (days?: string) => {
    const d = parseInt(days ?? "30", 10);
    const data = await provider.weight(d);
    out.heading(`Weight — last ${d} days`);
    out.blank();
    if (data.length === 0) { out.info("No data."); return; }

    out.table(
      ["Date", "Weight (kg)", "BMI", "Body Fat %", "Muscle (kg)", "Bone (kg)", "Water %"],
      data.map((r) => [
        r.date, n(r.weight, 1), n(r.bmi, 1), n(r.bodyFat, 1),
        n(r.muscleMass, 1), n(r.boneMass, 1), n(r.bodyWater, 1),
      ]),
    );
  });

program
  .command("fitness-age")
  .alias("fa")
  .description("Fitness age vs chronological age (based on VO2 Max)")
  .addHelpText("after", `
Output:
  Chronological age — Your actual age in years
  Fitness age       — Estimated age based on VO2 Max and activity level
  Difference        — How many years younger (or older) your fitness age is

Details:
  Fitness age is Garmin's estimate of your biological fitness level compared
  to population norms. A fitness age lower than chronological age means your
  cardiovascular fitness is better than average for your age.

  Based on VO2 Max, resting heart rate, BMI, and activity level.

Example:
  cadence fa`)
  .action(async () => {
    const data = await provider.fitnessAge();
    out.heading("Fitness Age");
    out.blank();
    console.log(`Chronological age: ${data.chronologicalAge}`);
    console.log(`Fitness age:       ${data.fitnessAge ?? "\u2014"}`);
    if (data.fitnessAge != null && data.chronologicalAge > 0) {
      const diff = data.chronologicalAge - data.fitnessAge;
      console.log(`Difference:        ${diff > 0 ? `${diff} years younger` : diff < 0 ? `${Math.abs(diff)} years older` : "same"}`);
    }
  });

program
  .command("intensity [days]")
  .alias("im")
  .description("Intensity minutes — moderate + vigorous activity minutes, weekly goal")
  .addHelpText("after", `
Columns:
  Date          — YYYY-MM-DD
  Moderate      — Minutes of moderate-intensity activity
  Vigorous      — Minutes of vigorous-intensity activity
  Total (2x vig) — Total intensity minutes (moderate + vigorous * 2)
  Weekly Goal   — Target intensity minutes per week (default: 150)

Details:
  WHO recommends 150 minutes of moderate-intensity or 75 minutes of
  vigorous-intensity activity per week. Garmin counts vigorous minutes
  as double (2x) toward the weekly goal, matching WHO guidelines.

  Intensity is determined by heart rate relative to your personal zones.
  Moderate = elevated HR. Vigorous = high HR (typically zone 3+).

Examples:
  cadence im             Last 7 days (default)
  cadence im 28          Full 4-week view`)
  .action(async (days?: string) => {
    const d = parseInt(days ?? "7", 10);
    const data = await provider.intensityMinutes(d);
    out.heading(`Intensity Minutes — last ${d} days`);
    out.blank();
    if (data.length === 0) { out.info("No data."); return; }

    out.table(
      ["Date", "Moderate", "Vigorous", "Total (2x vig)", "Weekly Goal"],
      data.map((r) => [
        r.date, String(r.moderate), String(r.vigorous),
        String(r.total), String(r.weeklyGoal),
      ]),
    );
  });

program
  .command("endurance")
  .alias("es")
  .description("Endurance score (0–100) and classification")
  .addHelpText("after", `
Output:
  Score          — 0–100 endurance fitness level
  Classification — Descriptive label (e.g., "Fair", "Good", "Superior")

Details:
  Endurance score estimates your ability to sustain prolonged aerobic activity.
  Based on training history, VO2 Max, and activity patterns.

  Note: This feature may not be available on all Garmin watch models.
  If values show as "—", the feature is not supported by your device.

Example:
  cadence es`)
  .action(async () => {
    const data = await provider.enduranceScore();
    out.heading("Endurance Score");
    out.blank();
    console.log(`Score:          ${data.overall ?? "\u2014"}`);
    console.log(`Classification: ${data.classification ?? "\u2014"}`);
  });

// ── Activity detail commands ────────────────────────────────────

program
  .command("activity <id>")
  .description("Full detail of a specific activity — summary + splits + HR zones")
  .addHelpText("after", `
Details:
  Shows comprehensive detail for a single activity including:
  1. Summary: type, duration, distance, elevation, HR, cadence, pace,
     calories, training effect, VO2 Max, power, temperature
  2. Splits: per-kilometer (or per-lap) breakdown with pace, HR, cadence
  3. HR Zones: time spent in each heart rate zone (Z1–Z5)

  Get the activity ID from 'cadence activities' output (first column).

Summary fields:
  Type      — Activity type (e.g., running, cycling, strength_training)
  Duration  — Total elapsed time (H:MM:SS)
  Distance  — Total distance (km)
  Elev      — Elevation gain/loss (meters)
  HR        — Average / max heart rate (bpm)
  Cadence   — Steps per minute (for running activities)
  Pace      — Average / max pace (min:sec/km)
  Calories  — Total calories burned
  Training  — Aerobic Effect / Anaerobic Effect (0.0–5.0)
  VO2 Max   — Estimated VO2 Max from this activity
  Power     — Average / max power in watts (if power meter available)
  Temp      — Average ambient temperature (°C)

Splits columns:
  #        — Split/lap number
  Distance — Split distance (km)
  Duration — Split time (H:MM:SS)
  Pace     — Average pace for split (min:sec/km)
  AvgHR    — Average heart rate for split
  MaxHR    — Max heart rate for split
  Cadence  — Average cadence for split (spm)
  Elev +/- — Elevation gain/loss for split (meters)

HR Zones columns:
  Zone     — Zone number (Z1–Z5)
  Range    — Heart rate range for this zone (bpm)
  Duration — Time spent in this zone (H:MM:SS)

Examples:
  cadence activity 18765432       Full detail for activity 18765432
  cadence activities 7            List recent activities to find IDs`)
  .action(async (id: string) => {
    const activityId = parseInt(id, 10);
    if (isNaN(activityId)) { out.error("Invalid activity ID"); process.exit(1); }

    const detail = await provider.activityDetail(activityId);
    out.heading(`${detail.name} — ${detail.date}`);
    out.blank();

    console.log(`Type:     ${detail.type}`);
    console.log(`Duration: ${secToHMS(detail.durationSeconds)}`);
    if (detail.distanceMeters != null) console.log(`Distance: ${km(detail.distanceMeters)}`);
    if (detail.elevationGain != null) console.log(`Elev:     +${Math.round(detail.elevationGain)}m / -${Math.round(detail.elevationLoss ?? 0)}m`);
    if (detail.avgHr != null) console.log(`HR:       avg ${detail.avgHr} / max ${detail.maxHr ?? "\u2014"}`);
    if (detail.avgRunCadence != null) console.log(`Cadence:  avg ${Math.round(detail.avgRunCadence)} / max ${detail.maxRunCadence != null ? Math.round(detail.maxRunCadence) : "\u2014"} spm`);
    if (detail.avgSpeed != null) console.log(`Pace:     avg ${mps(detail.avgSpeed)} / max ${mps(detail.maxSpeed)}`);
    if (detail.calories != null) console.log(`Calories: ${Math.round(detail.calories)} kcal`);
    if (detail.aerobicEffect != null) console.log(`Training: AE ${detail.aerobicEffect.toFixed(1)} / AnE ${(detail.anaerobicEffect ?? 0).toFixed(1)}`);
    if (detail.vo2Max != null) console.log(`VO2 Max:  ${detail.vo2Max.toFixed(1)}`);
    if (detail.avgPower != null) console.log(`Power:    avg ${Math.round(detail.avgPower)}W / max ${detail.maxPower != null ? Math.round(detail.maxPower) : "\u2014"}W`);
    if (detail.avgTemperature != null) console.log(`Temp:     ${detail.avgTemperature.toFixed(1)}\u00b0C`);

    // Splits
    try {
      const splits = await provider.activitySplits(activityId);
      if (splits.length > 0) {
        out.blank();
        out.subheading("Splits");
        out.table(
          ["#", "Distance", "Duration", "Pace", "AvgHR", "MaxHR", "Cadence", "Elev +/-"],
          splits.map((s) => [
            String(s.index), km(s.distanceMeters), secToHMS(s.durationSeconds),
            mps(s.avgSpeed), n(s.avgHr), n(s.maxHr),
            s.avgCadence != null ? String(Math.round(s.avgCadence)) : "\u2014",
            s.elevationGain != null ? `+${Math.round(s.elevationGain)}/-${Math.round(s.elevationLoss ?? 0)}` : "\u2014",
          ]),
        );
      }
    } catch {
      // Splits not available for all activity types
    }

    // HR Zones
    try {
      const zones = await provider.activityHrZones(activityId);
      if (zones.length > 0) {
        out.blank();
        out.subheading("HR Zones");
        out.table(
          ["Zone", "Range (bpm)", "Duration"],
          zones.map((z) => [
            `Z${z.zone}`,
            `${z.zoneLow}\u2013${z.zoneHigh}`,
            secToHMS(z.durationSeconds),
          ]),
        );
      }
    } catch {
      // HR zones not available for all activity types
    }
  });

program
  .command("records")
  .alias("prs")
  .description("Personal records — fastest times, farthest distances, most steps")
  .addHelpText("after", `
Columns:
  Type     — Record category: Fastest 1K, Fastest Mile, Fastest 5K,
             Fastest 10K, Fastest Half, Fastest Marathon, Farthest Run,
             Longest Ride, Longest Swim, Most Steps (Day/Week/Month)
  Value    — Record value (time in H:MM:SS, distance in km, or count)
  Date     — When the record was set (YYYY-MM-DD)
  Activity — Name of the activity where the record was achieved

Details:
  Personal records are tracked automatically by Garmin across all activities.
  Time-based records (1K–Marathon) show fastest completion times.
  Distance records show farthest single-activity distances.
  Step records show highest step counts for day, week, and month.

Example:
  cadence prs`)
  .action(async () => {
    const data = await provider.personalRecords();
    out.heading("Personal Records");
    out.blank();
    if (data.length === 0) { out.info("No data."); return; }

    // Format value based on type: time PRs in HH:MM:SS, distance in km, others raw
    const fmtValue = (typeId: number, value: number | null): string => {
      if (value == null) return "\u2014";
      if (typeId >= 1 && typeId <= 6) return secToHMS(value); // time records
      if (typeId >= 7 && typeId <= 9) return km(value); // distance records
      return String(Math.round(value)); // steps, counts, etc.
    };

    out.table(
      ["Type", "Value", "Date", "Activity"],
      data.map((r) => [
        r.type,
        fmtValue(r.typeId, r.value),
        r.date ?? "\u2014",
        r.activityName ?? "\u2014",
      ]),
    );
  });

program
  .command("gear")
  .description("Equipment tracking — shoes, bikes, and other gear with usage stats")
  .addHelpText("after", `
Columns:
  Name         — Gear name (e.g., "Nike Pegasus 40")
  Type         — Equipment type (shoes, bike, etc.)
  Distance     — Total distance tracked with this gear (km)
  Activities   — Number of activities using this gear
  Max Distance — Retirement distance if set (km), otherwise —
  Since        — Date the gear was added (YYYY-MM-DD)

Details:
  Tracks usage across all activities. Useful for knowing when to replace
  running shoes (typically every 500–800 km) or schedule bike maintenance.

Example:
  cadence gear`)
  .action(async () => {
    const data = await provider.gear();
    out.heading("Gear");
    out.blank();
    if (data.length === 0) { out.info("No gear registered."); return; }

    out.table(
      ["Name", "Type", "Distance", "Activities", "Max Distance", "Since"],
      data.map((g) => [
        g.name, g.type, km(g.distanceMeters), String(g.activities),
        g.maxDistanceMeters != null ? km(g.maxDistanceMeters) : "\u2014",
        g.createDate.slice(0, 10),
      ]),
    );
  });

// ── Overview ────────────────────────────────────────────────────

program
  .command("overview [days]")
  .description("Full dashboard — all core + advanced metrics in a single view")
  .addHelpText("after", `
Details:
  Fetches and displays all available health metrics in one combined output.
  Includes: Training Readiness, Sleep, Heart Rate, HRV, Stress, Body Battery,
  Steps, Activities, VO2 Max, Intensity Minutes, and Weight.

  This is the most comprehensive single command — use it for weekly reviews
  or to get a complete health snapshot. For faster, targeted data, use the
  individual commands instead.

Examples:
  cadence overview          Full 7-day dashboard (default)
  cadence overview 14       Two-week comprehensive view`)
  .action(async (days?: string) => {
    const d = parseInt(days ?? "7", 10);
    out.heading(`Garmin Overview — last ${d} days`);
    out.blank();

    out.subheading("Training Readiness");
    const tr = await provider.trainingReadiness(d);
    if (tr.length === 0) { out.info("No data."); } else {
      out.table(
        ["Date", "Score", "Level", "Sleep", "HRV", "Recovery", "Load", "Stress"],
        tr.map((r) => [
          r.date, String(r.score), r.level,
          String(r.sleepScore), String(r.hrvFactor),
          String(r.recoveryFactor), String(r.loadFactor), String(r.stressFactor),
        ]),
      );
    }
    out.blank();

    out.subheading("Sleep");
    const sl = await provider.sleep(d);
    if (sl.length === 0) { out.info("No data."); } else {
      out.table(
        ["Date", "Score", "Total", "REM", "Deep", "Light", "Awake"],
        sl.map((r) => [
          r.date, r.score != null ? String(r.score) : "\u2014",
          secToH(r.totalSeconds), secToH(r.remSeconds),
          secToH(r.deepSeconds), secToH(r.lightSeconds), secToH(r.awakeSeconds),
        ]),
      );
    }
    out.blank();

    out.subheading("Heart Rate");
    const hr = await provider.heartRate(d);
    if (hr.length === 0) { out.info("No data."); } else {
      out.table(
        ["Date", "RHR", "Min", "Max", "7d Avg RHR"],
        hr.map((r) => [
          r.date, n(r.restingHr), n(r.minHr), n(r.maxHr), n(r.avgRhr7d),
        ]),
      );
    }
    out.blank();

    out.subheading("HRV");
    const hrvData = await provider.hrv(d);
    if (hrvData.length === 0) { out.info("No data."); } else {
      out.table(
        ["Date", "HRV", "Weekly", "Night High", "Status"],
        hrvData.map((r) => [
          r.date, n(r.lastNightAvg), n(r.weeklyAvg), n(r.lastNight5MinHigh),
          r.status ?? "\u2014",
        ]),
      );
    }
    out.blank();

    out.subheading("Stress");
    const stress = await provider.stress(d);
    if (stress.length === 0) { out.info("No data."); } else {
      out.table(
        ["Date", "Avg", "Max", "Qualifier"],
        stress.map((r) => [
          r.date, n(r.avgStress), n(r.maxStress), r.qualifier ?? "\u2014",
        ]),
      );
    }
    out.blank();

    out.subheading("Body Battery");
    const bb = await provider.bodyBattery(d);
    if (bb.length === 0) { out.info("No data."); } else {
      out.table(
        ["Date", "Charged", "Drained", "Highest", "Lowest"],
        bb.map((r) => [
          r.date, n(r.charged), n(r.drained), n(r.highest), n(r.lowest),
        ]),
      );
    }
    out.blank();

    out.subheading("Steps");
    const st = await provider.steps(d);
    if (st.length === 0) { out.info("No data."); } else {
      out.table(
        ["Date", "Steps", "Distance", "Goal", "Floors"],
        st.map((r) => [
          r.date, String(r.totalSteps), km(r.distanceMeters),
          String(r.stepGoal), String(Math.round(r.floorsAscended)),
        ]),
      );
    }
    out.blank();

    out.subheading("Activities");
    const acts = await provider.activities(d);
    if (acts.length === 0) { out.info("No activity data."); } else {
      out.table(
        ["ID", "Date", "Name", "Type", "Duration", "Distance", "AvgHR", "kcal"],
        acts.map((r) => [
          r.activityId != null ? String(r.activityId) : "\u2014",
          r.date, r.name, r.type, secToMin(r.durationSeconds), km(r.distanceMeters),
          n(r.avgHr), n(r.calories),
        ]),
      );
    }
    out.blank();

    out.subheading("VO2 Max");
    const vo2 = await provider.vo2max(d);
    if (vo2.length === 0) { out.info("No data."); } else {
      out.table(
        ["Date", "Running", "Cycling", "Generic"],
        vo2.map((r) => [
          r.date, n(r.vo2MaxRunning, 1), n(r.vo2MaxCycling, 1), n(r.generic, 1),
        ]),
      );
    }
    out.blank();

    out.subheading("Intensity Minutes");
    const im = await provider.intensityMinutes(d);
    if (im.length === 0) { out.info("No data."); } else {
      out.table(
        ["Date", "Moderate", "Vigorous", "Total"],
        im.map((r) => [
          r.date, String(r.moderate), String(r.vigorous), String(r.total),
        ]),
      );
    }
    out.blank();

    out.subheading("Weight");
    const wt = await provider.weight(d);
    if (wt.length === 0) { out.info("No data."); } else {
      out.table(
        ["Date", "Weight (kg)", "BMI", "Body Fat %"],
        wt.map((r) => [
          r.date, n(r.weight, 1), n(r.bmi, 1), n(r.bodyFat, 1),
        ]),
      );
    }
  });

// ── Raw JSON ────────────────────────────────────────────────────

program
  .command("json <path> [params...]")
  .description("Raw JSON from any Garmin Connect API endpoint")
  .addHelpText("after", `
Details:
  Fetches raw JSON from any Garmin Connect API path. The path is relative
  to https://connectapi.garmin.com/ — do not include the domain.

  Query parameters can be passed as key=value pairs after the path.

  This is useful for exploring the API, debugging, or accessing endpoints
  not yet wrapped by dedicated commands.

Examples:
  cadence json /fitnessstats
  cadence json /usersummary-service/usersummary/daily/USERNAME
  cadence json /weight-service/weight/dateRange startDate=2026-01-01 endDate=2026-02-01
  cadence json /activity-service/activity/18765432`)
  .action(async (path: string, params: string[]) => {
    const paramMap: Record<string, string> = {};
    for (const p of params) {
      const [k, v] = p.split("=");
      if (k && v) paramMap[k] = v;
    }
    out.json(await provider.json(path, Object.keys(paramMap).length ? paramMap : undefined));
  });

// ── Run ──────────────────────────────────────────────────────────

try {
  await program.parseAsync(process.argv);
} catch (e: unknown) {
  out.error((e as Error).message);
  process.exit(1);
}
