import { describe, it, expect, beforeEach, vi } from "vitest";
import { 
  verifyDailyPin, 
  setDailyPin, 
  lock, 
  getLockoutStatus,
  hasDailyPin
} from "./crypto";
import { b64, fromB64 } from "./crypto-utils";

let metaStore: Record<string, any> = {};

vi.mock("./db", async () => {
  return {
    metaGet: vi.fn(async (key) => metaStore[key]),
    metaSet: vi.fn(async (key, val) => {
      metaStore[key] = val;
    }),
    accountIsEmpty: vi.fn(async () => false),
  };
});

describe("Daily PIN Schema Migration (TASK AUTH-R1)", () => {
  beforeEach(async () => {
    metaStore = {};
    vi.clearAllMocks();
    lock();
  });

  async function simulateLegacyVerifier(pin: string, iterations: number) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
      "raw", 
      enc.encode(pin), 
      { name: "PBKDF2" }, 
      false, 
      ["deriveBits"]
    );
    const key = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      baseKey,
      256
    );
    
    metaStore["daily_pin_v1"] = {
      saltB64: b64(salt),
      verifierB64: b64(new Uint8Array(key)),
      iterations: iterations
    };
  }

  it("1. Current verifier (150k) succeeds and stays at 150k", async () => {
    const pin = "123456";
    await setDailyPin(pin);
    const initialVerifier = metaStore["daily_pin_v1"];
    expect(initialVerifier.iterations).toBe(150000);

    const ok = await verifyDailyPin(pin);
    expect(ok).toBe(true);
    
    const finalVerifier = metaStore["daily_pin_v1"];
    expect(finalVerifier.iterations).toBe(150000);
    // Should be exact same record (or at least same parameters if salt wasn't changed)
    expect(finalVerifier.saltB64).toBe(initialVerifier.saltB64);
  });

  it("2. Legacy weaker verifier (1000) succeeds and upgrades to 150k", async () => {
    const pin = "654321";
    await simulateLegacyVerifier(pin, 1000);
    const legacyVerifier = metaStore["daily_pin_v1"];
    expect(legacyVerifier.iterations).toBe(1000);

    const ok = await verifyDailyPin(pin);
    expect(ok).toBe(true);
    
    const upgradedVerifier = metaStore["daily_pin_v1"];
    expect(upgradedVerifier.iterations).toBe(150000);
    expect(upgradedVerifier.saltB64).not.toBe(legacyVerifier.saltB64);
    
    // Verify it still works with the new parameters
    lock();
    const ok2 = await verifyDailyPin(pin);
    expect(ok2).toBe(true);
  });

  it("4. Wrong PIN against 1000-iteration verifier fails and does not upgrade", async () => {
    const pin = "correct-pin";
    await simulateLegacyVerifier(pin, 1000);
    const initialVerifier = metaStore["daily_pin_v1"];

    const ok = await verifyDailyPin("wrong-pin");
    expect(ok).toBe(false);
    
    const verifierAfter = metaStore["daily_pin_v1"];
    expect(verifierAfter.iterations).toBe(1000);
    expect(verifierAfter.saltB64).toBe(initialVerifier.saltB64);
    
    const status = await getLockoutStatus("daily-pin");
    expect(status.failures).toBe(1);
  });

  it("7. Higher-than-current iteration verifier is NOT downgraded", async () => {
    const pin = "strong-pin";
    await simulateLegacyVerifier(pin, 300000);
    const initialVerifier = metaStore["daily_pin_v1"];

    const ok = await verifyDailyPin(pin);
    expect(ok).toBe(true);
    
    const finalVerifier = metaStore["daily_pin_v1"];
    expect(finalVerifier.iterations).toBe(300000);
    expect(finalVerifier.saltB64).toBe(initialVerifier.saltB64);
  });

  it("8. Malformed verifier fails closed and does not reset", async () => {
    metaStore["daily_pin_v1"] = { 
      saltB64: "invalid",
      verifierB64: "invalid",
      iterations: "not-a-number" 
    };

    const ok = await verifyDailyPin("any-pin");
    expect(ok).toBe(false);
    
    // Check it didn't wipe data or reset verifier to a default
    expect(metaStore["daily_pin_v1"].iterations).toBe("not-a-number");
    expect(await hasDailyPin()).toBe(true);
  });
});
