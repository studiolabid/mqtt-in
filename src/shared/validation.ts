/**
 * Validation rules shared by the connection form (renderer) and the main-process profile
 * schema, so both sides accept and reject the same values. Pure, dependency free.
 */

/** Longest DNS name (RFC 1035: 255 octets on the wire = 253 characters, without a final dot). */
const MAX_HOST_LENGTH = 253

const HOST_ONLY = 'Enter only the host name (no mqtt://, path, port or credentials)'

/** Characters a broker host never contains: URL, credential and path separators. */
const URL_PARTS = /[/\\@?#%[\]]/
const HEX_GROUP = /^[0-9a-f]{1,4}$/i
const IPV4_OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
const IPV4 = new RegExp(`^${IPV4_OCTET}(\\.${IPV4_OCTET}){3}$`)
/** Four dot-separated numbers: meant as an IPv4 address (checked with `IPV4`). */
const IPV4_LIKE = /^\d+\.\d+\.\d+\.\d+$/

/** Whitespace (any Unicode space) or a C0 / C1 control character. */
function hasBlankOrControl(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f)) return true
  }
  return /\s/.test(value)
}

/**
 * True for an IPv6 address literal without brackets or zone id: `::1`, `2001:db8::8a2e:370:7334`,
 * `::ffff:192.0.2.1` (an embedded IPv4 address as the last 32 bits).
 */
export function isIpv6Literal(value: string): boolean {
  let address = value
  const lastColon = address.lastIndexOf(':')
  if (lastColon === -1) return false
  const tail = address.slice(lastColon + 1)
  if (tail.includes('.')) {
    // The embedded IPv4 address stands for the last two 16-bit groups.
    if (!IPV4.test(tail)) return false
    address = `${address.slice(0, lastColon + 1)}0:0`
  }
  const halves = address.split('::')
  if (halves.length > 2) return false
  const groups = halves.flatMap((half) => (half === '' ? [] : half.split(':')))
  if (!groups.every((group) => HEX_GROUP.test(group))) return false
  // With '::' (at least one zero group left out) up to 7 groups, otherwise exactly 8.
  return halves.length === 2 ? groups.length <= 7 : groups.length === 8
}

/**
 * Checks the host of a broker connection: a host name, an IPv4 address or an IPv6 address
 * (without brackets). Leading and trailing whitespace is ignored (callers trim before saving).
 *
 * @returns `null` when valid; otherwise a short human sentence for the host field, e.g.
 *   'Enter only the host name (no mqtt://, path, port or credentials)'.
 */
export function validateBrokerHost(host: string): string | null {
  const value = host.trim()
  if (value === '') return 'Host is required'
  if (hasBlankOrControl(value)) return 'Host must not contain spaces or control characters'
  if (value.includes(':')) {
    if (isIpv6Literal(value)) return null
    if (value.startsWith('[') && value.endsWith(']') && isIpv6Literal(value.slice(1, -1))) {
      return 'Enter the IPv6 address without brackets'
    }
    // A scheme (mqtt://), a port (host:1883) or credentials (user:password@host).
    return HOST_ONLY
  }
  if (URL_PARTS.test(value)) return HOST_ONLY
  if (IPV4_LIKE.test(value) && !IPV4.test(value)) return 'Enter a valid IPv4 address'
  if (value.replace(/\.$/, '').length > MAX_HOST_LENGTH) {
    return `Host is too long (max ${MAX_HOST_LENGTH} characters)`
  }
  return null
}
