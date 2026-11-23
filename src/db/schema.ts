// §36 schema. Primary data lives on device (expo-sqlite).
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  raw_input TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '["Everyday"]',
  stakes TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'open',
  selected_option_id TEXT,
  private_mode INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  resolved_at TEXT,
  decision_mode_type TEXT,
  early_warning_signals TEXT,
  robustness_level TEXT
);
CREATE TABLE IF NOT EXISTS options (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  jev_score REAL,
  reversibility REAL NOT NULL DEFAULT 0.5,
  generated INTEGER NOT NULL DEFAULT 0,
  rationale TEXT,
  risks TEXT,
  required_resources TEXT,
  opportunity_cost TEXT,
  reversibility_level TEXT,
  provenance TEXT,
  FOREIGN KEY (decision_id) REFERENCES decisions(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS decision_metadata (
  id TEXT PRIMARY KEY,
  safety TEXT NOT NULL DEFAULT 'normal',
  scoring_source TEXT NOT NULL DEFAULT 'none',
  mode TEXT,
  decision_mode_type TEXT
);
CREATE TABLE IF NOT EXISTS factors (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  label TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 0.5,
  provenance TEXT,
  source TEXT,
  pace TEXT,
  FOREIGN KEY (decision_id) REFERENCES decisions(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS option_factor_values (
  option_id TEXT NOT NULL,
  factor_id TEXT NOT NULL,
  value REAL NOT NULL DEFAULT 0,
  confidence REAL NOT NULL DEFAULT 0.5,
  PRIMARY KEY (option_id, factor_id)
);
CREATE TABLE IF NOT EXISTS outcomes (
  id TEXT PRIMARY KEY,
  option_id TEXT NOT NULL,
  label TEXT NOT NULL,
  probability REAL NOT NULL DEFAULT 0.5,
  confidence REAL NOT NULL DEFAULT 0.5,
  utility REAL,
  provenance TEXT,
  evidence_ids TEXT,
  FOREIGN KEY (option_id) REFERENCES options(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT,
  information_gain REAL DEFAULT 0,
  answered_at TEXT,
  FOREIGN KEY (decision_id) REFERENCES decisions(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS decision_results (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  leader_option_id TEXT,
  confidence REAL,
  stability TEXT,
  explanation TEXT,
  created_at TEXT NOT NULL,
  decision_confidence TEXT,
  confidence_factors TEXT,
  robustness_level TEXT,
  what_would_change TEXT
);
CREATE TABLE IF NOT EXISTS decision_outcomes (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  rating TEXT,
  notes TEXT,
  expected_outcome TEXT,
  actual_outcome TEXT,
  status TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS decision_choices (
  id TEXT PRIMARY KEY,
  chosen_option_id TEXT NOT NULL,
  leader_option_id TEXT,
  level TEXT NOT NULL,
  initial_level TEXT NOT NULL,
  gap REAL NOT NULL DEFAULT 0,
  certainty REAL NOT NULL DEFAULT 0,
  implied_factor TEXT,
  implied_from REAL,
  implied_to REAL,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS decision_followups (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'outcome',
  prompt TEXT,
  due_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  done_at TEXT,
  checkin_id TEXT,
  rating TEXT,
  checkin_notes TEXT
);
CREATE TABLE IF NOT EXISTS decision_shares (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL,
  owner_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'local',
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  confidence REAL DEFAULT 0.5,
  source TEXT DEFAULT 'manual'
);
CREATE TABLE IF NOT EXISTS constraints (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'SOFT',
  severity TEXT DEFAULT 'medium',
  value TEXT,
  unit TEXT,
  option_ids TEXT,
  subject TEXT,
  operator TEXT,
  numeric_value REAL,
  penalty REAL,
  created_at TEXT NOT NULL,
  provenance TEXT,
  FOREIGN KEY (decision_id) REFERENCES decisions(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'USER_PROVIDED',
  title TEXT,
  content TEXT NOT NULL,
  source TEXT,
  reliability REAL DEFAULT 0.8,
  relevance REAL DEFAULT 0.8,
  created_at TEXT NOT NULL,
  provenance TEXT,
  FOREIGN KEY (decision_id) REFERENCES decisions(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS assumptions (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  statement TEXT NOT NULL,
  confidence REAL DEFAULT 0.7,
  source TEXT,
  created_at TEXT NOT NULL,
  provenance TEXT,
  user_validated INTEGER DEFAULT 0,
  FOREIGN KEY (decision_id) REFERENCES decisions(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS unknowns (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  question TEXT NOT NULL,
  importance TEXT DEFAULT 'medium',
  estimated_impact REAL DEFAULT 0.5,
  resolved INTEGER DEFAULT 0,
  resolution TEXT,
  created_at TEXT NOT NULL,
  provenance TEXT,
  FOREIGN KEY (decision_id) REFERENCES decisions(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS criteria (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  importance REAL DEFAULT 0.5,
  weight REAL DEFAULT 0.5,
  direction TEXT DEFAULT 'MAXIMIZE',
  created_at TEXT NOT NULL,
  provenance TEXT,
  FOREIGN KEY (decision_id) REFERENCES decisions(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS decision_scenarios (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  changes TEXT NOT NULL,
  leader_option_id TEXT,
  explanation TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (decision_id) REFERENCES decisions(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS risks (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  option_id TEXT,
  description TEXT NOT NULL,
  likelihood TEXT NOT NULL DEFAULT 'medium',
  impact TEXT NOT NULL DEFAULT 'medium',
  mitigation TEXT,
  warning_signal TEXT,
  provenance TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (decision_id) REFERENCES decisions(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS decision_checkins (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  checkin_id TEXT NOT NULL,
  days INTEGER NOT NULL,
  due_at TEXT NOT NULL,
  prompt TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  completed_at TEXT,
  rating TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (decision_id) REFERENCES decisions(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS decision_records (
  id TEXT PRIMARY KEY,
  raw_input TEXT NOT NULL,
  extraction_json TEXT NOT NULL,
  chosen_option_id TEXT,
  recommended_option_id TEXT,
  against_recommendation INTEGER DEFAULT 0,
  scores_json TEXT,
  assumptions_json TEXT,
  evidence_json TEXT,
  constraints_json TEXT,
  early_warning_signals_json TEXT,
  decided_at TEXT NOT NULL,
  checkins_json TEXT,
  outcome_rating_json TEXT,
  lesson TEXT,
  status TEXT NOT NULL DEFAULT 'decided',
  created_at TEXT NOT NULL,
  updated_at TEXT
);
`;

/**
 * Additive migrations for databases created before a column existed.
 * SQLite has no `ADD COLUMN IF NOT EXISTS`, so each statement is attempted and a
 * duplicate-column error is treated as success. Every entry must be safe to
 * re-run: new columns are nullable or carry a default, so existing rows stay
 * valid and structured constraints degrade to "unresolvable" rather than
 * breaking the read path.
 */
export const MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  { table: "constraints", column: "unit", ddl: "ALTER TABLE constraints ADD COLUMN unit TEXT" },
  {
    table: "constraints",
    column: "option_ids",
    ddl: "ALTER TABLE constraints ADD COLUMN option_ids TEXT",
  },
  { table: "constraints", column: "subject", ddl: "ALTER TABLE constraints ADD COLUMN subject TEXT" },
  {
    table: "constraints",
    column: "operator",
    ddl: "ALTER TABLE constraints ADD COLUMN operator TEXT",
  },
  {
    table: "constraints",
    column: "numeric_value",
    ddl: "ALTER TABLE constraints ADD COLUMN numeric_value REAL",
  },
  { table: "constraints", column: "penalty", ddl: "ALTER TABLE constraints ADD COLUMN penalty REAL" },
  { table: "decision_metadata", column: "mode", ddl: "ALTER TABLE decision_metadata ADD COLUMN mode TEXT" },

  // New columns for enhanced decision model
  { table: "decisions", column: "decision_mode_type", ddl: "ALTER TABLE decisions ADD COLUMN decision_mode_type TEXT" },
  { table: "decisions", column: "early_warning_signals", ddl: "ALTER TABLE decisions ADD COLUMN early_warning_signals TEXT" },
  { table: "decisions", column: "robustness_level", ddl: "ALTER TABLE decisions ADD COLUMN robustness_level TEXT" },
  { table: "options", column: "generated", ddl: "ALTER TABLE options ADD COLUMN generated INTEGER NOT NULL DEFAULT 0" },
  { table: "options", column: "rationale", ddl: "ALTER TABLE options ADD COLUMN rationale TEXT" },
  { table: "options", column: "risks", ddl: "ALTER TABLE options ADD COLUMN risks TEXT" },
  { table: "options", column: "required_resources", ddl: "ALTER TABLE options ADD COLUMN required_resources TEXT" },
  { table: "options", column: "opportunity_cost", ddl: "ALTER TABLE options ADD COLUMN opportunity_cost TEXT" },
  { table: "options", column: "reversibility_level", ddl: "ALTER TABLE options ADD COLUMN reversibility_level TEXT" },
  { table: "options", column: "provenance", ddl: "ALTER TABLE options ADD COLUMN provenance TEXT" },
  { table: "decision_metadata", column: "decision_mode_type", ddl: "ALTER TABLE decision_metadata ADD COLUMN decision_mode_type TEXT" },
  { table: "factors", column: "provenance", ddl: "ALTER TABLE factors ADD COLUMN provenance TEXT" },
  { table: "factors", column: "source", ddl: "ALTER TABLE factors ADD COLUMN source TEXT" },
  { table: "factors", column: "pace", ddl: "ALTER TABLE factors ADD COLUMN pace TEXT" },
  { table: "outcomes", column: "provenance", ddl: "ALTER TABLE outcomes ADD COLUMN provenance TEXT" },
  { table: "outcomes", column: "evidence_ids", ddl: "ALTER TABLE outcomes ADD COLUMN evidence_ids TEXT" },
  { table: "decision_results", column: "decision_confidence", ddl: "ALTER TABLE decision_results ADD COLUMN decision_confidence TEXT" },
  { table: "decision_results", column: "confidence_factors", ddl: "ALTER TABLE decision_results ADD COLUMN confidence_factors TEXT" },
  { table: "decision_results", column: "robustness_level", ddl: "ALTER TABLE decision_results ADD COLUMN robustness_level TEXT" },
  { table: "decision_results", column: "what_would_change", ddl: "ALTER TABLE decision_results ADD COLUMN what_would_change TEXT" },
  { table: "constraints", column: "provenance", ddl: "ALTER TABLE constraints ADD COLUMN provenance TEXT" },
  { table: "evidence", column: "provenance", ddl: "ALTER TABLE evidence ADD COLUMN provenance TEXT" },
  { table: "assumptions", column: "provenance", ddl: "ALTER TABLE assumptions ADD COLUMN provenance TEXT" },
  { table: "assumptions", column: "user_validated", ddl: "ALTER TABLE assumptions ADD COLUMN user_validated INTEGER DEFAULT 0" },
  { table: "unknowns", column: "provenance", ddl: "ALTER TABLE unknowns ADD COLUMN provenance TEXT" },
  { table: "criteria", column: "provenance", ddl: "ALTER TABLE criteria ADD COLUMN provenance TEXT" },
  { table: "decision_followups", column: "checkin_id", ddl: "ALTER TABLE decision_followups ADD COLUMN checkin_id TEXT" },
  { table: "decision_followups", column: "rating", ddl: "ALTER TABLE decision_followups ADD COLUMN rating TEXT" },
  { table: "decision_followups", column: "checkin_notes", ddl: "ALTER TABLE decision_followups ADD COLUMN checkin_notes TEXT" },
];
