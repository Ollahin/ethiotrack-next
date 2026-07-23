// Biometric unlock via WebAuthn. Since v1 doesn't encrypt data at rest,
// biometrics just gate the UI: a successful platform-authenticator assertion
// flips the same _unlocked flag the PIN would. PIN remains as fallback and
// is still required for master actions.

import { metaGet, metaSet } from "./db";

const BIO_META_KEY = "biometric_v1";

interface BiometricRecord {
  credentialIdB64: string;
  createdAt: number;
  label?: string;
}

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function isBiometricSupported(): boolean {
  return typeof window !== "undefined"
    && typeof window.PublicKeyCredential !== "undefined"
    && typeof navigator !== "undefined"
    && !!navigator.credentials?.create
    && !!navigator.credentials?.get;
}

export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isBiometricSupported()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
}

export async function getBiometricRecord(): Promise<BiometricRecord | null> {
  return (await metaGet<BiometricRecord>(BIO_META_KEY)) ?? null;
}

export async function isBiometricEnabled(): Promise<boolean> {
  return !!(await getBiometricRecord());
}

export async function enrollBiometric(label?: string): Promise<BiometricRecord> {
  if (!isBiometricSupported()) throw new Error("Biometrics not supported on this device");
  const rpName = "EthioTrack";
  const rpId = window.location.hostname;
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const cred = await navigator.credentials.create({
    publicKey: {
      rp: { name: rpName, id: rpId },
      user: {
        id: userId,
        name: label ?? "ethiotrack-user",
        displayName: label ?? "EthioTrack user",
      },
      challenge,
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },   // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      timeout: 60_000,
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
      attestation: "none",
    },
  }) as PublicKeyCredential | null;

  if (!cred) throw new Error("Enrollment cancelled");

  const rec: BiometricRecord = {
    credentialIdB64: b64url(cred.rawId),
    createdAt: Date.now(),
    label,
  };
  await metaSet(BIO_META_KEY, rec);
  return rec;
}

export async function assertBiometric(): Promise<boolean> {
  const rec = await getBiometricRecord();
  if (!rec) return false;
  if (!isBiometricSupported()) throw new Error("Biometrics not supported on this device");
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      timeout: 60_000,
      rpId: window.location.hostname,
      userVerification: "required",
      allowCredentials: [{
        type: "public-key",
        id: fromB64url(rec.credentialIdB64),
        transports: ["internal"],
      }],
    },
  });
  return !!assertion;
}

export async function disableBiometric(): Promise<void> {
  await metaSet(BIO_META_KEY, undefined);
}