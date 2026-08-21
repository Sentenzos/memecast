import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

type BindValue = SQLInputValue;
type RunResult = { meta: { changes: number; last_row_id?: number | bigint } };

export class LocalD1Statement {
  private readonly values: BindValue[];

  constructor(private readonly database: DatabaseSync, private readonly sql: string, values: BindValue[] = []) {
    this.values = values;
  }

  bind(...values: BindValue[]) {
    return new LocalD1Statement(this.database, this.sql, values);
  }

  async first<T>() {
    return this.database.prepare(this.sql).get(...this.values) as T | null;
  }

  async all<T>() {
    return { results: this.database.prepare(this.sql).all(...this.values) as T[] };
  }

  async run(): Promise<RunResult> {
    return this.runSync();
  }

  runSync(): RunResult {
    const result = this.database.prepare(this.sql).run(...this.values);
    return {
      meta: {
        changes: Number(result.changes),
        last_row_id: result.lastInsertRowid,
      },
    };
  }
}

export class LocalD1Database {
  constructor(private readonly database: DatabaseSync) {}

  prepare(sql: string) {
    return new LocalD1Statement(this.database, sql);
  }

  async batch(statements: LocalD1Statement[]) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => statement.runSync());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

const globalDatabase = globalThis as typeof globalThis & { __memecastDb?: LocalD1Database };

export function getLocalDatabase() {
  if (globalDatabase.__memecastDb) return globalDatabase.__memecastDb;
  const databasePath = resolve(process.env.DATABASE_PATH || "./data/memecast.sqlite");
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA synchronous = NORMAL");
  const adapter = new LocalD1Database(database);
  globalDatabase.__memecastDb = adapter;
  return adapter;
}
