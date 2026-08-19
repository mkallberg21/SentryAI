import pg from 'pg'

/**
 * Database access, scoped to one district and one user for the life of a
 * transaction.
 *
 * There is no way to query in this package without a session. That is the
 * point: row-level security depends on `sentryai.district_id` being set, and an
 * unscoped connection sees nothing. Making the scoped transaction the only
 * entry point means a developer cannot accidentally take the unscoped path,
 * because it does not exist.
 */

export interface Session {
  readonly districtId: string
  readonly userId: string
  /** Drives district-wide vs caseload-limited visibility in RLS policies. */
  readonly role: string
}

export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<pg.QueryResult<R>>
}

export function createPool(connectionString: string, max = 10): pg.Pool {
  return new pg.Pool({
    connectionString,
    max,
    // A compliance dashboard that hangs is a compliance dashboard nobody opens.
    statement_timeout: 15_000,
    idle_in_transaction_session_timeout: 30_000,
  })
}

/**
 * Run `fn` inside a transaction scoped to the session.
 *
 * `set_config(..., true)` is transaction-local, so the scope cannot leak to the
 * next borrower of a pooled connection -- the failure mode that turns
 * connection pooling into a cross-tenant data leak.
 */
export async function withTenant<T>(
  pool: pg.Pool,
  session: Session,
  fn: (tx: Queryable) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `SELECT set_config('sentryai.district_id', $1, true),
              set_config('sentryai.user_id', $2, true),
              set_config('sentryai.role', $3, true)`,
      [session.districtId, session.userId, session.role],
    )
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {
      // The original error is the one worth surfacing; a rollback failure on an
      // already-broken connection would only mask it.
    })
    throw error
  } finally {
    client.release()
  }
}

/**
 * Escalated access for migrations, seeding, and platform administration.
 *
 * Named to be conspicuous in review. Any use of this outside migration or
 * operational tooling is a bug, because it bypasses tenant isolation.
 */
export async function withoutTenantScope<T>(
  pool: pg.Pool,
  fn: (tx: Queryable) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    return await fn(client)
  } finally {
    client.release()
  }
}

export type { Pool } from 'pg'
