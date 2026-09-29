/**
 * Simulation clock. Real time by default; can run faster, backwards, paused,
 * or be set to any instant. All consumers read `now()` once per frame.
 */
export type TimeListener = (t: TimeController) => void;

export const RATE_STEPS = [
  -604800, -86400, -3600, -600, -60, -10, -1, 0, 1, 10, 60, 600, 3600, 86400, 604800,
];

export class TimeController {
  /** Simulated seconds per real second. */
  rate = 1;
  private anchorReal = performance.now();
  private anchorSim = Date.now();
  private listeners = new Set<TimeListener>();

  now(): Date {
    return new Date(this.nowMs());
  }

  nowMs(): number {
    return this.anchorSim + (performance.now() - this.anchorReal) * this.rate;
  }

  get paused(): boolean {
    return this.rate === 0;
  }

  /** True when showing the present moment at normal speed. */
  get isLive(): boolean {
    return this.rate === 1 && Math.abs(this.nowMs() - Date.now()) < 5000;
  }

  private reanchor(): void {
    this.anchorSim = this.nowMs();
    this.anchorReal = performance.now();
  }

  setRate(rate: number): void {
    this.reanchor();
    this.rate = rate;
    this.emit();
  }

  togglePause(): void {
    this.setRate(this.rate === 0 ? 1 : 0);
  }

  setTime(date: Date | number): void {
    this.anchorSim = typeof date === 'number' ? date : date.getTime();
    this.anchorReal = performance.now();
    this.emit();
  }

  shift(ms: number): void {
    this.setTime(this.nowMs() + ms);
  }

  resetToNow(): void {
    this.rate = 1;
    this.setTime(Date.now());
  }

  stepRate(dir: 1 | -1): void {
    let i = RATE_STEPS.findIndex((r) => r >= this.rate);
    if (i < 0) i = RATE_STEPS.length - 1;
    if (RATE_STEPS[i] !== this.rate && dir < 0) i -= 1;
    const next = RATE_STEPS[Math.max(0, Math.min(RATE_STEPS.length - 1, i + dir))];
    this.setRate(next);
  }

  onChange(fn: TimeListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const l of this.listeners) l(this);
  }
}

export function describeRate(rate: number): string {
  if (rate === 0) return 'Paused';
  if (rate === 1) return 'Real time';
  const abs = Math.abs(rate);
  const sign = rate < 0 ? '−' : '';
  const units: [number, string][] = [
    [31557600, 'yr'],
    [2629800, 'mo'],
    [604800, 'wk'],
    [86400, 'day'],
    [3600, 'hr'],
    [60, 'min'],
  ];
  for (const [s, u] of units) {
    if (abs >= s) {
      const v = abs / s;
      return `${sign}${v >= 10 || Number.isInteger(v) ? Math.round(v) : v.toFixed(1)} ${u}/s`;
    }
  }
  return `${sign}${Math.round(abs)}×`;
}
