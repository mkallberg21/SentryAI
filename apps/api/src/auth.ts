import type { Session } from '@sentryai/db'

/**
 * Request authentication.
 *
 * Districts sign in through their own identity provider (Google Workspace,
 * Entra, Clever) — SentryAI is not in the business of storing district
 * passwords. This module turns a verified token into a `Session`, which is the
 * only thing the rest of the API is allowed to know about the caller.
 *
 * The verifier is pluggable and the development one is deliberately loud about
 * being development-only. A stub that silently trusts a header in production is
 * a whole-district data breach, so it refuses to construct there.
 */

export interface Principal extends Session {
  readonly email: string
  readonly name: string
}

export class AuthError extends Error {
  readonly code = 'UNAUTHENTICATED'
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

export interface TokenVerifier {
  verify(token: string): Promise<Principal>
}

/**
 * Development verifier: accepts a base64url JSON principal.
 *
 * This exists so the API can be exercised end to end without standing up an
 * IdP. It performs no signature check, which is why it will not run outside
 * development.
 */
export class DevTokenVerifier implements TokenVerifier {
  constructor(nodeEnv: string | undefined = process.env['NODE_ENV']) {
    if (nodeEnv === 'production') {
      throw new Error(
        'DevTokenVerifier cannot run in production. Configure an OIDC verifier against the district identity provider.',
      )
    }
  }

  async verify(token: string): Promise<Principal> {
    let decoded: unknown
    try {
      decoded = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'))
    } catch {
      throw new AuthError('Malformed development token.')
    }

    const p = decoded as Partial<Principal>
    if (
      typeof p.districtId !== 'string' ||
      typeof p.userId !== 'string' ||
      typeof p.role !== 'string'
    ) {
      throw new AuthError('Development token must carry districtId, userId, and role.')
    }

    return {
      districtId: p.districtId,
      userId: p.userId,
      role: p.role,
      email: p.email ?? 'dev@example.invalid',
      name: p.name ?? 'Development User',
    }
  }
}

export async function principalFromRequest(
  request: Request,
  verifier: TokenVerifier,
): Promise<Principal> {
  const header = request.headers.get('authorization')
  if (header === null || !header.toLowerCase().startsWith('bearer ')) {
    throw new AuthError('Missing bearer token.')
  }
  return verifier.verify(header.slice(7).trim())
}

/**
 * Roles permitted to see district-wide data.
 *
 * Kept in sync with `sentryai.is_district_wide_role()` in the migration. The
 * database is the enforcement point; this is for producing a clear error
 * instead of a confusingly empty result set.
 */
const DISTRICT_WIDE_ROLES = new Set([
  'special-education-director',
  'district-administrator',
  'program-specialist',
])

export function isDistrictWide(session: Session): boolean {
  return DISTRICT_WIDE_ROLES.has(session.role)
}
