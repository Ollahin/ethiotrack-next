import { b64 } from "./crypto-utils";
import type { LicenseCredential } from "./crypto";

export async function simulateIssueCredential(
  installationId: string,
  validityDays: number,
  keyPair: CryptoKeyPair,
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

  const sig = await crypto.subtle.sign({ name: "Ed25519" }, keyPair.privateKey, data);

  return {
    ...payload,
    signatureB64: b64(sig),
  };
}

export async function generateAuthorityKeyPair(): Promise<CryptoKeyPair> {
  return await crypto.subtle.generateKey({ name: "Ed25519", namedCurve: "Ed25519" }, true, [
    "sign",
    "verify",
  ]);
}
