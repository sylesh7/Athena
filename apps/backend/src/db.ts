import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { commonCfg } from "./config.js";

export const sb = createClient(commonCfg.SUPABASE_URL, commonCfg.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
export const pool = new pg.Pool({ connectionString: commonCfg.DATABASE_URL, max: 10 });

// pg returns numeric/int8 as strings already; keep it that way (never let money become a JS number).

/** One cycle at a time, across every process and machine (Postgres advisory lock). */
export async function withCycleLock<T>(fn: () => Promise<T>): Promise<T | "locked"> {
  const c = await pool.connect();
  try {
    const { rows } = await c.query("select pg_try_advisory_lock(424242) as ok");
    if (!rows[0].ok) return "locked";
    try {
      return await fn();
    } finally {
      await c.query("select pg_advisory_unlock(424242)");
    }
  } finally {
    c.release();
  }
}

/** Publish to the SSE channel (consumed by api.ts /events/stream and the cycle trigger listener). */
export async function notify(type: string, data: Record<string, unknown> = {}): Promise<void> {
  await pool.query("select pg_notify('athena_events', $1)", [JSON.stringify({ type, ...data })]);
}

export async function q<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query<T>(text, params)).rows;
}
