import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type pg from 'pg'
import { withoutTenantScope } from './client.js'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

/**
 * Applies numbered SQL migrations in order, once each.
 *
 * Each migration runs inside a transaction, so a failure leaves the schema at
 * the last complete version rather than halfway through one. A partially
 * applied RLS policy set is worse than no policy set, because it looks applied.
 */
export async function migrate(pool: pg.Pool, dir = MIGRATIONS_DIR): Promise<string[]> {
  const applied: string[] = []

  await withoutTenantScope(pool, async (tx) => {
    await tx.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `)
  })

  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()

  for (const file of files) {
    await withoutTenantScope(pool, async (tx) => {
      const { rows } = await tx.query<{ name: string }>(
        'SELECT name FROM schema_migrations WHERE name = $1',
        [file],
      )
      if (rows.length > 0) return

      const sql = await readFile(join(dir, file), 'utf8')
      await tx.query('BEGIN')
      try {
        await tx.query(sql)
        await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
        await tx.query('COMMIT')
        applied.push(file)
      } catch (error) {
        await tx.query('ROLLBACK')
        throw new Error(
          `Migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        )
      }
    })
  }

  return applied
}
