// Simple local PIN gate. Stores a PBKDF2 verifier + salt in Dexie meta.
// The derived key is kept in-memory only. v1 does not field-encrypt data,
// but the gate blocks casual access to the UI.

import { metaGet, metaSet } from "./db";

const PIN_META_KEY = "pin_v1";
const MASTER_PIN_META_KEY = "master_pin_v1";
const LICENSE_META_KEY = "license_v1";
const LOCKOUT_META_KEY = "pin_lockout_v1";

// Rate limiting: after MAX_ATTEMPTS wrong PINs, lock for a doubling window
// starting at BASE_LOCK_MS and capping at MAX_LOCK_MS. Successful verify
// clears the counter.
const MAX_ATTEMPTS = 5;
const BASE_LOCK_MS = 30 * 1000;
const MAX_LOCK_MS = 15 * 60 * 1000;

export type PinKind = "user" | "master";

interface LockoutEntry { failures: number; lockedUntil: number }
type LockoutMap = Partial<Record<PinKind, LockoutEntry>>;

const lockoutListeners = new Set<() => void>();
export function subscribeLockout(l: () => void) {
  lockoutListeners.add(l);
  return () => lockoutListeners.delete(l);
}
function emitLockout() { for (const l of lockoutListeners) l(); }

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

export async function getLockoutStatus(kind: PinKind): Promise<LockoutStatus> {
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

async function assertNotLocked(kind: PinKind) {
  const s = await getLockoutStatus(kind);
  if (s.locked) {
    const secs = Math.ceil(s.msRemaining / 1000);
    throw new Error(`Too many attempts. Try again in ${secs}s.`);
  }
}

async function recordFailure(kind: PinKind) {
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

async function clearFailures(kind: PinKind) {
  const map = await readLockouts();
  if (map[kind]) { delete map[kind]; await writeLockouts(map); }
}

// One "month" of access granted per master-PIN renewal.
export const LICENSE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

interface PinRecord {
  saltB64: string;
  verifierB64: string;
  iterations: number;
}

export interface LicenseRecord {
  activatedAt: number;
  expiresAt: number;
  renewals: number;
}

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

async function deriveKey(pin: string, salt: Uint8Array, iterations: number) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw", enc.encode(pin), { name: "PBKDF2" }, false, ["deriveBits"],
  );
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    baseKey, 256,
  );
}

let _unlocked = false;
let listeners = new Set<() => void>();
function emit() { for (const l of listeners) l(); }

export function subscribeUnlock(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function isUnlocked() { return _unlocked; }
export function lock() { _unlocked = false; emit(); }

/** Mark the app as unlocked without a PIN (e.g. after biometric assertion). */
export function markUnlocked() {
  _unlocked = true;
  emit();
  clearFailures("user").catch(() => {});
}

export async function hasPin(): Promise<boolean> {
  return !!(await metaGet<PinRecord>(PIN_META_KEY));
}

export async function setPin(pin: string): Promise<void> {
  if (pin.length < 4) throw new Error("PIN must be at least 4 characters");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 150_000;
  const key = await deriveKey(pin, salt, iterations);
  await metaSet(PIN_META_KEY, {
    saltB64: b64(salt),
    verifierB64: b64(key),
    iterations,
  } as PinRecord);
  _unlocked = true;
  emit();
}

export async function verifyPin(pin: string): Promise<boolean> {
  await assertNotLocked("user");
  const rec = await metaGet<PinRecord>(PIN_META_KEY);
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
  if (good) { _unlocked = true; emit(); await clearFailures("user"); }
  else { await recordFailure("user"); }
  return good;
}

export async function changePin(oldPin: string, newPin: string): Promise<boolean> {
  const ok = await verifyPin(oldPin);
  if (!ok) return false;
  await setPin(newPin);
  return true;
}

export async function clearPin(): Promise<void> {
  await metaSet(PIN_META_KEY, undefined);
  lock();
}

// -- master PIN + monthly license -------------------------------------------

export async function hasMasterPin(): Promise<boolean> {
  return !!(await metaGet<PinRecord>(MASTER_PIN_META_KEY));
}

async function writeMasterPin(pin: string): Promise<void> {
  if (pin.length < 6) throw new Error("Master PIN must be at least 6 characters");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 200_000;
  const key = await deriveKey(pin, salt, iterations);
  await metaSet(MASTER_PIN_META_KEY, {
    saltB64: b64(salt),
    verifierB64: b64(key),
    iterations,
  } as PinRecord);
}

async function verifyMasterPinRaw(pin: string): Promise<boolean> {
  await assertNotLocked("master");
  const rec = await metaGet<PinRecord>(MASTER_PIN_META_KEY);
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
  if (good) await clearFailures("master");
  else await recordFailure("master");
  return good;
}

export async function getLicense(): Promise<LicenseRecord | undefined> {
  return metaGet<LicenseRecord>(LICENSE_META_KEY);
}

export async function isLicenseActive(): Promise<boolean> {
  const rec = await getLicense();
  if (!rec) return false;
  return Date.now() < rec.expiresAt;
}

/** Create the master PIN and activate the first month. Owner-only, first run. */
export async function setupMasterPin(pin: string): Promise<LicenseRecord> {
  await writeMasterPin(pin);
  const now = Date.now();
  const rec: LicenseRecord = {
    activatedAt: now,
    expiresAt: now + LICENSE_PERIOD_MS,
    renewals: 1,
  };
  await metaSet(LICENSE_META_KEY, rec);
  emit();
  return rec;
}

/** Verify master PIN and extend license by one month. Returns new record or null on wrong PIN. */
export async function renewLicense(masterPin: string): Promise<LicenseRecord | null> {
  const ok = await verifyMasterPinRaw(masterPin);
  if (!ok) return null;
  const prev = await getLicense();
  const now = Date.now();
  // Extend from whichever is later so paying early doesn't waste days.
  const base = prev && prev.expiresAt > now ? prev.expiresAt : now;
  const rec: LicenseRecord = {
    activatedAt: prev?.activatedAt ?? now,
    expiresAt: base + LICENSE_PERIOD_MS,
    renewals: (prev?.renewals ?? 0) + 1,
  };
  await metaSet(LICENSE_META_KEY, rec);
  emit();
  return rec;
}

/** Owner-only: change the master PIN (requires current master PIN). */
export async function changeMasterPin(oldPin: string, newPin: string): Promise<boolean> {
  const ok = await verifyMasterPinRaw(oldPin);
  if (!ok) return false;
  await writeMasterPin(newPin);
  return true;
}