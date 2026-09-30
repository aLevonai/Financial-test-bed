import postgres from "postgres";

export type Sql = postgres.Sql;

const globalForDb = globalThis as unknown as { __radarSql?: Sql };

/** Shared Postgres client. `prepare: false` keeps it compatible with Supabase's transaction pooler. */
export function getSql(): Sql {
  if (globalForDb.__radarSql) return globalForDb.__radarSql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, {
    prepare: false,
    max: Number(process.env.DB_POOL_MAX ?? 5),
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
  });
  globalForDb.__radarSql = sql;
  return sql;
}

export async function closeSql(): Promise<void> {
  const sql = globalForDb.__radarSql;
  globalForDb.__radarSql = undefined;
  if (sql) await sql.end({ timeout: 5 });
}
