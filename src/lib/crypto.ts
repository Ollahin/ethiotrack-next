import { metaGet, metaSet } from "./db";

// State keys
const DAILY_PIN_VERIFIER_KEY = "daily_pin_v1";
const LICENSE_CREDENTIAL_KEY = "license_credential_v1";
const LOCKOUT_META_KEY = "auth_lockout_v1";

// Constants
const MAX_ATTEMPTS = 5;
const BASE_LOCK_MS = 30 * 1000;
const MAX_LOCK_MS = 15 * 60 * 1000;

// Ed25519 Public Key for Operations Authority
const AUTHORITY_PUB_KEY_KEY = "authority_public_key_v1";

/**
 * ARCHITECTURE NOTE:
 * The Master Authority private key is NEVER present in the client bundle.
 */

export type AuthKind = "daily-pin" | "license-activation";

interface LockoutEntry {
  failures: number;
  lockedUntil: number;
}
type LockoutMap = Partial<Record<AuthKind, LockoutEntry>>;

const lockoutListeners = new Set<() => void>();
export function subscribeLockout(l: () => void) {
  lockoutListeners.add(l);
  return () => lockoutListeners.delete(l);
}
function emitLockout() {
  for (const l of lockoutListeners) l();
}

async function readLockouts(): Promise<LockoutMap> {
  return (await metaGet<LockoutMap>(LOCKOUT_META_KEY)) ?? {};
}
async function writeLockouts(m: LockoutMap) {
  await metaSet(LOCKOUT_META_KEY, m);
  emitLockout();
}

export interface LockoutStatus {
  locked: boolean;
  msRemaining: number;
  failures: number;
  attemptsLeft: number;
}

export async function getLockoutStatus(kind: AuthKind): Promise<LockoutStatus> {
  const map = await readLockouts();
  const e = map[kind];
  const now = Date.now();
  const msRemaining = e && e.lockedUntil > now ? e.lockedUntil - now : 0;
  const failures = e?.failures ?? 0;
  return {
    locked: msRemaining > 0,
    msRemaining,
    failures,
    attemptsLeft: Math.max(0, MAX_ATTEMPTS - failures),
  };
}

async function assertNotLocked(kind: AuthKind) {
  const s = await getLockoutStatus(kind);
  if (s.locked) {
    const secs = Math.ceil(s.msRemaining / 1000);
    throw new Error(`Too many attempts. Try again in ${secs}s.`);
  }
}

async function recordFailure(kind: AuthKind) {
  const map = await readLockouts();
  const failures = (map[kind]?.failures ?? 0) + 1;
  let lockedUntil = 0;
  if (failures >= MAX_ATTEMPTS) {
    const over = failures - MAX_ATTEMPTS;
    const window = Math.min(MAX_LOCK_MS, BASE_LOCK_MS * Math.pow(2, over));
    lockedUntil = Date.now() + window;
  }
  map[kind] = { failures, lockedUntil };
  await writeLockouts(map);
}

async function clearFailures(kind: AuthKind) {
  const map = await readLockouts();
  if (map[kind]) {
    delete map[kind];
    await writeLockouts(map);
  }
}

// -- Signed License Credentials --------------------------------------------

export interface LicenseCredential {
  installationId: string;
  issuedAt: number;
  expiresAt: number;
  keyId: string;
  signatureB64: string;
}

// Legacy support for components
export interface LicenseRecord {
  activatedAt: number;
  expiresAt: number;
  renewals: number;
}
export const LICENSE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

export async function getInstallationId(): Promise<string> {
  let id = await metaGet<string>("installation_id");
  if (!id) {
    id = crypto.randomUUID();
    await metaSet("installation_id", id);
  }
  return id;
}

export async function verifyLicenseCredential(cred: LicenseCredential): Promise<boolean> {
  try {
    const pubKeyData = await metaGet<Uint8Array>(AUTHORITY_PUB_KEY_KEY);
    if (!pubKeyData) return false;

    const pubKey = await crypto.subtle.importKey(
      "raw",
      pubKeyData,
      { name: "Ed25519", namedCurve: "Ed25519" },
      true,
      ["verify"]
    );

    const encoder = new TextEncoder();
    const data = encoder.encode(
      JSON.stringify({
        installationId: cred.installationId,
        issuedAt: cred.issuedAt,
        expiresAt: cred.expiresAt,
        keyId: cred.keyId,
      })
    );

    const sig = fromB64(cred.signatureB64);
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      pubKey,
      sig,
      data
    );
  } catch (err) {
    console.error("License verification failed", err);
    return false;
  }
}

export async function activateLicense(cred: LicenseCredential): Promise<boolean> {
  const myId = await getInstallationId();
  if (cred.installationId !== myId) {
    throw new Error("Credential bound to a different device");
  }

  const valid = await verifyLicenseCredential(cred);
  if (!valid) {
    await recordFailure("license-activation");
    throw new Error("Invalid license signature");
  }

  if (Date.now() > cred.expiresAt) {
    throw new Error("Credential has already expired");
  }

  await metaSet(LICENSE_CREDENTIAL_KEY, cred);
  await clearFailures("license-activation");
  emit();
  return true;
}

export async function getLicense(): Promise<LicenseCredential | undefined> {
  return metaGet<LicenseCredential>(LICENSE_CREDENTIAL_KEY);
}

// Map Credential to legacy Record for UI components
export async function getLicenseRecord(): Promise<LicenseRecord | undefined> {
  const cred = await getLicense();
  if (!cred) return undefined;
  return {
    activatedAt: cred.issuedAt,
    expiresAt: cred.expiresAt,
    renewals: 1, // Simplified for now
  };
}

export async function isLicenseActive(): Promise<boolean> {
  const cred = await getLicense();
  if (!cred) return false;
  const now = Date.now();
  if (now > cred.expiresAt) return false;
  return await verifyLicenseCredential(cred);
}

// -- Daily PIN (User Data Protection) ---------------------------------------

interface PinRecord {
  saltB64: string;
  verifierB64: string;
  iterations: number;
}

async function deriveKey(pin: string, salt: Uint8Array, iterations: number) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey("raw", enc.encode(pin), { name: "PBKDF2" }, false, [
    "deriveBits",
  ]);
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt.buffer, iterations, hash: "SHA-256" },
    baseKey,
    256,
  );
}

export async function hasDailyPin(): Promise<boolean> {
  return !!(await metaGet<PinRecord>(DAILY_PIN_VERIFIER_KEY));
}

export async function setDailyPin(pin: string): Promise<void> {
  if (pin.length < 6) throw new Error("Daily PIN must be at least 6 characters");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 150_000;
  const key = await deriveKey(pin, salt, iterations);
  await metaSet(DAILY_PIN_VERIFIER_KEY, {
    saltB64: b64(salt),
    verifierB64: b64(key),
    iterations,
  } as PinRecord);
  _unlocked = true;
  emit();
}

export async function verifyDailyPin(pin: string): Promise<boolean> {
  await assertNotLocked("daily-pin");
  const rec = await metaGet<PinRecord>(DAILY_PIN_VERIFIER_KEY);
  if (!rec) return false;
  const salt = fromB64(rec.saltB64);
  const key = await deriveKey(pin, salt, rec.iterations);
  const a = new Uint8Array(key);
  const b = fromB64(rec.verifierB64);
  let good = a.length === b.length;
  if (good) {
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    good = diff === 0;
  }
  if (good) {
    _unlocked = true;
    emit();
    await clearFailures("daily-pin");
  } else {
    await recordFailure("daily-pin");
  }
  return good;
}

export async function changeDailyPin(oldPin: string, newPin: string): Promise<boolean> {
  const ok = await verifyDailyPin(oldPin);
  if (!ok) return false;
  await setDailyPin(newPin);
  return true;
}

export async function clearDailyPin(): Promise<void> {
  await metaSet(DAILY_PIN_VERIFIER_KEY, undefined);
  lock();
}

// -- Unlock State -----------------------------------------------------------

let _unlocked = false;
const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}

export function subscribeUnlock(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function isUnlocked() {
  return _unlocked;
}
export function lock() {
  _unlocked = false;
  emit();
}

export function markUnlocked() {
  _unlocked = true;
  emit();
  clearFailures("daily-pin").catch(() => {});
}

// -- Helpers ----------------------------------------------------------------

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// -- Simulation Helpers (FOR PROTOTYPE/TESTS ONLY) ---------------------------

export async function simulateIssueCredential(
  installationId: string,
  validityDays: number,
  keyPair: CryptoKeyPair
): Promise<LicenseCredential> {
  const now = Date.now();
  const expiresAt = now + validityDays * 24 * 60 * 60 * 1000;
  const keyId = "dev-v1";

  const encoder = new TextEncoder();
  const payload = {
    installationId,
    issuedAt: now,
    expiresAt,
    keyId,
  };
  const data = encoder.encode(JSON.stringify(payload));

  const sig = await crypto.subtle.sign(
    { name: "Ed25519" },
    keyPair.privateKey,
    data
  );

  return {
    ...payload,
    signatureB64: b64(sig),
  };
}

export async function rotateAuthority(): Promise<CryptoKeyPair> {
  const pair = await crypto.subtle.generateKey(
    { name: "Ed25519", namedCurve: "Ed25519" },
    true,
    ["sign", "verify"]
  );
  const pubRaw = await crypto.subtle.exportKey("raw", pair.publicKey);
  await metaSet(AUTHORITY_PUB_KEY_KEY, new Uint8Array(pubRaw));
  return pair;
}

// Legacy exports
export const hasPin = hasDailyPin;
export const verifyPin = verifyDailyPin;
export const setPin = setDailyPin;
export const changePin = changeDailyPin;
export const clearPin = clearDailyPin;
export const hasMasterPin = async () => false;
export const setupMasterPin = async () => { throw new Error("Use operations activation"); };
export const renewLicense = async () => { throw new Error("Use operations activation"); };
export const changeMasterPin = async () => { throw new Error("Not supported"); };
