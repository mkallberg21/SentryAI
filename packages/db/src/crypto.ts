import {
  decryptField,
  encryptField,
  type EncryptedField,
  type FieldContext,
  type KeyProvider,
} from '@sentryai/governance'

/**
 * Glue between the governance encryption primitives and jsonb columns.
 *
 * Encrypted columns are nullable, which means every read has to answer "is this
 * null because there is no value, or because decryption failed?" Conflating
 * those is how a blank present-levels field silently reaches a signed IEP, so
 * the two cases are distinct here: absent returns null, broken throws.
 */

export function sealed(
  plaintext: string | null,
  context: FieldContext,
  keys: KeyProvider,
): EncryptedField | null {
  if (plaintext === null) return null
  return encryptField(plaintext, context, keys)
}

export function opened(
  column: unknown,
  context: FieldContext,
  keys: KeyProvider,
): string | null {
  if (column === null || column === undefined) return null
  return decryptField(column as EncryptedField, context, keys)
}

/** Encrypt a JSON-serializable value (arrays of disability codes, PWN content). */
export function sealedJson<T>(
  value: T | null,
  context: FieldContext,
  keys: KeyProvider,
): EncryptedField | null {
  if (value === null) return null
  return encryptField(JSON.stringify(value), context, keys)
}

export function openedJson<T>(
  column: unknown,
  context: FieldContext,
  keys: KeyProvider,
): T | null {
  const raw = opened(column, context, keys)
  return raw === null ? null : (JSON.parse(raw) as T)
}

export function fieldContext(
  studentId: string,
  recordType: string,
  recordId: string,
  fieldName: string,
): FieldContext {
  return { studentId, recordType, recordId, fieldName }
}
