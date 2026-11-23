// The business lens and company profile on this device (see ./schema.ts for what the profile holds and why).
import { create } from "zustand";
import { db } from "../db/database.ts";
import { BusinessProfileSchema, type BusinessProfile } from "./schema.ts";

export * from "./schema.ts";

export type Lens = "personal" | "business";

const ROW = "business_profile";

interface BusinessState {
  lens: Lens;
  profile: BusinessProfile;
  loaded: boolean;
  load: () => Promise<void>;
  setLens: (lens: Lens) => Promise<void>;
  save: (profile: BusinessProfile) => Promise<void>;
  clear: () => Promise<void>;
}

async function write(lens: Lens, profile: BusinessProfile) {
  await db.init();
  await db.upsert("user_preferences", {
    id: ROW, user_id: "local", key: ROW, value: JSON.stringify({ lens, profile }), confidence: 1, source: "manual",
  });
}

export const useBusiness = create<BusinessState>((set, get) => ({
  lens: "personal",
  profile: {},
  loaded: false,
  load: async () => {
    try {
      await db.init();
      const row = await db.get("user_preferences", ROW);
      const raw = row ? JSON.parse(String(row.value)) as { lens?: unknown; profile?: unknown } : {};
      const profile = BusinessProfileSchema.safeParse(raw.profile ?? {});
      set({ lens: raw.lens === "business" ? "business" : "personal", profile: profile.success ? profile.data : {}, loaded: true });
    } catch { set({ loaded: true }); }
  },
  setLens: async (lens) => { set({ lens }); await write(lens, get().profile).catch(() => {}); },
  save: async (input) => {
    const profile = BusinessProfileSchema.parse(input);
    set({ profile });
    await write(get().lens, profile);
  },
  clear: async () => { set({ profile: {} }); await write(get().lens, {}).catch(() => {}); },
}));

/**
 * What to send with a request: the profile in business mode, an empty profile when the question itself was read as a
 * business decision, nothing otherwise.
 */
export function businessContext(category: readonly string[] = []): BusinessProfile | undefined {
  const { lens, profile } = useBusiness.getState();
  if (lens === "business") return profile;
  return category.includes("Business") ? {} : undefined;
}

