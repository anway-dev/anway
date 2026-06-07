/**
 * Thin adapter: turns a node-postgres Pool into a QueryFn
 * suitable for StructuralGraph and other KB consumers.
 *
 * Usage:
 *   const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
 *   const graph = new StructuralGraph(createPostgresQueryFn(pool))
 */

export interface PgPoolLike {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>
}

export function createPostgresQueryFn(pool: PgPoolLike) {
  return async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
    const result = await pool.query(sql, params)
    return result.rows
  }
}
