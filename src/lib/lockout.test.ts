import { describe, it, expect, beforeEach, vi } from "vitest";
import { getLockoutStatus, verifyDailyPin, setDailyPin, lock } from "./crypto";
import { db } from "./db";

vi.mock("./db", async () => {
  const actual = await vi.importActual("./db") as any;
  let store: Record<string, any> = {};
  return {
    ...actual,
    metaGet: vi.fn(async (key) => store[key]),
    metaSet: vi.fn(async (key, val) => { store[key] = val; }),
    accountIsEmpty: vi.fn(async () => false),
  };
});

describe("Lockout State Machine", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    lock();
    // Clear storage by resetting the mock's internal state via re-importing would be hard,
    // so we just rely on the manual setDailyPin to establish a baseline.
    await setDailyPin("123456");
  });

  it("should have full attempts budget initially", async () => {
    const status = await getLockoutStatus("daily-pin");
    expect(status.failures).toBe(0);
    expect(status.attemptsLeft).toBe(5);
    expect(status.locked).toBe(false);
  });

  it("should decrement attempts on failure", async () => {
    await verifyDailyPin("wrong");
    const status = await getLockoutStatus("daily-pin");
    expect(status.failures).toBe(1);
    expect(status.attemptsLeft).toBe(4);
  });

  it("should lock after 5 failures", async () => {
    for (let i = 0; i < 5; i++) {
      await verifyDailyPin("wrong");
    }
    const status = await getLockoutStatus("daily-pin");
    expect(status.locked).toBe(true);
    expect(status.attemptsLeft).toBe(0);
    expect(status.msRemaining).toBeGreaterThan(0);
  });

  it("should allow recovery after timeout", async () => {
    vi.useFakeTimers();
    
    // Lock it
    for (let i = 0; i < 5; i++) {
      await verifyDailyPin("wrong");
    }
    
    // Fast forward 31 seconds (BASE_LOCK_MS = 30s)
    vi.advanceTimersByTime(31000);
    
    const status = await getLockoutStatus("daily-pin");
    expect(status.locked).toBe(false);
    expect(status.failures).toBe(0);
    expect(status.attemptsLeft).toBe(5);
    
    vi.useRealTimers();
  });

  it("should escalate lockout duration on repeated failures", async () => {
    vi.useFakeTimers();
    
    // First lock (30s)
    for (let i = 0; i < 5; i++) await verifyDailyPin("wrong");
    let status = await getLockoutStatus("daily-pin");
    expect(status.msRemaining).toBeLessThanOrEqual(30000);
    
    vi.advanceTimersByTime(31000);
    
    // Second lock (should be 60s)
    for (let i = 0; i < 5; i++) await verifyDailyPin("wrong");
    status = await getLockoutStatus("daily-pin");
    expect(status.msRemaining).toBeGreaterThan(30000);
    expect(status.msRemaining).toBeLessThanOrEqual(60000);
    
    vi.useRealTimers();
  });

  it("should reset everything on success", async () => {
    await verifyDailyPin("wrong");
    await verifyDailyPin("123456");
    
    const status = await getLockoutStatus("daily-pin");
    expect(status.failures).toBe(0);
    expect(status.lockLevel).toBe(0);
  });
});
