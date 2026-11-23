// Extended decision state: constraints, evidence, assumptions, criteria,
// unknowns and saved what-if scenarios.
//
// SQLite is the source of truth; this holds the loaded working set plus the
// writes the UI issues. Every write goes through `db.transaction` so a failure
// part-way through leaves no orphaned rows, matching how `session.commit`
// already behaves. Reads filter in JS because the memory fallback in
// `db/database.ts` ignores SQL `WHERE` clauses.
import { create } from "zustand";
import { uid } from "../decision-engine/normalize.ts";
import { t } from "../i18n/index.ts";
import { db } from "../db/database.ts";
import type {
  Assumption,
  Constraint,
  ConstraintType,
  Criterion,
  CriterionDirection,
  DecisionScenario,
  Evidence,
  EvidenceType,
  Unknown,
  UnknownImpact,
} from "../types.ts";

type Row = Record<string, unknown>;

export const TABLES = [
  "constraints",
  "evidence",
  "assumptions",
  "criteria",
  "unknowns",
  "decision_scenarios",
] as const;

export interface DecisionBundle {
  constraints: Constraint[];
  evidence: Evidence[];
  assumptions: Assumption[];
  criteria: Criterion[];
  unknowns: Unknown[];
  scenarios: DecisionScenario[];
}

const emptyBundle = (): DecisionBundle => ({
  constraints: [],
  evidence: [],
  assumptions: [],
  criteria: [],
  unknowns: [],
  scenarios: [],
});

export interface ExtendedDecisionState extends DecisionBundle {
  decisionId: string | null;
  loading: boolean;
  error: string | null;
  loadForDecision: (decisionId: string) => Promise<void>;
  clear: () => void;
  addConstraint: (decisionId: string, c: NewConstraint) => Promise<void>;
  removeConstraint: (id: string) => Promise<void>;
  addEvidence: (decisionId: string, e: NewEvidence) => Promise<void>;
  removeEvidence: (id: string) => Promise<void>;
  addAssumption: (decisionId: string, a: NewAssumption) => Promise<void>;
  removeAssumption: (id: string) => Promise<void>;
  addCriterion: (decisionId: string, c: NewCriterion) => Promise<void>;
  removeCriterion: (id: string) => Promise<void>;
  addUnknown: (decisionId: string, u: NewUnknown) => Promise<void>;
  /**
   * Replaces the open-questions list for a decision with the model's current
   * one. Questions already answered or removed by the user are kept as-is, so
   * recomputing the model never discards a resolution.
   */
  recordUnknowns: (
    decisionId: string,
    unknowns: Pick<Unknown, "question" | "importance" | "estimatedImpact">[]
  ) => Promise<void>;
  resolveUnknown: (id: string, resolution?: string) => Promise<void>;
  removeUnknown: (id: string) => Promise<void>;
  addScenario: (decisionId: string, s: NewScenario) => Promise<void>;
  removeScenario: (id: string) => Promise<void>;
}

export type NewConstraint = Omit<Constraint, "id">;
export type NewEvidence = Omit<Evidence, "id">;
export type NewAssumption = Omit<Assumption, "id">;
export type NewCriterion = Omit<Criterion, "id">;
export type NewUnknown = Omit<Unknown, "id">;
export type NewScenario = Omit<DecisionScenario, "id">;

// --- row mapping. Unknown columns degrade to a default instead of throwing,
// so a schema addition never breaks reading an older database. ---------------

const str = (v: unknown, fallback = ""): string => (v === null || v === undefined ? fallback : String(v));
const optStr = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : String(v));
const num = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const clamp01 = (v: unknown, fallback: number): number => Math.max(0, Math.min(1, num(v, fallback)));

const CONSTRAINT_TYPES: ConstraintType[] = ["HARD", "SOFT", "PREFERENCE"];
const EVIDENCE_TYPES: EvidenceType[] = [
  "USER_PROVIDED",
  "DOCUMENT",
  "LINK",
  "NOTE",
  "CALCULATION",
  "FACT",
  "ASSUMPTION",
];
const DIRECTIONS: CriterionDirection[] = ["MAXIMIZE", "MINIMIZE", "NEUTRAL"];
const IMPACTS: UnknownImpact[] = ["low", "medium", "high"];

const oneOf = <T extends string>(v: unknown, allowed: T[], fallback: T): T =>
  (allowed as string[]).includes(String(v)) ? (String(v) as T) : fallback;

const toConstraint = (r: Row): Constraint => ({
  id: str(r.id),
  decisionId: optStr(r.decision_id),
  name: str(r.name),
  description: optStr(r.description),
  type: oneOf(r.type, CONSTRAINT_TYPES, "SOFT"),
  severity: oneOf(r.severity, SEVERITIES, "medium"),
  value: optStr(r.value),
  unit: optStr(r.unit),
  optionIds: parseIds(r.option_ids),
  subject: optStr(r.subject),
  operator: optStr(r.operator) as Constraint["operator"],
  numericValue: r.numeric_value === null || r.numeric_value === undefined ? undefined : num(r.numeric_value, 0),
  penalty: r.penalty === null || r.penalty === undefined ? undefined : num(r.penalty, 0),
});

const toEvidence = (r: Row): Evidence => ({
  id: str(r.id),
  decisionId: optStr(r.decision_id),
  type: oneOf(r.type, EVIDENCE_TYPES, "NOTE"),
  title: optStr(r.title),
  content: str(r.content),
  source: optStr(r.source),
  reliability: clamp01(r.reliability, 0.8),
  relevance: clamp01(r.relevance, 0.8),
});

const toAssumption = (r: Row): Assumption => ({
  id: str(r.id),
  decisionId: optStr(r.decision_id),
  statement: str(r.statement),
  confidence: clamp01(r.confidence, 0.7),
  source: optStr(r.source),
});

const toCriterion = (r: Row): Criterion => ({
  id: str(r.id),
  decisionId: optStr(r.decision_id),
  name: str(r.name),
  description: optStr(r.description),
  importance: clamp01(r.importance, 0.5),
  weight: clamp01(r.weight, 0.5),
  direction: oneOf(r.direction, DIRECTIONS, "MAXIMIZE"),
});

const toUnknown = (r: Row): Unknown => ({
  id: str(r.id),
  decisionId: optStr(r.decision_id),
  question: str(r.question),
  importance: oneOf(r.importance, IMPACTS, "medium"),
  estimatedImpact: num(r.estimated_impact, 0),
  resolved: num(r.resolved, 0) === 1,
  resolution: optStr(r.resolution),
});

const toScenario = (r: Row): DecisionScenario => ({
  id: str(r.id),
  decisionId: optStr(r.decision_id),
  name: str(r.name),
  description: optStr(r.description),
  changes: str(r.changes),
  leaderOptionId: optStr(r.leader_option_id) ?? null,
  explanation: optStr(r.explanation) ?? null,
});

/** Stored option lists are JSON arrays; tolerate null/empty/malformed. */
function parseIds(v: unknown): string[] | undefined {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) return v.map((x) => String(x));
  try {
    const parsed: unknown = JSON.parse(String(v));
    return Array.isArray(parsed) ? parsed.map((x) => String(x)) : undefined;
  } catch {
    return undefined;
  }
}

type ConstraintSeverityName = "low" | "medium" | "high" | "critical";

/** Severity names, exported for the constraint editor. */
export const SEVERITIES: ConstraintSeverityName[] = ["low", "medium", "high", "critical"];

export const useDecisionStore = create<ExtendedDecisionState>((set, get) => {
  /** One write, one transaction: either every row lands or none does. */
  const write = async <T extends string>(
    table: T,
    row: Row,
    optimistic: (bundle: DecisionBundle) => DecisionBundle
  ): Promise<void> => {
    const previous = get()[tableKey(table)];
    set({ [tableKey(table)]: optimistic(get()), error: null } as Partial<ExtendedDecisionState>);
    try {
      await db.init();
      await db.transaction([table], async (database) => {
        await database.insert(table, row);
      });
    } catch (e) {
      // Roll the in-memory copy back so the UI matches the database.
      set({ [tableKey(table)]: previous, error: message(e) } as Partial<ExtendedDecisionState>);
      throw e;
    }
  };

  const drop = async (table: string, id: string): Promise<void> => {
    await db.init();
    await db.transaction([table], async (database) => {
      const rows = await database.list(table);
      const keep = rows.filter((r) => str(r.id) !== id);
      await database.clearTable(table);
      for (const r of keep) await database.insert(table, r);
    });
  };

  return {
    ...emptyBundle(),
    decisionId: null,
    loading: false,
    error: null,

    loadForDecision: async (decisionId: string) => {
      set({ loading: true, error: null, decisionId });
      try {
        await db.init();
        const [constraintRows, evidenceRows, assumptionRows, criterionRows, unknownRows, scenarioRows] =
          await Promise.all(TABLES.map((table) => db.list(table)));

        const mine = (rows: Row[]) => rows.filter((r) => str(r.decision_id) === decisionId);
        set({
          constraints: mine(constraintRows).map(toConstraint),
          evidence: mine(evidenceRows).map(toEvidence),
          assumptions: mine(assumptionRows).map(toAssumption),
          criteria: mine(criterionRows).map(toCriterion),
          unknowns: mine(unknownRows).map(toUnknown),
          scenarios: mine(scenarioRows).map(toScenario),
          loading: false,
        });
      } catch (e) {
        set({ ...emptyBundle(), loading: false, error: message(e) });
      }
    },

    clear: () => set({ ...emptyBundle(), decisionId: null, error: null }),

    addConstraint: async (decisionId, c) => {
      const item: Constraint = { ...c, id: uid("con"), decisionId };
      await write("constraints", constraintRow(item), (bundle) => ({
        ...bundle,
        constraints: [...bundle.constraints, item],
      }));
    },
    removeConstraint: async (id) => {
      await drop("constraints", id);
      set((s) => ({ constraints: s.constraints.filter((c) => c.id !== id) }));
    },

    addEvidence: async (decisionId, e) => {
      const item: Evidence = {
        reliability: 0.8,
        relevance: 0.8,
        ...e,
        id: uid("evd"),
        decisionId,
      };
      await write("evidence", evidenceRow(item), (bundle) => ({
        ...bundle,
        evidence: [...bundle.evidence, item],
      }));
    },
    removeEvidence: async (id) => {
      await drop("evidence", id);
      set((s) => ({ evidence: s.evidence.filter((e) => e.id !== id) }));
    },

    addAssumption: async (decisionId, a) => {
      const item: Assumption = { confidence: 0.7, ...a, id: uid("asm"), decisionId };
      await write("assumptions", assumptionRow(item), (bundle) => ({
        ...bundle,
        assumptions: [...bundle.assumptions, item],
      }));
    },
    removeAssumption: async (id) => {
      await drop("assumptions", id);
      set((s) => ({ assumptions: s.assumptions.filter((a) => a.id !== id) }));
    },

    addCriterion: async (decisionId, c) => {
      const item: Criterion = {
        ...c,
        importance: c.importance ?? 0.5,
        weight: c.weight ?? 0.5,
        direction: c.direction ?? "MAXIMIZE",
        id: uid("cri"),
        decisionId,
      };
      await write("criteria", criterionRow(item), (bundle) => ({
        ...bundle,
        criteria: [...bundle.criteria, item],
      }));
    },
    removeCriterion: async (id) => {
      await drop("criteria", id);
      set((s) => ({ criteria: s.criteria.filter((c) => c.id !== id) }));
    },

    addUnknown: async (decisionId, u) => {
      const item: Unknown = { importance: "medium", estimatedImpact: 0, resolved: false, ...u, id: uid("unk"), decisionId };
      await write("unknowns", unknownRow(item), (bundle) => ({
        ...bundle,
        unknowns: [...bundle.unknowns, item],
      }));
    },
    recordUnknowns: async (decisionId, incoming) => {
    const bundle = get();
    // Keep anything already resolved or manually added for this decision.
    const kept = bundle.unknowns.filter((u) => u.decisionId !== decisionId || u.resolved);
    const seen = new Set(bundle.unknowns.map((u) => u.question));
    const fresh: Unknown[] = incoming
      .filter((u) => !seen.has(u.question))
      .map((u) => ({
        id: uid("unk"),
        decisionId,
        question: u.question,
        importance: u.importance,
        estimatedImpact: Number.isFinite(u.estimatedImpact) ? u.estimatedImpact : 0,
        resolved: false,
      }));
    if (fresh.length === 0) return;

    const previous = bundle.unknowns;
    set({ unknowns: [...kept, ...fresh], error: null });
    try {
      await db.init();
      await db.transaction(["unknowns"], async (database) => {
        for (const u of fresh) await database.insert("unknowns", unknownRow(u));
      });
    } catch (e) {
      set({
        unknowns: previous,
        error: e instanceof Error ? e.message : t("Could not save open questions."),
      });
    }
  },
  resolveUnknown: async (id, resolution) => {
      const existing = get().unknowns.find((u) => u.id === id);
      if (!existing) return;
      const updated: Unknown = { ...existing, resolved: true, resolution };
      await write("unknowns", unknownRow(updated), (bundle) => ({
        ...bundle,
        unknowns: bundle.unknowns.map((u) => (u.id === id ? updated : u)),
      }));
    },
    removeUnknown: async (id) => {
      await drop("unknowns", id);
      set((s) => ({ unknowns: s.unknowns.filter((u) => u.id !== id) }));
    },

    addScenario: async (decisionId, s) => {
      const item: DecisionScenario = { ...s, id: uid("scn"), decisionId };
      await write("decision_scenarios", scenarioRow(item), (bundle) => ({
        ...bundle,
        scenarios: [...bundle.scenarios, item],
      }));
    },
    removeScenario: async (id) => {
      await drop("decision_scenarios", id);
      set((s) => ({ scenarios: s.scenarios.filter((x) => x.id !== id) }));
    },
  };
});

// --- row builders ------------------------------------------------------------

const stamp = (decisionId?: string) => ({
  decision_id: decisionId ?? null,
  created_at: new Date().toISOString(),
});

function constraintRow(c: Constraint): Row {
  return {
    id: c.id,
    ...stamp(c.decisionId),
    name: c.name,
    description: c.description ?? null,
    type: c.type,
    severity: c.severity ?? "medium",
    value: c.value ?? null,
    unit: c.unit ?? null,
    option_ids: c.optionIds?.length ? JSON.stringify(c.optionIds) : null,
    subject: c.subject ?? null,
    operator: c.operator ?? null,
    numeric_value: c.numericValue ?? null,
    penalty: c.penalty ?? null,
  };
}

function evidenceRow(e: Evidence): Row {
  return {
    id: e.id,
    ...stamp(e.decisionId),
    type: e.type,
    title: e.title ?? null,
    content: e.content,
    source: e.source ?? null,
    reliability: e.reliability ?? 0.8,
    relevance: e.relevance ?? 0.8,
  };
}

function assumptionRow(a: Assumption): Row {
  return {
    id: a.id,
    ...stamp(a.decisionId),
    statement: a.statement,
    confidence: a.confidence ?? 0.7,
    source: a.source ?? null,
  };
}

function criterionRow(c: Criterion): Row {
  return {
    id: c.id,
    ...stamp(c.decisionId),
    name: c.name,
    description: c.description ?? null,
    importance: c.importance,
    weight: c.weight,
    direction: c.direction,
  };
}

function unknownRow(u: Unknown): Row {
  return {
    id: u.id,
    ...stamp(u.decisionId),
    question: u.question,
    importance: u.importance ?? "medium",
    estimated_impact: u.estimatedImpact ?? 0,
    resolved: u.resolved ? 1 : 0,
    resolution: u.resolution ?? null,
  };
}

function scenarioRow(s: DecisionScenario): Row {
  return {
    id: s.id,
    ...stamp(s.decisionId),
    name: s.name,
    description: s.description ?? null,
    changes: s.changes,
    leader_option_id: s.leaderOptionId ?? null,
    explanation: s.explanation ?? null,
  };
}

/** Map a bundle key to its table, for the transactional write helper. */
function tableKey(table: string): keyof DecisionBundle {
  switch (table) {
    case "constraints":
      return "constraints";
    case "evidence":
      return "evidence";
    case "assumptions":
      return "assumptions";
    case "criteria":
      return "criteria";
    case "unknowns":
      return "unknowns";
    default:
      return "scenarios";
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : t("Could not save.");
}