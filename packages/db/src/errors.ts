/**
 * Errors the API is allowed to show a caller verbatim.
 *
 * `NotFoundError` deliberately does not distinguish "this record does not
 * exist" from "this record exists but you may not see it". Confirming existence
 * to an unauthorized caller is itself a disclosure -- knowing that a particular
 * child has a record in another district's special education system is exactly
 * the kind of fact FERPA protects.
 */
export class NotFoundError extends Error {
  override readonly name = 'NotFoundError'
  constructor(message: string) {
    super(message)
  }
}
