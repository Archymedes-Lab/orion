// Memoization cache for expensive computations.
// A small LRU cache with a time-to-live for deterministic engine results.
import { getLocale } from "../i18n/index.ts";
import type { ScenarioResult, SensitivityResult } from "../types.ts";
import type { RobustnessResult } from "./robustness.ts";
import type { ConfidenceResult } from "./confidence.ts";

export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  hits: number;
}

export class ComputationCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private maxSize: number;
  private ttl: number;

  constructor(maxSize = 100, ttlMs = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.ttl = ttlMs;
  }

  // Results carry wording, so the language is part of every key.
  get(args: unknown[]): T | undefined {
    const key = JSON.stringify([getLocale(), ...args]);
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return undefined;
    }

    entry.hits++;
    return entry.value;
  }

  set(args: unknown[], value: T): void {
    const key = JSON.stringify([getLocale(), ...args]);

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      let oldestKey = "";
      let oldestTime = Infinity;
      for (const [k, v] of this.cache.entries()) {
        if (v.timestamp < oldestTime) {
          oldestTime = v.timestamp;
          oldestKey = k;
        }
      }
      if (oldestKey) this.cache.delete(oldestKey);
    }

    this.cache.set(key, { value, timestamp: Date.now(), hits: 0 });
  }

  clear(): void {
    this.cache.clear();
  }

  stats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      entries: Array.from(this.cache.entries()).map(([k, v]) => ({
        key: k,
        hits: v.hits,
        age: Date.now() - v.timestamp,
      })),
    };
  }
}

// Shared instances for the expensive deterministic computations.
export const robustnessCache = new ComputationCache<RobustnessResult>(50, 10 * 60 * 1000);
export const confidenceCache = new ComputationCache<ConfidenceResult>(50, 10 * 60 * 1000);
export const scenariosCache = new ComputationCache<ScenarioResult>(50, 10 * 60 * 1000);
export const sensitivityCache = new ComputationCache<SensitivityResult>(50, 10 * 60 * 1000);

/**
 * Deterministic key from the decision state: option/factor signatures plus the
 * stakes and ceremony mode that shape the analysis. Stable across re-renders so
 * cached results are reused until the working set actually changes.
 */
export function makeDecisionKey(
  options: { id: string; label: string; outcomes: unknown[] }[],
  factors: { id: string; label: string; weight: number }[],
  stakes: string,
  mode: string
): string {
  const optionSigs = options.map((o) => `${o.id}:${o.label}:${o.outcomes.length}`).sort().join("|");
  const factorSigs = factors.map((f) => `${f.id}:${f.label}:${f.weight}`).sort().join("|");
  return `${stakes}:${mode}:${optionSigs}:${factorSigs}`;
}

/** Memoizing wrapper: same inputs hit the cache, changing inputs call `fn`. */
export function withCache<TArgs extends unknown[], TValue>(
  fn: (...args: TArgs) => TValue,
  cache: ComputationCache<TValue>,
  keyFn: (...args: TArgs) => string
): (...args: TArgs) => TValue {
  return (...args: TArgs) => {
    const key = keyFn(...args);
    const cached = cache.get([key]);
    if (cached !== undefined) return cached;
    const result = fn(...args);
    cache.set([key], result);
    return result;
  };
}