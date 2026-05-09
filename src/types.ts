/** Provider-agnostic types for the cadence CLI */

export interface TrainingReadiness {
  date: string;
  score: number;
  level: string;
  sleepScore: number;
  hrvFactor: number;
  recoveryFactor: number;
  loadFactor: number;
  stressFactor: number;
}

export interface SleepData {
  date: string;
  score: number | null;
  totalSeconds: number;
  remSeconds: number;
  deepSeconds: number;
  lightSeconds: number;
  awakeSeconds: number;
}

export interface HeartRate {
  date: string;
  restingHr: number | null;
  minHr: number | null;
  maxHr: number | null;
  avgRhr7d: number | null;
}

export interface HrvData {
  date: string;
  lastNightAvg: number | null;
  weeklyAvg: number | null;
  lastNight5MinHigh: number | null;
  baselineLow: number | null;
  baselineBalancedLow: number | null;
  baselineBalancedHigh: number | null;
  status: string | null;
}

export interface StressData {
  date: string;
  avgStress: number | null;
  maxStress: number | null;
  qualifier: string | null;
}

export interface BodyBattery {
  date: string;
  charged: number | null;
  drained: number | null;
  highest: number | null;
  lowest: number | null;
  atWake: number | null;
}

export interface StepData {
  date: string;
  totalSteps: number;
  distanceMeters: number;
  stepGoal: number;
  floorsAscended: number;
}

export interface Activity {
  date: string;
  name: string;
  type: string;
  durationSeconds: number;
  distanceMeters: number | null;
  avgHr: number | null;
  maxHr: number | null;
  calories: number | null;
  activityId: number | null;
  elevationGain: number | null;
  avgRunCadence: number | null;
  aerobicEffect: number | null;
  anaerobicEffect: number | null;
  vo2MaxValue: number | null;
}

export interface DailySummary {
  date: string;
  totalSteps: number;
  distanceMeters: number;
  activeKcal: number;
  restingHr: number | null;
  minHr: number | null;
  maxHr: number | null;
  avgStress: number | null;
  bbAtWake: number | null;
  floorsAscended: number;
}

// ── Tier 1: New data types ──────────────────────────────────────

export interface Vo2Max {
  date: string;
  vo2MaxRunning: number | null;
  vo2MaxCycling: number | null;
  generic: number | null;
  fitnessAge: number | null;
}

export interface Spo2Data {
  date: string;
  avgSpo2: number | null;
  lowestSpo2: number | null;
  latestSpo2: number | null;
}

export interface RespirationData {
  date: string;
  avgWaking: number | null;
  avgSleeping: number | null;
  highest: number | null;
  lowest: number | null;
}

export interface TrainingStatus {
  date: string;
  trainingStatus: string | null;
  loadFocus: string | null;
  acuteLoad: number | null;
  chronicLoad: number | null;
  acwrPercent: number | null;
  vo2Max: number | null;
}

export interface RacePrediction {
  distance: string;
  predictedTime: string;
  predictedSeconds: number;
}

export interface WeightEntry {
  date: string;
  weight: number | null;
  bmi: number | null;
  bodyFat: number | null;
  muscleMass: number | null;
  boneMass: number | null;
  bodyWater: number | null;
}

export interface FitnessAge {
  chronologicalAge: number;
  fitnessAge: number | null;
}

export interface IntensityMinutes {
  date: string;
  weeklyGoal: number;
  moderate: number;
  vigorous: number;
  total: number;
}

export interface EnduranceScore {
  overall: number | null;
  classification: string | null;
}

// ── Tier 2: Activity detail types ───────────────────────────────

export interface ActivityDetail {
  activityId: number;
  name: string;
  type: string;
  date: string;
  durationSeconds: number;
  distanceMeters: number | null;
  elevationGain: number | null;
  elevationLoss: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgRunCadence: number | null;
  maxRunCadence: number | null;
  avgSpeed: number | null;
  maxSpeed: number | null;
  calories: number | null;
  aerobicEffect: number | null;
  anaerobicEffect: number | null;
  vo2Max: number | null;
  avgPower: number | null;
  maxPower: number | null;
  avgTemperature: number | null;
}

export interface ActivitySplit {
  index: number;
  distanceMeters: number;
  durationSeconds: number;
  avgHr: number | null;
  maxHr: number | null;
  avgSpeed: number | null;
  avgCadence: number | null;
  elevationGain: number | null;
  elevationLoss: number | null;
}

export interface ActivityHrZone {
  zone: number;
  zoneLow: number;
  zoneHigh: number;
  durationSeconds: number;
}

export interface PersonalRecord {
  type: string;
  typeId: number;
  value: number | null;
  date: string | null;
  activityName: string | null;
}

export interface GearItem {
  uuid: string;
  name: string;
  type: string;
  distanceMeters: number;
  activities: number;
  maxDistanceMeters: number | null;
  createDate: string;
}

/** Every fitness data provider must implement this interface */
export interface FitnessProvider {
  name: string;

  // Existing
  trainingReadiness(days: number): Promise<TrainingReadiness[]>;
  sleep(days: number): Promise<SleepData[]>;
  heartRate(days: number): Promise<HeartRate[]>;
  hrv(days: number): Promise<HrvData[]>;
  stress(days: number): Promise<StressData[]>;
  bodyBattery(days: number): Promise<BodyBattery[]>;
  steps(days: number): Promise<StepData[]>;
  activities(days: number): Promise<Activity[]>;
  daily(days: number): Promise<DailySummary[]>;

  // Tier 1
  vo2max(days: number): Promise<Vo2Max[]>;
  spo2(days: number): Promise<Spo2Data[]>;
  respiration(days: number): Promise<RespirationData[]>;
  trainingStatus(days: number): Promise<TrainingStatus[]>;
  racePredictions(): Promise<RacePrediction[]>;
  weight(days: number): Promise<WeightEntry[]>;
  fitnessAge(): Promise<FitnessAge>;
  intensityMinutes(days: number): Promise<IntensityMinutes[]>;
  enduranceScore(): Promise<EnduranceScore>;

  // Tier 2
  activityDetail(activityId: number): Promise<ActivityDetail>;
  activitySplits(activityId: number): Promise<ActivitySplit[]>;
  activityHrZones(activityId: number): Promise<ActivityHrZone[]>;
  personalRecords(): Promise<PersonalRecord[]>;
  gear(): Promise<GearItem[]>;

  // Raw
  json(path: string, params?: Record<string, string>): Promise<unknown>;
}
