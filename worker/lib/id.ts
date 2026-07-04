/**
 * Compact unique ID generator (Crockford base32, time-ordered).
 * Not spec-ULID but monotonic and URL-safe — adequate for D1 text keys.
 */
const ENCODE = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LEN = 10;
const RAND_LEN = 16;

export function makeId(prefix = "id"): string {
  const time = Date.now();
  let timeStr = "";
  let t = time;
  for (let i = 0; i < TIME_LEN; i++) {
    timeStr = ENCODE[t % 32] + timeStr;
    t = Math.floor(t / 32);
  }
  let randStr = "";
  const rand = new Uint32Array(RAND_LEN);
  crypto.getRandomValues(rand);
  for (let i = 0; i < RAND_LEN; i++) {
    randStr += ENCODE[rand[i]! % 32];
  }
  return `${prefix}_${timeStr}${randStr}`;
}

/** Constant-time string comparison (for token equality checks). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/** Generate a random hex token of the given byte length. */
export function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
