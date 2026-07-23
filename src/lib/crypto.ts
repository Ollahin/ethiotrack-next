// Simple local PIN gate. Stores a PBKDF2 verifier + salt in Dexie meta.
// The derived key is kept in-memory only. v1 does not field-encrypt data,
// but the gate blocks casual access to the UI.

import { metaGet, metaSet } from "./db";

const PIN_META_KEY = "pin_v1";
const MASTER_PIN_META_KEY = "master_pin_v1";
const LICENSE_META_KEY = "license_v1";

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
  const rec = await metaGet<PinRecord>(PIN_META_KEY);
  if (!rec) return false;
  const salt = fromB64(rec.saltB64);
  const key = await deriveKey(pin, salt, rec.iterations);
  const a = new Uint8Array(key);
  const b = fromB64(rec.verifierB64);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  const good = diff === 0;
  if (good) { _unlocked = true; emit(); }
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
  const rec = await metaGet<PinRecord>(MASTER_PIN_META_KEY);
  if (!rec) return false;
  const salt = fromB64(rec.saltB64);
  const key = await deriveKey(pin, salt, rec.iterations);
  const a = new Uint8Array(key);
  const b = fromB64(rec.verifierB64);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
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