import { b64, fromB64 } from "./crypto-utils";
import type { LicenseCredential } from "./crypto";

/**
 * OFFLINE Operations License Issuer.
 * This module is excluded from the customer bundle in production.
 */

export interface OperationsAuthority {
  keyId: string;
  publicKeyB64: string;
  privateKey?: CryptoKey; // Sensitive, only in Operations tool memory
}

export async function createOperationsAuthority(keyId: string): Promise<{
  authority: OperationsAuthority;
  keyPair: CryptoKeyPair;
}> {
  const keyPair = (await crypto.subtle.generateKey(
    { name: "Ed25519", namedCurve: "Ed25519" } as unknown as EcKeyGenParams,
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const pubRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);

  return {
    authority: {
      keyId,
      publicKeyB64: b64(pubRaw),
      privateKey: keyPair.privateKey,
    },
    keyPair,
  };
}

export async function issueSignedCredential(
  authority: OperationsAuthority,
  privateKey: CryptoKey,
  installationId: string,
  type: "activation" | "renewal" | "recovery",
  days: number,
): Promise<LicenseCredential> {
  const now = Date.now();
  const expiresAt = now + days * 24 * 60 * 60 * 1000;

  const payload = {
    installationId,
    issuedAt: now,
    expiresAt,
    keyId: authority.keyId,
    credentialType: type,
  };

  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(payload));

  const sig = await crypto.subtle.sign(
    { name: "Ed25519" } as unknown as AlgorithmIdentifier,
    privateKey,
    data,
  );

  return {
    ...payload,
    signatureB64: b64(sig),
  };
}

// Key Export/Import for Operations tool persistence
export async function exportPrivateKey(key: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey("pkcs8", key);
  return b64(exported);
}

export async function importPrivateKey(b64Str: string): Promise<CryptoKey> {
  const buf = fromB64(b64Str);
  return await crypto.subtle.importKey(
    "pkcs8",
    buf.buffer as ArrayBuffer,
    { name: "Ed25519", namedCurve: "Ed25519" } as unknown as AlgorithmIdentifier,
    true,
    ["sign"],
  );
}
