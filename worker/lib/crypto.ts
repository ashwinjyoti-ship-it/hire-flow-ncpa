/**
 * Password hashing (scrypt via @noble/hashes), TOTP, and recovery codes.
 * All Workers-safe (no Node crypto). Secrets never logged.
 */
import { scrypt } from "@noble/hashes/scrypt";
import { randomBytes } from "@noble/hashes/utils";
import * as OTPAuth from "otpauth";
import { timingSafeEqual } from "./id";

/** Constant-time byte-array comparison. */
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a[i]! ^ b[i]!;
  }
  return mismatch === 0;
}

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_DKLEN = 32;
const SALT_LEN = 16;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

/** Hash a password with scrypt. Returns `scrypt:saltHex:hashHex`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LEN);
  const hash = scrypt(password.normalize("NFKC"), salt, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    dkLen: SCRYPT_DKLEN,
  });
  return `scrypt:${toHex(salt)}:${toHex(hash)}`;
}

/** Verify a password against a stored `scrypt:salt:hash` string. */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = fromHex(parts[1]!);
  const expected = fromHex(parts[2]!);
  const actual = scrypt(password.normalize("NFKC"), salt, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    dkLen: SCRYPT_DKLEN,
  });
  return equalBytes(actual, expected);
}

// ---- TOTP (RFC 6238) ----

/** Generate a new random TOTP secret (base32). */
export function generateTotpSecret(): string {
  // 20 bytes = 160 bits, base32-encoded
  return new OTPAuth.Secret({ size: 20 }).base32;
}

/** Build a TOTP object for a given secret. */
function totpFor(secret: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: "NCPA Venue for Hire",
    label: "NCPA",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}

/** Returns the current 6-digit TOTP token for a secret. */
export function generateTotpToken(secret: string): string {
  return totpFor(secret).generate();
}

/** Verify a TOTP token, allowing a ±1 window for clock drift. */
export function verifyTotp(secret: string, token: string): boolean {
  const totp = totpFor(secret);
  const delta = totp.validate({ token: token.replace(/\s/g, ""), window: 1 });
  return delta !== null;
}

/** Build the otpauth:// URI for QR code enrolment. */
export function totpUri(secret: string, email: string): string {
  const totp = new OTPAuth.TOTP({
    issuer: "NCPA Venue for Hire",
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
  return totp.toString();
}

// ---- Recovery codes ----

/** Generate N single-use recovery codes (returns plaintext for one-time display). */
export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = randomBytes(5);
    const hex = toHex(bytes).toUpperCase();
    codes.push(`${hex.slice(0, 5)}-${hex.slice(5, 10)}`);
  }
  return codes;
}

/** Hash a recovery code (store the hash, show plaintext only once). */
export function hashRecoveryCode(code: string): string {
  const salt = randomBytes(8);
  const hash = scrypt(code.toUpperCase(), salt, {
    N: 4096,
    r: 8,
    p: 1,
    dkLen: 20,
  });
  return `rc:${toHex(salt)}:${toHex(hash)}`;
}

/** Verify a recovery code against a list of stored hashes; returns the matched hash index or -1. */
export function verifyRecoveryCode(
  code: string,
  storedHashes: string[]
): number {
  const normalised = code.toUpperCase().replace(/\s/g, "");
  for (let i = 0; i < storedHashes.length; i++) {
    const stored = storedHashes[i]!;
    const parts = stored.split(":");
    if (parts.length !== 3 || parts[0] !== "rc") continue;
    const salt = fromHex(parts[1]!);
    const expected = fromHex(parts[2]!);
    const actual = scrypt(normalised, salt, {
      N: 4096,
      r: 8,
      p: 1,
      dkLen: 20,
    });
    if (equalBytes(actual, expected)) {
      return i;
    }
  }
  return -1;
}

// ---- Password reset tokens ----

/** SHA-256 hex digest — used to store reset tokens at rest (the token itself carries the entropy). */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return toHex(new Uint8Array(digest));
}

/** Generate a human-typeable temporary password for admin-forced resets. */
export function generateTemporaryPassword(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(16);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

/** Constant-time comparison re-export for convenience. */
export { timingSafeEqual };
