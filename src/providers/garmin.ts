import { getSecret, setSecret } from "../lib/keychain.ts";
import { getValidAccessToken } from "../auth.ts";
import type {
  FitnessProvider,
  TrainingReadiness,
  SleepData,
  HeartRate,
  HrvData,
  StressData,
  BodyBattery,
  StepData,
  Activity,
  DailySummary,
  Vo2Max,
  Spo2Data,
  RespirationData,
  TrainingStatus,
  RacePrediction,
  WeightEntry,
  FitnessAge,
  IntensityMinutes,
  EnduranceScore,
  ActivityDetail,
  ActivitySplit,
  ActivityHrZone,
  PersonalRecord,
  GearItem,
} from "../types.ts";

const BASE_URL = "https://connectapi.garmin.com";
const UA = "com.garmin.android.apps.connectmobile";

// ── API helpers ──────────────────────────────────────────────────

async function apiGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const token = await getValidAccessToken();
  let url = `${BASE_URL}${path}`;
  if (params) {
    const qs = new URLSearchParams(params).toString();
    if (qs) url += `?${qs}`;
  }

  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Authorization: `Bearer ${token}`,
    },
  });

  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} GET ${path}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

async function getDisplayName(): Promise<string> {
  const cached = await getSecret("display-name");
  if (cached) return cached;

  const profile = await apiGet<{ displayName?: string; userName?: string }>(
    "/userprofile-service/socialProfile"
  );
  const name = profile?.displayName || profile?.userName;
  if (!name) throw new Error("Could not determine display name from profile");

  await setSecret("display-name", name);
  return name;
}

async function getProfilePk(): Promise<number> {
  const cached = await getSecret("profile-pk");
  if (cached) return parseInt(cached, 10);

  const profile = await apiGet<any>("/userprofile-service/socialProfile");
  const pk = profile?.userProfilePK ?? profile?.profileId;
  if (!pk) throw new Error("Could not determine profile PK from social profile");

  await setSecret("profile-pk", String(pk));
  return pk;
}

function dateStr(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split("T")[0]!;
}

function today(): string {
  return new Date().toISOString().split("T")[0]!;
}

function fmtSec(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── Provider ─────────────────────────────────────────────────────

export const garminProvider: FitnessProvider = {
  name: "garmin",

  // ── Existing endpoints ──────────────────────────────────────

  async trainingReadiness(days) {
    const results: TrainingReadiness[] = [];
    for (let i = 0; i < days; i++) {
      const date = dateStr(i);
      try {
        const raw = await apiGet<any>(`/metrics-service/metrics/trainingreadiness/${date}`);
        if (!raw || raw.length === 0) continue;
        const r = Array.isArray(raw) ? raw[0] : raw;
        results.push({
          date: r.calendarDate ?? date,
          score: r.score ?? 0,
          level: r.level ?? "UNKNOWN",
          sleepScore: r.sleepScoreFactorPercent ?? r.sleepScore ?? 0,
          hrvFactor: r.hrvFactorPercent ?? 0,
          recoveryFactor: r.recoveryTimeFactorPercent ?? 0,
          loadFactor: r.acwrFactorPercent ?? 0,
          stressFactor: r.stressHistoryFactorPercent ?? 0,
        });
      } catch {
        // Some days may not have data
      }
    }
    return results.reverse();
  },

  async sleep(days) {
    const displayName = await getDisplayName();
    const results: SleepData[] = [];
    for (let i = 0; i < days; i++) {
      const date = dateStr(i);
      try {
        const raw = await apiGet<any>(
          `/wellness-service/wellness/dailySleepData/${displayName}`,
          { date, nonSleepBufferMinutes: "60" },
        );
        if (!raw || !raw.dailySleepDTO) continue;
        const s = raw.dailySleepDTO;
        results.push({
          date: s.calendarDate ?? date,
          score: s.sleepScores?.overall?.value ?? null,
          totalSeconds: s.sleepTimeSeconds ?? 0,
          remSeconds: s.remSleepSeconds ?? 0,
          deepSeconds: s.deepSleepSeconds ?? 0,
          lightSeconds: s.lightSleepSeconds ?? 0,
          awakeSeconds: s.awakeSleepSeconds ?? 0,
        });
      } catch {
        // Skip missing days
      }
    }
    return results.reverse();
  },

  async heartRate(days) {
    const displayName = await getDisplayName();
    const results: HeartRate[] = [];
    for (let i = 0; i < days; i++) {
      const date = dateStr(i);
      try {
        const raw = await apiGet<any>(
          `/wellness-service/wellness/dailyHeartRate/${displayName}`,
          { date },
        );
        if (!raw) continue;
        results.push({
          date: raw.calendarDate ?? date,
          restingHr: raw.restingHeartRate ?? null,
          minHr: raw.minHeartRate ?? null,
          maxHr: raw.maxHeartRate ?? null,
          avgRhr7d: raw.lastSevenDaysAvgRestingHeartRate ?? null,
        });
      } catch {
        // Skip
      }
    }
    return results.reverse();
  },

  async recentHr() {
    const displayName = await getDisplayName();
    // Try today first, then yesterday — the watch may not have synced today yet.
    for (const daysAgo of [0, 1]) {
      const date = dateStr(daysAgo);
      try {
        const raw = await apiGet<any>(
          `/wellness-service/wellness/dailyHeartRate/${displayName}`,
          { date },
        );
        const values: [number, number | null][] = raw?.heartRateValues ?? [];
        // heartRateValues is [[unix_ms, bpm|null], ...] at ~120s granularity.
        // Walk backwards for the most recent non-null sample.
        for (let i = values.length - 1; i >= 0; i--) {
          const v = values[i];
          if (!v) continue;
          const [ts, bpm] = v;
          if (bpm != null && Number.isFinite(bpm) && bpm > 0) {
            const lagMs = Date.now() - ts;
            return {
              bpm,
              timestamp: new Date(ts).toISOString(),
              lagMinutes: Math.round((lagMs / 60000) * 10) / 10,
            };
          }
        }
      } catch {
        // Try next day
      }
    }
    return null;
  },

  async hrv(days) {
    const results: HrvData[] = [];
    for (let i = 0; i < days; i++) {
      const date = dateStr(i);
      try {
        const raw = await apiGet<any>(`/hrv-service/hrv/${date}`);
        if (!raw || !raw.hrvSummary) continue;
        const h = raw.hrvSummary;
        results.push({
          date: h.calendarDate ?? date,
          lastNightAvg: h.lastNightAvg ?? null,
          weeklyAvg: h.weeklyAvg ?? null,
          lastNight5MinHigh: h.lastNight5MinHigh ?? null,
          baselineLow: h.baseline?.lowUpper ?? null,
          baselineBalancedLow: h.baseline?.balancedLow ?? null,
          baselineBalancedHigh: h.baseline?.balancedUpper ?? null,
          status: h.status ?? null,
        });
      } catch {
        // Skip
      }
    }
    return results.reverse();
  },

  async stress(days) {
    const displayName = await getDisplayName();
    const results: StressData[] = [];
    for (let i = 0; i < days; i++) {
      const date = dateStr(i);
      try {
        const raw = await apiGet<any>(
          `/usersummary-service/usersummary/daily/${displayName}`,
          { calendarDate: date },
        );
        if (!raw) continue;
        results.push({
          date: raw.calendarDate ?? date,
          avgStress: raw.averageStressLevel ?? null,
          maxStress: raw.maxStressLevel ?? null,
          qualifier: raw.stressQualifier ?? null,
        });
      } catch {
        // Skip
      }
    }
    return results.reverse();
  },

  async bodyBattery(days) {
    const start = dateStr(days - 1);
    const end = today();
    try {
      const raw = await apiGet<any[]>(
        "/wellness-service/wellness/bodyBattery/reports/daily",
        { startDate: start, endDate: end },
      );
      if (!raw || !Array.isArray(raw)) return [];
      return raw.map((r) => {
        const vals: number[] = (r.bodyBatteryValuesArray ?? []).map((v: number[]) => v[1]);
        return {
          date: r.calendarDate ?? r.date ?? "",
          charged: r.charged ?? null,
          drained: r.drained ?? null,
          highest: vals.length ? Math.max(...vals) : null,
          lowest: vals.length ? Math.min(...vals) : null,
          atWake: null,
        };
      }).sort((a, b) => a.date.localeCompare(b.date));
    } catch {
      return [];
    }
  },

  async steps(days) {
    const displayName = await getDisplayName();
    const results: StepData[] = [];
    for (let i = 0; i < days; i++) {
      const date = dateStr(i);
      try {
        const raw = await apiGet<any>(
          `/usersummary-service/usersummary/daily/${displayName}`,
          { calendarDate: date },
        );
        if (!raw) continue;
        results.push({
          date: raw.calendarDate ?? date,
          totalSteps: raw.totalSteps ?? 0,
          distanceMeters: raw.totalDistanceMeters ?? 0,
          stepGoal: raw.dailyStepGoal ?? 0,
          floorsAscended: raw.floorsAscended ?? 0,
        });
      } catch {
        // Skip
      }
    }
    return results.reverse();
  },

  async activities(days) {
    const start = dateStr(days - 1);
    try {
      const raw = await apiGet<any[]>(
        "/activitylist-service/activities/search/activities",
        { start: "0", limit: "50", startDate: start, endDate: today() },
      );
      if (!raw || !Array.isArray(raw)) return [];
      return raw.map((a) => ({
        date: (a.startTimeLocal ?? a.startTimeGMT ?? "").slice(0, 10),
        name: a.activityName ?? "Unknown",
        type: a.activityType?.typeKey ?? "unknown",
        durationSeconds: a.duration ?? 0,
        distanceMeters: a.distance ?? null,
        avgHr: a.averageHR ?? null,
        maxHr: a.maxHR ?? null,
        calories: a.calories ?? null,
        activityId: a.activityId ?? null,
        elevationGain: a.elevationGain ?? null,
        avgRunCadence: a.averageRunningCadenceInStepsPerMinute ?? null,
        aerobicEffect: a.aerobicTrainingEffect ?? null,
        anaerobicEffect: a.anaerobicTrainingEffect ?? null,
        vo2MaxValue: a.vO2MaxValue ?? null,
      })).sort((a, b) => a.date.localeCompare(b.date));
    } catch {
      return [];
    }
  },

  async daily(days) {
    const displayName = await getDisplayName();
    const results: DailySummary[] = [];
    for (let i = 0; i < days; i++) {
      const date = dateStr(i);
      try {
        const raw = await apiGet<any>(
          `/usersummary-service/usersummary/daily/${displayName}`,
          { calendarDate: date },
        );
        if (!raw) continue;
        results.push({
          date: raw.calendarDate ?? date,
          totalSteps: raw.totalSteps ?? 0,
          distanceMeters: raw.totalDistanceMeters ?? 0,
          activeKcal: raw.activeKilocalories ?? 0,
          restingHr: raw.restingHeartRate ?? null,
          minHr: raw.minHeartRate ?? null,
          maxHr: raw.maxHeartRate ?? null,
          avgStress: raw.averageStressLevel ?? null,
          bbAtWake: raw.bodyBatteryAtWakeTime ?? null,
          floorsAscended: raw.floorsAscended ?? 0,
        });
      } catch {
        // Skip
      }
    }
    return results.reverse();
  },

  // ── Tier 1: New data endpoints ────────────────────────────────

  async vo2max(days) {
    const start = dateStr(days - 1);
    const end = today();
    try {
      const raw = await apiGet<any[]>(
        `/metrics-service/metrics/maxmet/daily/${start}/${end}`,
      );
      if (!raw || !Array.isArray(raw)) return [];
      return raw.map((r) => ({
        date: r.generic?.calendarDate ?? r.calendarDate ?? "",
        vo2MaxRunning: r.generic?.vo2MaxPreciseValue ?? null,
        vo2MaxCycling: r.cycling?.vo2MaxPreciseValue ?? null,
        generic: r.generic?.vo2MaxPreciseValue ?? null,
        fitnessAge: r.generic?.fitnessAge ?? null,
      })).sort((a, b) => a.date.localeCompare(b.date));
    } catch {
      return [];
    }
  },

  async spo2(days) {
    const results: Spo2Data[] = [];
    for (let i = 0; i < days; i++) {
      const date = dateStr(i);
      try {
        const raw = await apiGet<any>(
          `/wellness-service/wellness/daily/spo2/${date}`,
        );
        if (!raw) continue;
        results.push({
          date: raw.calendarDate ?? date,
          avgSpo2: raw.averageSpO2 ?? null,
          lowestSpo2: raw.lowestSpO2 ?? null,
          latestSpo2: raw.latestSpO2 ?? null,
        });
      } catch {
        // Skip — some days may not have SpO2 data
      }
    }
    return results.reverse();
  },

  async respiration(days) {
    const results: RespirationData[] = [];
    for (let i = 0; i < days; i++) {
      const date = dateStr(i);
      try {
        const raw = await apiGet<any>(
          `/wellness-service/wellness/daily/respiration/${date}`,
        );
        if (!raw) continue;
        results.push({
          date: raw.calendarDate ?? date,
          avgWaking: raw.avgWakingRespirationValue ?? null,
          avgSleeping: raw.avgSleepingRespirationValue ?? null,
          highest: raw.highestRespirationValue ?? null,
          lowest: raw.lowestRespirationValue ?? null,
        });
      } catch {
        // Skip
      }
    }
    return results.reverse();
  },

  async trainingStatus(days) {
    const results: TrainingStatus[] = [];
    for (let i = 0; i < days; i++) {
      const date = dateStr(i);
      try {
        const raw = await apiGet<any>(
          `/metrics-service/metrics/trainingstatus/aggregated/${date}`,
        );
        if (!raw) continue;

        // Extract training status from nested device map
        const statusMap = raw.mostRecentTrainingStatus?.latestTrainingStatusData ?? {};
        const statusEntry = Object.values(statusMap).find((e: any) => e.primaryTrainingDevice) ?? Object.values(statusMap)[0];
        const s = statusEntry as any;

        // Extract load balance from nested device map
        const loadMap = raw.mostRecentTrainingLoadBalance?.metricsTrainingLoadBalanceDTOMap ?? {};
        const loadEntry = Object.values(loadMap).find((e: any) => e.primaryTrainingDevice) ?? Object.values(loadMap)[0];
        const lb = loadEntry as any;

        const acuteDTO = s?.acuteTrainingLoadDTO;
        results.push({
          date: s?.calendarDate ?? date,
          trainingStatus: s?.trainingStatusFeedbackPhrase ?? (s?.trainingStatus != null ? String(s.trainingStatus) : null),
          loadFocus: lb?.trainingBalanceFeedbackPhrase ?? null,
          acuteLoad: acuteDTO?.dailyTrainingLoadAcute ?? null,
          chronicLoad: acuteDTO?.dailyTrainingLoadChronic ?? null,
          acwrPercent: acuteDTO?.dailyAcuteChronicWorkloadRatio ?? null,
          vo2Max: raw.mostRecentVO2Max?.generic?.vo2MaxPreciseValue ?? null,
        });
      } catch {
        // Skip
      }
    }
    return results.reverse();
  },

  async racePredictions() {
    try {
      const raw = await apiGet<any>("/metrics-service/metrics/racepredictions");
      if (!raw) return [];
      const preds = Array.isArray(raw) ? raw : raw.racePredictions ?? [];
      return preds.map((r: any) => ({
        distance: r.raceName ?? r.raceDistanceLabel ?? "unknown",
        predictedTime: r.predictedTime ?? fmtSec(r.predictedSeconds ?? r.racePredictionInSeconds ?? 0),
        predictedSeconds: r.predictedSeconds ?? r.racePredictionInSeconds ?? 0,
      }));
    } catch {
      return [];
    }
  },

  async weight(days) {
    const start = dateStr(days - 1);
    const end = today();
    try {
      const raw = await apiGet<any>(
        "/weight-service/weight/dateRange",
        { startDate: start, endDate: end },
      );
      if (!raw) return [];
      // API returns dateWeightList (flat entries) or dailyWeightSummaries (nested)
      const entries = raw.dateWeightList ?? raw.dailyWeightSummaries ?? [];
      if (!Array.isArray(entries)) return [];
      return entries
        .filter((e: any) => e.weight != null)
        .map((e: any) => {
          // dateWeightList: flat with weight in grams
          // dailyWeightSummaries: nested in allWeightMetrics[0]
          const m = e.allWeightMetrics?.[0] ?? e;
          return {
            date: e.calendarDate ?? e.summaryDate ?? "",
            weight: m.weight != null ? Math.round((m.weight / 1000) * 100) / 100 : null,
            bmi: m.bmi != null ? Math.round(m.bmi * 10) / 10 : null,
            bodyFat: m.bodyFat != null ? Math.round(m.bodyFat * 10) / 10 : null,
            muscleMass: m.muscleMass != null ? Math.round((m.muscleMass / 1000) * 100) / 100 : null,
            boneMass: m.boneMass != null ? Math.round((m.boneMass / 1000) * 100) / 100 : null,
            bodyWater: m.bodyWater != null ? Math.round(m.bodyWater * 10) / 10 : null,
          };
        })
        .sort((a: WeightEntry, b: WeightEntry) => a.date.localeCompare(b.date));
    } catch {
      return [];
    }
  },

  async fitnessAge() {
    try {
      const raw = await apiGet<any>(`/fitnessage-service/fitnessage/${today()}`);
      return {
        chronologicalAge: raw?.chronologicalAge ?? 0,
        fitnessAge: raw?.fitnessAge != null ? Math.round(raw.fitnessAge * 10) / 10 : null,
      };
    } catch {
      return { chronologicalAge: 0, fitnessAge: null };
    }
  },

  async intensityMinutes(days) {
    const displayName = await getDisplayName();
    const results: IntensityMinutes[] = [];
    for (let i = 0; i < days; i++) {
      const date = dateStr(i);
      try {
        const raw = await apiGet<any>(
          `/usersummary-service/usersummary/daily/${displayName}`,
          { calendarDate: date },
        );
        if (!raw) continue;
        const moderate = raw.moderateIntensityMinutes ?? 0;
        const vigorous = raw.vigorousIntensityMinutes ?? 0;
        results.push({
          date: raw.calendarDate ?? date,
          weeklyGoal: raw.intensityMinutesGoal ?? 150,
          moderate,
          vigorous,
          total: moderate + vigorous * 2, // vigorous counts double per WHO guidelines
        });
      } catch {
        // Skip
      }
    }
    return results.reverse();
  },

  async enduranceScore() {
    try {
      const raw = await apiGet<any>("/metrics-service/metrics/endurancescore");
      return {
        overall: raw?.overallScore ?? raw?.enduranceScore ?? null,
        classification: raw?.classification ?? raw?.enduranceScoreClassification ?? null,
      };
    } catch {
      return { overall: null, classification: null };
    }
  },

  // ── Tier 2: Activity detail endpoints ─────────────────────────

  async activityDetail(activityId) {
    const raw = await apiGet<any>(`/activity-service/activity/${activityId}`);
    const summary = raw.summaryDTO ?? raw;
    return {
      activityId: raw.activityId ?? activityId,
      name: raw.activityName ?? "Unknown",
      type: raw.activityType?.typeKey ?? raw.activityTypeDTO?.typeKey ?? "unknown",
      date: (raw.startTimeLocal ?? raw.startTimeGMT ?? "").slice(0, 10),
      durationSeconds: summary.duration ?? summary.elapsedDuration ?? 0,
      distanceMeters: summary.distance ?? null,
      elevationGain: summary.elevationGain ?? null,
      elevationLoss: summary.elevationLoss ?? null,
      avgHr: summary.averageHR ?? null,
      maxHr: summary.maxHR ?? null,
      avgRunCadence: summary.averageRunningCadenceInStepsPerMinute ?? null,
      maxRunCadence: summary.maxRunningCadenceInStepsPerMinute ?? null,
      avgSpeed: summary.averageSpeed ?? null,
      maxSpeed: summary.maxSpeed ?? null,
      calories: summary.calories ?? null,
      aerobicEffect: summary.aerobicTrainingEffect ?? null,
      anaerobicEffect: summary.anaerobicTrainingEffect ?? null,
      vo2Max: summary.vO2MaxValue ?? null,
      avgPower: summary.averagePower ?? null,
      maxPower: summary.maxPower ?? null,
      avgTemperature: summary.averageTemperature ?? null,
    };
  },

  async activitySplits(activityId) {
    const raw = await apiGet<any>(
      `/activity-service/activity/${activityId}/splits`,
    );
    const laps = raw?.lapDTOs ?? raw?.splitSummaries ?? [];
    if (!Array.isArray(laps)) return [];
    return laps.map((l: any, i: number) => ({
      index: i + 1,
      distanceMeters: l.distance ?? 0,
      durationSeconds: l.duration ?? l.movingDuration ?? 0,
      avgHr: l.averageHR ?? null,
      maxHr: l.maxHR ?? null,
      avgSpeed: l.averageSpeed ?? null,
      avgCadence: l.averageRunCadence ?? l.averageBikeCadence ?? null,
      elevationGain: l.elevationGain ?? null,
      elevationLoss: l.elevationLoss ?? null,
    }));
  },

  async activityHrZones(activityId) {
    const raw = await apiGet<any>(
      `/activity-service/activity/${activityId}/hrTimeInZones`,
    );
    const zones = Array.isArray(raw) ? raw : raw?.hrTimeInZones ?? raw?.zones ?? [];
    if (!Array.isArray(zones)) return [];
    // Sort by zone number to compute high boundaries from adjacent zones
    const sorted = [...zones].sort((a: any, b: any) => (a.zoneNumber ?? 0) - (b.zoneNumber ?? 0));
    return sorted.map((z: any, i: number) => ({
      zone: z.zoneNumber ?? z.zone ?? 0,
      zoneLow: z.zoneLowBoundary ?? z.zoneLow ?? 0,
      zoneHigh: i < sorted.length - 1
        ? (sorted[i + 1].zoneLowBoundary ?? sorted[i + 1].zoneLow ?? 0) - 1
        : 220, // max HR for last zone
      durationSeconds: z.secsInZone ?? z.duration ?? 0,
    }));
  },

  async personalRecords() {
    const displayName = await getDisplayName();
    const PR_TYPES: Record<number, string> = {
      1: "Fastest 1K", 2: "Fastest Mile", 3: "Fastest 5K",
      4: "Fastest 10K", 5: "Fastest Half", 6: "Fastest Marathon",
      7: "Farthest Run", 8: "Longest Ride", 9: "Longest Swim",
      12: "Most Steps (Day)", 13: "Most Steps (Week)", 14: "Most Steps (Month)",
    };
    try {
      const raw = await apiGet<any[]>(
        `/personalrecord-service/personalrecord/prs/${displayName}`,
      );
      if (!raw || !Array.isArray(raw)) return [];
      return raw.map((r) => {
        const typeId = r.typeId ?? 0;
        const dateStr = r.actStartDateTimeInGMTFormatted ?? r.prStartTimeGmtFormatted;
        return {
          type: PR_TYPES[typeId] ?? r.prTypeLabelKey ?? `Type ${typeId}`,
          typeId,
          value: r.value ?? null,
          date: dateStr ? dateStr.slice(0, 10) : null,
          activityName: r.activityName ?? null,
        };
      });
    } catch {
      return [];
    }
  },

  async gear() {
    const pk = await getProfilePk();
    try {
      const raw = await apiGet<any[]>(
        "/gear-service/gear/filterGear",
        { userProfilePk: String(pk) },
      );
      if (!raw || !Array.isArray(raw)) return [];
      return raw.map((g) => ({
        uuid: g.uuid ?? "",
        name: g.displayName ?? g.gearName ?? "Unknown",
        type: g.gearTypeName ?? g.gearType ?? "unknown",
        distanceMeters: g.totalDistance ?? 0,
        activities: g.totalActivities ?? 0,
        maxDistanceMeters: g.maximumMeters ?? null,
        createDate: g.dateBegin ?? g.createDate ?? "",
      }));
    } catch {
      return [];
    }
  },

  // ── Raw JSON ──────────────────────────────────────────────────

  async json(path, params) {
    return apiGet(path, params);
  },
};
