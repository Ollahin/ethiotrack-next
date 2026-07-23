// Simple local PIN gate. Stores a PBKDF2 verifier + salt in Dexie meta.
// The derived key is kept in-memory only. v1 does not field-encrypt data,
// but the gate blocks casual access to the UI.

import { metaGet, metaSet } from "./db";

const PIN_META_KEY = "pin_v1";

interface PinRecord {
  saltB64: string;
  verifierB64: string;
  iterations: number;
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