import { describe, expect, it } from "vitest";
import { shouldRegisterServiceWorker } from "./pwa";

const prod = { isProd: true, inIframe: false };

describe("shouldRegisterServiceWorker", () => {
  it("registers on a real production host", () => {
    expect(shouldRegisterServiceWorker({ hostname: "ethiotrack.app", search: "" }, prod)).toBe(
      true,
    );
  });

  it("never registers in dev or inside an iframe", () => {
    expect(
      shouldRegisterServiceWorker(
        { hostname: "ethiotrack.app", search: "" },
        { isProd: false, inIframe: false },
      ),
    ).toBe(false);
    expect(
      shouldRegisterServiceWorker(
        { hostname: "ethiotrack.app", search: "" },
        { isProd: true, inIframe: true },
      ),
    ).toBe(false);
  });

  it("never registers on Lovable preview hosts", () => {
    for (const hostname of [
      "id-preview--abc.lovable.app",
      "preview--abc.lovable.app",
      "lovableproject.com",
      "x.lovableproject.com",
      "x.lovableproject-dev.com",
      "beta.lovable.dev",
      "x.beta.lovable.dev",
    ]) {
      expect(shouldRegisterServiceWorker({ hostname, search: "" }, prod)).toBe(false);
    }
  });

  it("honours the ?sw=off kill switch", () => {
    expect(
      shouldRegisterServiceWorker({ hostname: "ethiotrack.app", search: "?sw=off" }, prod),
    ).toBe(false);
  });
});
