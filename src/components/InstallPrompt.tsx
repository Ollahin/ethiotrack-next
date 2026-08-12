import React, { useEffect, useState } from "react";
import { Download, Share } from "lucide-react";
import { Button } from "./ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    // Check if already installed
    const nav = window.navigator as Navigator & { standalone?: boolean };
    if (window.matchMedia("(display-mode: standalone)").matches || nav.standalone) {
      setIsStandalone(true);
      return;
    }

    // Android/Chrome prompt
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowPrompt(true);
    };

    window.addEventListener("beforeinstallprompt", handler);

    // iOS detection
    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !("MSStream" in window);
    setIsIOS(isIOSDevice);
    if (isIOSDevice) {
      setShowPrompt(true);
    }

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setDeferredPrompt(null);
      setShowPrompt(false);
    }
  };

  if (isStandalone || !showPrompt) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-lg ring-1 ring-black/5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Download className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Install EthioTrack</h3>
              <p className="text-xs text-muted-foreground">
                Install as an app for offline access and faster performance.
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 rounded-full p-0"
            onClick={() => setShowPrompt(false)}
          >
            <span className="sr-only">Close</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </Button>
        </div>

        {isIOS ? (
          <div className="rounded-lg bg-muted/50 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
            <div className="flex items-center gap-1.5 font-medium text-foreground">
              <Share className="h-3 w-3" /> Step 1: Tap the Share button
            </div>
            <div className="mt-1 flex items-center gap-1.5 font-medium text-foreground">
              <div className="flex h-3 w-3 items-center justify-center rounded-sm border border-current text-[8px]">
                +
              </div>{" "}
              Step 2: Select 'Add to Home Screen'
            </div>
          </div>
        ) : (
          <Button onClick={handleInstall} className="w-full shadow-sm" size="sm">
            Install Now
          </Button>
        )}
      </div>
    </div>
  );
}
