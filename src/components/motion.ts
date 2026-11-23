// anime.js (v4) on web: one scope per component, rooted at a View's DOM node and reverted on unmount or when its
// inputs change, as anime.js recommends for React (createScope + revert). Native builds and people who ask for
// reduced motion get the static picture.
import { useEffect, useRef, type DependencyList, type RefObject } from "react";
import { Platform, View } from "react-native";
import { createScope, type Scope } from "animejs";
import { useReducedMotion } from "./ui";

const web = Platform.OS === "web";

/**
 * Runs `build` inside an anime.js scope rooted at `root`, so selectors in it only match that subtree.
 * Re-runs (after reverting the last run) whenever `deps` change.
 */
export function useAnime(root: RefObject<View | null>, build: (scope?: Scope) => void, deps: DependencyList) {
  const reduced = useReducedMotion();
  const scope = useRef<Scope | null>(null);
  useEffect(() => {
    if (!web || reduced || !root.current) return;
    // On web a View's ref is its DOM element.
    scope.current = createScope({ root: root.current as unknown as HTMLElement }).add(build);
    return () => { scope.current?.revert(); scope.current = null; };
  }, [reduced, ...deps]); // callers pass the inputs `build` depends on
}

/** A class name on a react-native-svg element (passed straight to the DOM on web) for anime.js to select. */
export const tag = (name: string) => (web ? { className: name } : {}) as object;
/** A data attribute on a View (react-native-web's dataSet) for anime.js to select. */
export const mark = (name: string) => (web ? { dataSet: { am: name } } : {}) as object;
