import { NotFoundError } from '@sentryai/db'
import { GraphQLError } from 'graphql'
import { AuthError } from './auth.js'

/**
 * Which errors are safe to show the caller, and how they reach the wire.
 *
 * Two categories exist, and conflating them costs in both directions. Domain
 * errors carry text a case manager needs — "only the provider who delivered
 * the session may sign its log" is the whole answer. Internal errors carry
 * table names, SQL, and connection strings, and must never leave the server.
 *
 * Two mechanics bit here, both worth stating because neither is obvious:
 *
 * 1. GraphQL wraps every resolver error in a `GraphQLError`, so the thrown
 *    error arrives as `originalError`. Checking the outer error sends every
 *    domain message to the log as "unhandled" and every caller a useless
 *    "Unexpected error."
 *
 * 2. This function must return a `GraphQLError`. Returning a plain `Error`
 *    serializes to its *enumerable own properties* — and `message` is
 *    non-enumerable on `Error`, so the client receives `{"name":"..."}` with
 *    no message at all. A custom class field like `readonly code` is
 *    enumerable and does show up, which makes the bug look like a partial
 *    success rather than a serialization failure.
 */

function unwrap(error: unknown): unknown {
  let current = error
  // GraphQL can nest wrappers, so walk down rather than unwrapping once.
  for (let depth = 0; depth < 5; depth += 1) {
    const original = (current as { originalError?: unknown } | null)?.originalError
    if (original === undefined || original === null) break
    current = original
  }
  return current
}

/**
 * Errors whose message is written for the person reading the screen, mapped to
 * the code a client can branch on without parsing prose.
 */
function clientSafeCode(error: unknown): string | null {
  if (error instanceof AuthError) return 'UNAUTHENTICATED'
  if (error instanceof NotFoundError) return 'NOT_FOUND'
  if (error instanceof Error) {
    // The governance and repository layers signal domain failures by name, so
    // this module does not import every error class in the system.
    switch (error.name) {
      case 'ApprovalError':
        return 'APPROVAL_REFUSED'
      case 'ServiceLogError':
        return 'SERVICE_LOG_REFUSED'
      case 'ComplianceError':
        return 'COMPLIANCE_ERROR'
      default:
        return null
    }
  }
  return null
}

export function maskApiError(error: unknown, fallbackMessage: string): GraphQLError {
  const original = unwrap(error)

  const code = clientSafeCode(original)
  if (code !== null && original instanceof Error) {
    return new GraphQLError(original.message, {
      originalError: original,
      extensions: {
        code,
        // ApprovalError carries a machine-readable reason; pass it through so a
        // client can distinguish self-approval from an expired request.
        reason: (original as { code?: string }).code ?? undefined,
      },
    })
  }

  if (original instanceof Error && original.name === 'DecryptionError') {
    // Deliberately vague: the usual cause is a record being read in a context
    // it was not encrypted for, and the message must not confirm details of
    // either record.
    return new GraphQLError('This record could not be read in the current context.', {
      extensions: { code: 'RECORD_UNREADABLE' },
    })
  }

  console.error('Unhandled API error:', original)
  return new GraphQLError(fallbackMessage, {
    extensions: { code: 'INTERNAL_SERVER_ERROR' },
  })
}
