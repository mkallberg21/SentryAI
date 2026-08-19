import { NotFoundError } from '@sentryai/db'
import { AuthError } from './auth.js'

/**
 * Which errors are safe to show the caller.
 *
 * Two categories exist and conflating them is a real cost in both directions.
 * Domain errors carry text a case manager needs — "only the provider who
 * delivered the session may sign its log" is the whole answer. Internal errors
 * carry table names, SQL, and connection strings, and must never leave the
 * server.
 *
 * GraphQL wraps every resolver error in a `GraphQLError`, so the thrown error
 * arrives here as the `originalError` rather than at the top level. Checking
 * the outer error is the mistake that sends every domain message to the log as
 * "unhandled" and every caller a useless "Unexpected error."
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

/** Errors whose message is written for the person reading the screen. */
function isClientSafe(error: unknown): error is Error {
  if (error instanceof AuthError) return true
  if (error instanceof NotFoundError) return true
  if (error instanceof Error) {
    // The governance and repository layers signal domain failures by name so
    // this module does not need to import every error class in the system.
    return (
      error.name === 'ApprovalError' ||
      error.name === 'ServiceLogError' ||
      error.name === 'ComplianceError'
    )
  }
  return false
}

export function maskApiError(error: unknown, fallbackMessage: string): Error {
  const original = unwrap(error)

  if (isClientSafe(original)) {
    return original
  }

  if (original instanceof Error && original.name === 'DecryptionError') {
    // Deliberately vague: the usual cause is a record being read in a context
    // it was not encrypted for, and the message must not confirm details of
    // either record.
    return new Error('This record could not be read in the current context.')
  }

  console.error('Unhandled API error:', original)
  return new Error(fallbackMessage)
}
