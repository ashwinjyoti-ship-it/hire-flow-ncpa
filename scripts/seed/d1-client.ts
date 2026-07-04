/**
 * Minimal D1 client for seed scripts. Runs SQL via `wrangler d1 execute`
 * against the local or remote (preview/production) database.
 *
 * Performance: executes batched SQL in chunks (each wrangler spawn is expensive,
 * so we accumulate statements and flush periodically instead of one-per-row).
 */
import { execFileSync } from "node:child_process";

export type SeedEnv = "local" | "preview" | "remote";

export interface D1Result {
  results: unknown[];
  success: boolean;
  meta: Record<string, unknown>;
}

/** Accumulates SQL statements and flushes them in batches. */
export class SqlBatch {
  private statements: string[] = [];
  private readonly chunkSize: number;

  constructor(chunkSize = 50) {
    this.chunkSize = chunkSize;
  }

  add(sql: string): void {
    this.statements.push(sql);
  }

  /** Flush all pending statements, in chunks. */
  flush(env: SeedEnv): { chunks: number; statements: number } {
    let chunks = 0;
    for (let i = 0; i < this.statements.length; i += this.chunkSize) {
      const slice = this.statements.slice(i, i + this.chunkSize);
      const sql = slice.join("\n");
      d1ExecRaw(sql, env);
      chunks++;
    }
    const count = this.statements.length;
    this.statements = [];
    return { chunks, statements: count };
  }

  get pending(): number {
    return this.statements.length;
  }
}

function d1ExecRaw(sql: string, env: SeedEnv): void {
  execFileSync(
    "wrangler",
    ["d1", "execute", "ncpa-hire-db", env === "local" ? "--local" : "--remote", "--command", sql],
    {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 128,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
}

/** Execute a single SQL command (used sparingly — prefer SqlBatch). */
export function exec(sql: string, env: SeedEnv): void {
  d1ExecRaw(sql, env);
}

/** Query and return the first result row (as typed by caller). */
export function queryFirst<T>(sql: string, env: SeedEnv): T | null {
  const out = execFileSync(
    "wrangler",
    ["d1", "execute", "ncpa-hire-db", env === "local" ? "--local" : "--remote", "--command", sql, "--json"],
    { encoding: "utf8", maxBuffer: 1024 * 1024 * 64, env: { ...process.env } }
  );
  try {
    const res = JSON.parse(out) as D1Result[];
    const rows = (res[0]?.results ?? []) as T[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/** Query and return all result rows. */
export function queryAll<T>(sql: string, env: SeedEnv): T[] {
  const out = execFileSync(
    "wrangler",
    ["d1", "execute", "ncpa-hire-db", env === "local" ? "--local" : "--remote", "--command", sql, "--json"],
    { encoding: "utf8", maxBuffer: 1024 * 1024 * 64, env: { ...process.env } }
  );
  try {
    const res = JSON.parse(out) as D1Result[];
    return (res[0]?.results ?? []) as T[];
  } catch {
    return [];
  }
}

/** SQL-escape a string for inline use in statements. */
export function sqlStr(value: string | null | undefined): string {
  if (value === null || value === undefined) return "NULL";
  return "'" + String(value).replace(/'/g, "''") + "'";
}
