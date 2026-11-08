/**
 * Encryption at rest for secrets (passwords, TLS passphrases).
 *
 * Encrypted values are stored as `enc:v1:<base64>`. The cipher is injected so the
 * repositories stay testable; production uses Electron `safeStorage`.
 *
 * A stored value that cannot be decrypted (the OS keyring is locked or unavailable, keychain
 * access was denied, the profile folder came from another machine) is never thrown away:
 * `openStoredSecret` hands back the ciphertext, and the repository writes it back unchanged until
 * the user enters a new value.
 */

export const ENCRYPTED_PREFIX = 'enc:v1:'

/** Pluggable cipher. `isAvailable() === false` means secrets are stored as plain text. */
export interface SecretCipher {
  isAvailable(): boolean
  encrypt(plainText: string): Buffer
  decrypt(encrypted: Buffer): string
}

/** The subset of Electron's `safeStorage` used here (kept structural: no electron import). */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

/** Production cipher backed by Electron's `safeStorage` (OS keychain / DPAPI / libsecret). */
export function createSafeStorageCipher(safeStorage: SafeStorageLike): SecretCipher {
  return {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plainText) => safeStorage.encryptString(plainText),
    decrypt: (encrypted) => safeStorage.decryptString(encrypted)
  }
}

/** A cipher that never encrypts (secrets are stored as plain text). */
export const PLAIN_CIPHER: SecretCipher = {
  isAvailable: () => false,
  encrypt: () => {
    throw new Error('Encryption is not available')
  },
  decrypt: () => {
    throw new Error('Encryption is not available')
  }
}

type Warn = (message: string) => void

/** True for a value written by `sealSecret` with encryption (`enc:v1:…`). */
export function isSealedSecret(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX)
}

/** Encrypts `value` for storage when the cipher is available; empty values stay empty. */
export function sealSecret(value: string, cipher: SecretCipher, warn: Warn = console.warn): string {
  if (value === '' || !cipher.isAvailable()) return value
  try {
    return ENCRYPTED_PREFIX + cipher.encrypt(value).toString('base64')
  } catch (err) {
    warn(`[storage] Cannot encrypt a secret, storing it as plain text: ${String(err)}`)
    return value
  }
}

/** A stored secret, opened. */
export interface OpenedSecret {
  /** The plain text; `''` when it cannot be decrypted. */
  value: string
  /** The stored ciphertext when it cannot be decrypted on this system (keep it unchanged). */
  sealed?: string
}

/** Decrypts a stored value; an undecryptable one yields `''` plus its ciphertext (`sealed`). */
export function openStoredSecret(
  stored: string,
  cipher: SecretCipher,
  warn: Warn = console.warn
): OpenedSecret {
  if (!isSealedSecret(stored)) return { value: stored }
  if (!cipher.isAvailable()) {
    warn('[storage] A secret is encrypted but encryption is not available; it is kept as it is')
    return { value: '', sealed: stored }
  }
  try {
    return { value: cipher.decrypt(Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), 'base64')) }
  } catch (err) {
    warn(`[storage] Cannot decrypt a secret; it is kept as it is: ${String(err)}`)
    return { value: '', sealed: stored }
  }
}
