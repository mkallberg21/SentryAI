import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

/**
 * Field-level envelope encryption for student data.
 *
 * Disk encryption protects against a stolen drive. It does not protect against
 * a misconfigured query, an over-broad export, or a support engineer with
 * database access -- which are the realistic ways special education records
 * actually leak. Sensitive fields are therefore encrypted individually, with a
 * per-record data key that is itself wrapped by a key-encryption key held in a
 * KMS the application cannot read.
 *
 * The AAD binds each ciphertext to its student, record, and field. A row copied
 * from one student to another fails to decrypt rather than silently producing
 * the wrong child's disability category.
 */

const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16

export interface EncryptedField {
  readonly ciphertext: string
  readonly iv: string
  readonly authTag: string
  /** Which key-encryption key wrapped the data key. Enables rotation. */
  readonly keyId: string
  readonly version: 1
}

export interface FieldContext {
  readonly studentId: string
  readonly recordType: string
  readonly recordId: string
  readonly fieldName: string
}

/**
 * Wraps and unwraps data keys. Backed by AWS KMS or GCP KMS in production; the
 * local implementation below exists so tests and development do not require a
 * cloud dependency, and it refuses to run outside development.
 */
export interface KeyProvider {
  readonly keyId: string
  /** Returns the plaintext data key for a given record. */
  dataKeyFor(context: FieldContext): Buffer
}

function additionalData(context: FieldContext): Buffer {
  return Buffer.from(
    `${context.studentId}|${context.recordType}|${context.recordId}|${context.fieldName}`,
    'utf8',
  )
}

export function encryptField(
  plaintext: string,
  context: FieldContext,
  keys: KeyProvider,
): EncryptedField {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, keys.dataKeyFor(context), iv, {
    authTagLength: TAG_BYTES,
  })
  cipher.setAAD(additionalData(context))

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    keyId: keys.keyId,
    version: 1,
  }
}

export class DecryptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DecryptionError'
  }
}

export function decryptField(
  field: EncryptedField,
  context: FieldContext,
  keys: KeyProvider,
): string {
  if (field.keyId !== keys.keyId) {
    throw new DecryptionError(
      `Field was encrypted under key "${field.keyId}" but the provider holds "${keys.keyId}".`,
    )
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    keys.dataKeyFor(context),
    Buffer.from(field.iv, 'base64'),
    { authTagLength: TAG_BYTES },
  )
  decipher.setAAD(additionalData(context))
  decipher.setAuthTag(Buffer.from(field.authTag, 'base64'))

  try {
    return Buffer.concat([
      decipher.update(Buffer.from(field.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    // Deliberately opaque. The common cause is that the ciphertext is being
    // read in a context it was not encrypted for -- a cross-student read --
    // and the error message should not confirm details of either record.
    throw new DecryptionError(
      'Field failed authentication. The ciphertext, the key, or the record context does not match.',
    )
  }
}

/**
 * Development-only key provider.
 *
 * Derives per-record data keys from a single local KEK. Refuses to construct
 * when NODE_ENV is production, because a KEK that lives in an environment
 * variable is a KEK that ends up in a log, a crash dump, or a repository.
 */
export class LocalKeyProvider implements KeyProvider {
  readonly keyId = 'local-dev'
  readonly #kek: Buffer

  constructor(kek: Buffer, nodeEnv: string | undefined = process.env['NODE_ENV']) {
    if (nodeEnv === 'production') {
      throw new Error(
        'LocalKeyProvider cannot be used in production. Configure a KMS-backed KeyProvider.',
      )
    }
    if (kek.length !== KEY_BYTES) {
      throw new Error(`Key-encryption key must be ${KEY_BYTES} bytes, received ${kek.length}.`)
    }
    this.#kek = kek
  }

  static generate(): LocalKeyProvider {
    return new LocalKeyProvider(randomBytes(KEY_BYTES))
  }

  dataKeyFor(context: FieldContext): Buffer {
    // HKDF-style derivation so each record gets a distinct key without a
    // round trip, while remaining reproducible from the KEK.
    return Buffer.from(
      hkdfSync(
        'sha256',
        this.#kek,
        Buffer.from(context.studentId, 'utf8'),
        Buffer.from(`${context.recordType}:${context.recordId}`, 'utf8'),
        KEY_BYTES,
      ),
    )
  }
}

/** Constant-time comparison for ciphertext equality checks. */
export function ciphertextEquals(a: EncryptedField, b: EncryptedField): boolean {
  const bufA = Buffer.from(a.ciphertext, 'base64')
  const bufB = Buffer.from(b.ciphertext, 'base64')
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}
