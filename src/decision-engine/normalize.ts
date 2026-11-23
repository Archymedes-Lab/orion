export function normalizeText(s: string): string {
  return s.trim().replace(/\s+/g, " ").slice(0, 500);
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function clamp10(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(-10, Math.min(10, n));
}

let counter = 0;
export function uid(prefix = "id"): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}`;
}
