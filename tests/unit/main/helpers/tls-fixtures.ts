/**
 * TLS test material: a self-signed EC certificate with its key (CN=mqtt-in-test, valid until
 * 2126; test data only, never trusted anywhere), plus generated keys for passphrase and
 * mismatch cases.
 */
import { generateKeyPairSync } from 'node:crypto'

export const CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIBhTCCASugAwIBAgIUSN8UopLIaQG9g4ShvK3/VfTMmKAwCgYIKoZIzj0EAwIw
FzEVMBMGA1UEAwwMbXF0dC1pbi10ZXN0MCAXDTI2MTEwODA4MjQwNFoYDzIxMjYx
MDE1MDgyNDA0WjAXMRUwEwYDVQQDDAxtcXR0LWluLXRlc3QwWTATBgcqhkjOPQIB
BggqhkjOPQMBBwNCAATLliYaH9CwAPqh9RcXzHEEpt1R+/jbttIM4barQoOUfzD1
W/K4hBnYb327IXv2k6K/YwSSLWPjS0iEPqn8hlKJo1MwUTAdBgNVHQ4EFgQUspqc
d/E9Mc6VjF2RRZSxNYEPUwswHwYDVR0jBBgwFoAUspqcd/E9Mc6VjF2RRZSxNYEP
UwswDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNIADBFAiEAoCv/huQk7rLT
XzxLs5k0s/1K4Ojr8fKHhkZJc0b3TTgCIE8/9JhRAqarz7JNqQWHLImBP84zkfLj
uCZMws3dcxt3
-----END CERTIFICATE-----
`

/** The private key of CERT_PEM (PKCS#8, unencrypted). */
export const KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgzUPV1HZUEyuc3UzA
WTzWEOKwtwU0sefKZQ679VtObCmhRANCAATLliYaH9CwAPqh9RcXzHEEpt1R+/jb
ttIM4barQoOUfzD1W/K4hBnYb327IXv2k6K/YwSSLWPjS0iEPqn8hlKJ
-----END PRIVATE KEY-----
`

/** The body of a PEM block as DER (what Windows exports as a binary `.cer`). */
export function pemToDer(pem: string): Buffer {
  const body = pem.replace(/-----(BEGIN|END) [A-Z ]+-----/g, '').replace(/\s+/g, '')
  return Buffer.from(body, 'base64')
}

/** An AES-256-CBC encrypted PKCS#8 key (an unrelated key pair, so it matches no certificate). */
export function encryptedKeyPem(passphrase: string): string {
  const { privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase }
  })
  return privateKey
}

/** An unencrypted PKCS#8 key that does not belong to CERT_PEM. */
export function otherKeyPem(): string {
  const { privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })
  return privateKey
}
