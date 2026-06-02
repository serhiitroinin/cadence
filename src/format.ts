/** Pure display formatters for cadence. No I/O — safe to unit test. */

const DASH = "—";

export function secToH(s: number): string {
  const h = Math.round((s / 3600) * 10) / 10;
  return `${h}h`;
}

export function secToMin(s: number): string {
  return `${Math.round(s / 60)} min`;
}

export function secToHMS(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function km(meters: number | null): string {
  if (meters == null) return DASH;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function n(v: number | null, decimals = 0): string {
  if (v == null) return DASH;
  return decimals > 0 ? v.toFixed(decimals) : String(Math.round(v));
}

/** Convert m/s to running pace (min:sec per km). */
export function mps(speed: number | null): string {
  if (speed == null) return DASH;
  if (speed <= 0) return DASH;
  const paceSeconds = 1000 / speed;
  const m = Math.floor(paceSeconds / 60);
  const s = Math.floor(paceSeconds % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}
