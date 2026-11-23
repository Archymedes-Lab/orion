"use client";
// One short status line for the whole workspace ("Link copied"), shown by the shell so any component can raise it.
import { useSyncExternalStore } from "react";

let current: { text: string; at: number } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(text: string) { current = { text, at: Date.now() }; emit(); }
export function clearToast() { current = null; emit(); }
export function useToast() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => current, () => null);
}
