import { metaGet, metaSet } from "./db";
import { b64, fromB64 } from "./crypto-utils";

// State keys
const DAILY_PIN_VERIFIER_KEY = "daily_pin_v1";
const MASTER_PIN_VERIFIER_KEY = "master_pin_v1";
const LOCKOUT_META_KEY = "auth_lockout_v2"; // v2 for the new state machine
const LEGACY_LOCKOUT_META_KEY = "auth_lockout_v1";

// Constants
const MAX_ATTEMPTS = 5;
const BASE_LOCK_MS = 30 * 1000;
const MAX_LOCK_MS = 15 * 60 * 1000;

export type AuthKind = "daily-pin" | "master-pin";

/**
 * Persisted lockout state machine.
 */
interface LockoutEntry {
  failures: number; // Consecutive failures since last success or timeout
  lockLevel: number; // Escalation tier for progressive penalties
  lockedUntil: number; // Expiry timestamp
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
  const current = await metaGet<LockoutMap>(LOCKOUT_META_KEY);
  if (current) return current;
  return await migrateLegacyLockouts();
}

/**
 * Migrates any pre-existing auth_lockout_v1 payload into the v2 state machine.
 * Unknown/corrupt shapes degrade to a clean state rather than throwing.
 */
async function migrateLegacyLockouts(): Promise<LockoutMap> {
  const legacy = await metaGet<Record<string, unknown>>(LEGACY_LOCKOUT_META_KEY);
  const migrated: LockoutMap = {};
  if (legacy && typeof legacy === "object") {
    for (const kind of ["daily-pin", "master-pin"] as AuthKind[]) {
      const raw = legacy[kind] as Record<string, unknown> | undefined;
      if (!raw || typeof raw !== "object") continue;
      const failures = Number(raw["failures"] ?? raw["count"] ?? 0);
      const lockedUntil = Number(raw["lockedUntil"] ?? raw["until"] ?? 0);
      migrated[kind] = {
        failures: Number.isFinite(failures) ? Math.max(0, Math.min(MAX_ATTEMPTS, failures)) : 0,
        lockLevel: Number(raw["lockLevel"] ?? 0) || 0,
        lockedUntil: Number.isFinite(lockedUntil) && lockedUntil > Date.now() ? lockedUntil : 0,
      };
    }
  }
  await metaSet(LOCKOUT_META_KEY, migrated);
  return migrated;
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
  lockLevel: number;
}

/**
 * Derives current status from persistent state machine.
 * If a timeout was reached, it resets current failures to allow new attempts.
 */
export async function getLockoutStatus(kind: AuthKind): Promise<LockoutStatus> {
  const map = await readLockouts();
  const e = map[kind];
  const now = Date.now();

  // If we were locked but the time has passed, effectively reset the failure budget
  // but keep the lockLevel for future escalation.
  if (e && e.lockedUntil > 0 && e.lockedUntil <= now) {
    const updated: LockoutEntry = { ...e, failures: 0, lockedUntil: 0 };
    map[kind] = updated;
    await writeLockouts(map);
    return {
      locked: false,
      msRemaining: 0,
      failures: 0,
      attemptsLeft: MAX_ATTEMPTS,
      lockLevel: updated.lockLevel,
    };
  }

  const msRemaining = e && e.lockedUntil > now ? e.lockedUntil - now : 0;
  const failures = e?.failures ?? 0;
  const locked = msRemaining > 0;

  return {
    locked,
    msRemaining,
    failures,
    // Invariant: an enabled (unlocked) form always exposes at least one attempt.
    attemptsLeft: locked ? 0 : Math.max(1, MAX_ATTEMPTS - failures),
    lockLevel: e?.lockLevel ?? 0,
  };
}

async function recordFailure(kind: AuthKind) {
  const map = await readLockouts();
  const current = map[kind] ?? { failures: 0, lockLevel: 0, lockedUntil: 0 };

  const failures = current.failures + 1;
  let lockedUntil = 0;
  let lockLevel = current.lockLevel;

  if (failures >= MAX_ATTEMPTS) {
    // Escalation: 30s, 60s, 120s... up to 15m
    const duration = Math.min(MAX_LOCK_MS, BASE_LOCK_MS * Math.pow(2, lockLevel));
    lockedUntil = Date.now() + duration;
    lockLevel++; // Escalates tier for the NEXT lock
  }

  map[kind] = { failures, lockLevel, lockedUntil };
  await writeLockouts(map);
}

async function clearFailures(kind: AuthKind) {
  const map = await readLockouts();
  if (map[kind]) {
    // Full reset on success
    delete map[kind];
    await writeLockouts(map);
  }
}

// -- Crypto Helpers (PBKDF2) --------------------------------------------------

async function deriveKey(pin: string, salt: Uint8Array, iterations: number) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey("raw", enc.encode(pin), { name: "PBKDF2" }, false, [
    "deriveBits",
  ]);
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    baseKey,
    256,
  );
}

async function verifyHash(
  pin: string,
  rec: { saltB64: string; verifierB64: string; iterations: number },
) {
  const salt = fromB64(rec.saltB64);
  const key = await deriveKey(pin, salt, rec.iterations);
  const a = new Uint8Array(key);
  const b = fromB64(rec.verifierB64);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// -- Master PIN (Operations Access Control) -----------------------------------

export async function hasMasterPin(): Promise<boolean> {
  return !!(await metaGet(MASTER_PIN_VERIFIER_KEY));
}

export async function setMasterPin(pin: string): Promise<void> {
  if (pin.length < 6) throw new Error("Master PIN must be at least 6 characters");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 200_000;
  const key = await deriveKey(pin, salt, iterations);
  await metaSet(MASTER_PIN_VERIFIER_KEY, {
    saltB64: b64(salt),
    verifierB64: b64(key),
    iterations,
  });
}

export async function verifyMasterPin(pin: string): Promise<boolean> {
  const statusBefore = await getLockoutStatus("master-pin");
  if (statusBefore.locked) return false;

  const rec = await metaGet<{ saltB64: string; verifierB64: string; iterations: number }>(
    MASTER_PIN_VERIFIER_KEY,
  );
  if (!rec) return false;
  const ok = await verifyHash(pin, rec);
  if (ok) {
    await clearFailures("master-pin");
  } else {
    await recordFailure("master-pin");
  }
  return ok;
}

// -- Daily PIN (User Data Protection) ---------------------------------------

export async function hasDailyPin(): Promise<boolean> {
  return !!(await metaGet(DAILY_PIN_VERIFIER_KEY));
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
  });
  _unlocked = true;
  emit();
}

export async function verifyDailyPin(pin: string): Promise<boolean> {
  const statusBefore = await getLockoutStatus("daily-pin");
  if (statusBefore.locked) return false;

  const rec = await metaGet<{ saltB64: string; verifierB64: string; iterations: number }>(
    DAILY_PIN_VERIFIER_KEY,
  );
  if (!rec) return false;
  const ok = await verifyHash(pin, rec);
  if (ok) {
    _unlocked = true;
    emit();
    await clearFailures("daily-pin");
  } else {
    await recordFailure("daily-pin");
  }
  return ok;
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

// Compatibility & RESTORED exports
export const hasPin = hasDailyPin;
export const verifyPin = verifyDailyPin;
export const setPin = setDailyPin;
export const changePin = changeDailyPin;
export const clearPin = clearDailyPin;
export const setupMasterPin = setMasterPin;
export const renewLicense = async () => {}; // Restored stub
export const changeMasterPin = async (oldPin: string, newPin: string) => {
  const ok = await verifyMasterPin(oldPin);
  if (!ok) return false;
  await setMasterPin(newPin);
  return true;
};
