// Thin async wrapper so UI code doesn't touch expo-sqlite directly.
// On web / tests without expo-sqlite, falls back to an in-memory Map; in a
// browser that Map is mirrored to localStorage so history survives a reload.
import { MIGRATIONS, SCHEMA } from "./schema.ts";

type Row = Record<string, unknown>;
type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

const STORE_KEY = "orion.db.v1";
/** localStorage in a browser; null in tests, on native, or when the browser blocks it. */
function browserStorage(): KeyValueStore | null {
  try {
    return typeof document !== "undefined" && typeof localStorage !== "undefined" ? localStorage : null;
  } catch { return null; }
}

export class Database {
  private mem = new Map<string, Row[]>();
  private sqlite: unknown = null;
  private useMemory = true;
  private initializing: Promise<void> | null = null;
  /** >0 while a memory transaction runs: its writes are stored once, at the end. */
  private batching = 0;

  constructor(private readonly storage: KeyValueStore | null = browserStorage()) {}

  init(): Promise<void> {
    return this.initializing ??= this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      const mod = await import("expo-sqlite").catch(() => null);
      const open = (mod as { openDatabaseAsync?: (n: string) => Promise<unknown> })?.openDatabaseAsync;
      if (open) {
        this.sqlite = await open("orion.db");
        this.useMemory = false;
        const exec = (this.sqlite as { execAsync: (s: string) => Promise<void> }).execAsync.bind(
          this.sqlite
        );
        for (const stmt of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) {
          await exec(stmt + ";");
        }
        // Add columns introduced after a database was first created. A column
        // that is already present raises "duplicate column name", which is the
        // success case here.
        for (const migration of MIGRATIONS) {
          await exec(migration.ddl).catch((e: unknown) => {
            if (!/duplicate column name/i.test(String((e as { message?: string })?.message))) throw e;
          });
        }
        return;
      }
    } catch { /* fall through to memory */ }
    this.useMemory = true;
    try {
      const saved = JSON.parse(this.storage?.getItem(STORE_KEY) ?? "null") as Record<string, Row[]> | null;
      if (saved && typeof saved === "object") {
        for (const [table, rows] of Object.entries(saved)) if (Array.isArray(rows)) this.mem.set(table, rows);
      }
    } catch { /* unreadable or corrupt store: start empty rather than fail */ }
  }

  /** Best effort: a full or blocked store must not break the session in memory. */
  private persist(): void {
    if (!this.storage || this.batching > 0) return;
    try { this.storage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(this.mem))); } catch { /* keep going in memory */ }
  }

  async get(table: string, id: string): Promise<Row | null> {
    if (this.useMemory) return (this.mem.get(table) ?? []).find((r) => r.id === id) ?? null;
    return (this.sqlite as { getFirstAsync: (s: string, p: unknown[]) => Promise<Row | null> }).getFirstAsync(
      `SELECT * FROM ${table} WHERE id = ?`,
      [id]
    );
  }

  async insert(table: string, row: Row): Promise<void> {
    if (this.useMemory) {
      const arr = (this.mem.get(table) ?? []).filter((r) =>
        row.id !== undefined ? r.id !== row.id :
        table === "option_factor_values" ? !(r.option_id === row.option_id && r.factor_id === row.factor_id) : true
      );
      arr.push(row);
      this.mem.set(table, arr);
      this.persist();
      return;
    }
    const keys = Object.keys(row);
    // Column names go into the statement itself, and rows can come from an imported file or backup.
    if (keys.length === 0 || !keys.every((k) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k))) throw new Error("Unexpected column name");
    const placeholders = keys.map(() => "?").join(",");
    await (this.sqlite as { runAsync: (s: string, p: unknown[]) => Promise<void> }).runAsync(
      `INSERT OR REPLACE INTO ${table} (${keys.join(",")}) VALUES (${placeholders})`,
      keys.map((k) => row[k] as unknown)
    );
  }

  /** Replace-by-id on both backends (memory insert would duplicate). */
  async upsert(table: string, row: Row): Promise<void> {
    if (this.useMemory) {
      const arr = (this.mem.get(table) ?? []).filter((r) => r.id !== row.id);
      arr.push(row);
      this.mem.set(table, arr);
      this.persist();
      return;
    }
    await this.insert(table, row); // sqlite path is already INSERT OR REPLACE
  }

  async list(table: string, where?: string): Promise<Row[]> {
    if (this.useMemory) return [...(this.mem.get(table) ?? [])];
    const rows = await (this.sqlite as { getAllAsync: (s: string) => Promise<Row[]> }).getAllAsync(
      `SELECT * FROM ${table}${where ? ` WHERE ${where}` : ""} ORDER BY rowid DESC`
    );
    return rows;
  }

  /** Removes every row whose `column` equals `value`. Table and column names are code constants, never user input. */
  async deleteWhere(table: string, column: string, value: string): Promise<void> {
    if (this.useMemory) {
      const rows = this.mem.get(table) ?? [];
      const kept = rows.filter((r) => r[column] !== value);
      if (kept.length !== rows.length) {
        this.mem.set(table, kept);
        this.persist();
      }
      return;
    }
    await (this.sqlite as { runAsync: (s: string, p: unknown[]) => Promise<void> }).runAsync(
      `DELETE FROM ${table} WHERE ${column} = ?`,
      [value]
    );
  }

  async clearTable(table: string): Promise<void> {
    if (this.useMemory) {
      this.mem.set(table, []);
      this.persist();
      return;
    }
    await (this.sqlite as { execAsync: (s: string) => Promise<void> }).execAsync(
      `DELETE FROM ${table};`
    );
  }

  /** Save a complete model together; rollback leaves the previous model intact. */
  async transaction(tables: string[], work: (database: Database) => Promise<void>): Promise<void> {
    await this.init();
    if (this.useMemory) {
      const before = new Map(tables.map((table) => [table, [...(this.mem.get(table) ?? [])]]));
      this.batching++;
      try { await work(this); } catch (error) {
        for (const [table, rows] of before) this.mem.set(table, rows);
        throw error;
      } finally {
        this.batching--;
        this.persist();
      }
      return;
    }
    await (this.sqlite as {
      withExclusiveTransactionAsync: (task: (transaction: unknown) => Promise<void>) => Promise<void>;
    }).withExclusiveTransactionAsync(async (transaction) => {
      const database = new Database(null);
      database.sqlite = transaction;
      database.useMemory = false;
      database.initializing = Promise.resolve();
      await work(database);
    });
  }

  async clearPrivate(): Promise<void> {
    // Private mode (§41): no history retained.
    if (this.useMemory) {
      for (const [k, arr] of this.mem)
        this.mem.set(k, arr.filter((r) => (r as { private_mode?: number }).private_mode !== 1));
      this.persist();
      return;
    }
    await (this.sqlite as { execAsync: (s: string) => Promise<void> }).execAsync(
      "DELETE FROM decisions WHERE private_mode = 1;"
    );
  }
}

export const db = new Database();
