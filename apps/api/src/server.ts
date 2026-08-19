import { createServer } from 'node:http'
import { createPool, type Pool } from '@sentryai/db'
import { LocalKeyProvider, type KeyProvider } from '@sentryai/governance'
import { createYoga, type YogaServerInstance } from 'graphql-yoga'
import { DevTokenVerifier, principalFromRequest, type TokenVerifier } from './auth.js'
import { maskApiError } from './errors.js'
import { schema, type ServerContext } from './schema.js'

export interface ApiOptions {
  readonly pool: Pool
  readonly keys: KeyProvider
  readonly verifier: TokenVerifier
}

export function createApi(options: ApiOptions): YogaServerInstance<{}, ServerContext> {
  return createYoga<{}, ServerContext>({
    schema,
    // The API serves student records. Introspection and the playground are
    // useful in development and are attack surface in production.
    graphiql: process.env['NODE_ENV'] !== 'production',
    landingPage: false,
    maskedErrors: {
      maskError: maskApiError,
    },
    context: async ({ request }): Promise<ServerContext> => ({
      principal: await principalFromRequest(request, options.verifier),
      pool: options.pool,
      keys: options.keys,
    }),
  })
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required.`)
  }
  return value
}

async function main(): Promise<void> {
  const pool = createPool(requiredEnv('DATABASE_URL'))

  const kek = process.env['SENTRYAI_LOCAL_KEK']
  if (process.env['NODE_ENV'] === 'production') {
    // Fail at boot rather than at the first decrypt. A production process that
    // starts with development key material is worse than one that will not start.
    throw new Error(
      'Production requires a KMS-backed KeyProvider. Wire it here before deploying.',
    )
  }
  const keys =
    kek === undefined || kek.length === 0
      ? LocalKeyProvider.generate()
      : new LocalKeyProvider(Buffer.from(kek, 'base64'))

  const yoga = createApi({ pool, keys, verifier: new DevTokenVerifier() })
  const server = createServer(yoga)
  const port = Number(process.env['PORT'] ?? 4000)

  server.listen(port, () => {
    console.log(`SentryAI API listening on http://localhost:${port}/graphql`)
  })

  const shutdown = () => {
    server.close(() => {
      void pool.end().then(() => process.exit(0))
    })
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

// Only run when executed directly, so tests can import createApi freely.
if (process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('server.ts')) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
