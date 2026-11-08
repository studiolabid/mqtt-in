/**
 * TLS test material: a self-signed EC certificate with its key (CN=mqtey-test, valid until
 * 2126; test data only, never trusted anywhere), plus generated keys for passphrase and
 * mismatch cases.
 */
import { generateKeyPairSync } from 'node:crypto'

export const CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIBgjCCASegAwIBAgIUALScbTVISWY73Ws1h+q53I3SljYwCgYIKoZIzj0EAwIw
FTETMBEGA1UEAwwKbXF0ZXktdGVzdDAgFw0yNjExMDgwNDI3MzdaGA8yMTI2MTAx
NTA0MjczN1owFTETMBEGA1UEAwwKbXF0ZXktdGVzdDBZMBMGByqGSM49AgEGCCqG
SM49AwEHA0IABPbN6dPd2h7CcKUEY/Pcf5+/Nm523kghLekjd7+S8ke7MGadnebt
zp8CByrGw1suB+p8i7uTMLASlRMitjHvCVWjUzBRMB0GA1UdDgQWBBQ5AzvXO6py
dQzVts08XDFDBoXZFTAfBgNVHSMEGDAWgBQ5AzvXO6pydQzVts08XDFDBoXZFTAP
BgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0kAMEYCIQCWlzoU4JansFQuduRU
W9VXy4w9T8AH5l9wH1PiS0EioAIhAN7Ebticty6gHJ6/WgvqykNP4+qe9Ow5fjeB
pvY9jgg4
-----END CERTIFICATE-----
`

/** The private key of CERT_PEM (PKCS#8, unencrypted). */
export const KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgecfo8S0Baxe+OMGK
V+bxOKzcDK1bRdTZcosA2gxEZ3ahRANCAAT2zenT3doewnClBGPz3H+fvzZudt5I
IS3pI3e/kvJHuzBmnZ3m7c6fAgcqxsNbLgfqfIu7kzCwEpUTIrYx7wlV
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
