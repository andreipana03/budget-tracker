/**
 * RFC 9562 UUIDv7: 48-bit Unix milliseconds, version 7, variant 10, 74 random bits.
 * The API expects client-generated ids to be v7 (sortable by creation time), and a
 * create sent twice with the same id is idempotent — so the Add sheet makes one id per
 * form and reuses it on retries. `crypto.randomUUID()` is v4, hence this helper.
 *
 *   uuidv7() → "019a5b3c-1f2e-7c3d-9a4b-5c6d7e8f9a0b"
 */
export function uuidv7(now: number = Date.now(), random: Uint8Array = randomBytes(10)): string {
  const bytes = new Uint8Array(16)
  let ts = Math.max(0, Math.floor(now))
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ts % 256
    ts = Math.floor(ts / 256)
  }
  bytes.set(random.subarray(0, 10), 6)
  bytes[6] = 0x70 | (bytes[6] & 0x0f) // version 7
  bytes[8] = 0x80 | (bytes[8] & 0x3f) // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** The millisecond timestamp inside a UUIDv7. */
export function uuidv7Time(id: string): number {
  return parseInt(id.replace(/-/g, '').slice(0, 12), 16)
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n)
  crypto.getRandomValues(out)
  return out
}
