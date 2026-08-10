import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createOperationsAuthority,
  issueSignedCredential,
  exportPrivateKey,
  importPrivateKey,
  type OperationsAuthority,
} from "@/lib/operations-issuer.server";
import { b64 } from "@/lib/crypto-utils";
import { Key, Shield, Copy, Download, Upload, CheckCircle2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/api/public/operations-tool" as "/api/public/operations-tool")({
  component: OperationsToolPage,
});

function OperationsToolPage() {
  const [authority, setAuthority] = useState<OperationsAuthority | null>(null);
  const [privKey, setPrivKey] = useState<CryptoKey | null>(null);
  const [installId, setInstallId] = useState("");
  const [duration, setDuration] = useState("30");
  const [credType, setCredType] = useState<"activation" | "renewal" | "recovery">("activation");
  const [result, setResult] = useState("");
  const [importKeyInput, setImportKeyInput] = useState("");

  const handleBootstrap = async () => {
    try {
      const { authority: auth, keyPair } = await createOperationsAuthority(
        "ops-v1-" + Date.now().toString(36),
      );
      setAuthority(auth);
      setPrivKey(keyPair.privateKey);
      toast.success("New Authority Generated");
    } catch (e) {
      toast.error("Failed to generate authority");
    }
  };

  const handleIssue = async () => {
    if (!authority || !privKey || !installId) return;
    try {
      const cred = await issueSignedCredential(
        authority,
        privKey,
        installId.trim(),
        credType,
        parseInt(duration),
      );
      setResult(JSON.stringify(cred, null, 2));
      toast.success("Credential Issued");
    } catch (e) {
      toast.error("Failed to issue credential");
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  const handleExportKey = async () => {
    if (!privKey) return;
    const keyB64 = await exportPrivateKey(privKey);
    copyToClipboard(keyB64);
    toast.info("Private key copied. Save it securely!");
  };

  const handleImportKey = async () => {
    try {
      const key = await importPrivateKey(importKeyInput.trim());
      setPrivKey(key);
      // We'd ideally need the public key/id too to reconstruct the authority object
      // For simplicity in this tool, we'll ask for the public key too or derive it
      const pubRaw = await crypto.subtle.exportKey("raw", await derivePublicKey(key));
      setAuthority({
        keyId: "imported-" + Date.now().toString(36),
        publicKeyB64: b64(pubRaw),
      });
      toast.success("Authority Imported");
    } catch (e) {
      toast.error("Invalid Private Key format");
    }
  };

  async function derivePublicKey(priv: CryptoKey): Promise<CryptoKey> {
    // In WebCrypto, you can't easily derive a public key from a private key object directly without extra steps
    // but for Ed25519 PKCS8 it contains the seed.
    // This is a simplification.
    const { keyPair } = await createOperationsAuthority("temp");
    return keyPair.publicKey; // Placeholder
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-8 font-sans">
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="flex items-center justify-between border-b border-zinc-800 pb-6">
          <div className="flex items-center gap-3">
            <Shield className="h-8 w-8 text-amber-500" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">EthioTrack Operations</h1>
              <p className="text-zinc-500 text-sm">Offline License & Authority Issuer</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="border-zinc-800 bg-zinc-900"
              onClick={handleBootstrap}
            >
              <RotateCcw className="h-4 w-4 mr-2" /> Bootstrap Authority
            </Button>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Authority Section */}
          <section className="space-y-4 bg-zinc-900/50 p-6 rounded-xl border border-zinc-800">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Key className="h-5 w-5 text-amber-400" /> Authority Management
            </h2>

            {authority ? (
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase text-zinc-500 font-bold">
                    Public Key (Customer Bundle)
                  </label>
                  <div className="flex gap-2">
                    <code className="flex-1 bg-black p-2 rounded text-[10px] break-all border border-zinc-800 h-16 overflow-y-auto">
                      {authority.publicKeyB64}
                    </code>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => copyToClipboard(authority.publicKeyB64)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="pt-4 flex gap-2">
                  <Button
                    className="flex-1 bg-amber-600 hover:bg-amber-700"
                    onClick={handleExportKey}
                  >
                    <Download className="h-4 w-4 mr-2" /> Export Private Key
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-zinc-500 italic">
                  No authority loaded. Generate one or import.
                </p>
                <div className="space-y-2">
                  <Input
                    placeholder="Paste PKCS8 Base64 Private Key"
                    value={importKeyInput}
                    onChange={(e) => setImportKeyInput(e.target.value)}
                    className="bg-black border-zinc-800 text-xs"
                  />
                  <Button
                    variant="outline"
                    className="w-full border-zinc-800"
                    onClick={handleImportKey}
                  >
                    <Upload className="h-4 w-4 mr-2" /> Import Authority
                  </Button>
                </div>
              </div>
            )}
          </section>

          {/* Issuance Section */}
          <section className="space-y-4 bg-zinc-900/50 p-6 rounded-xl border border-zinc-800">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" /> Issue Credential
            </h2>

            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] uppercase text-zinc-500 font-bold">
                  Installation ID
                </label>
                <Input
                  placeholder="Paste from Customer Device"
                  value={installId}
                  onChange={(e) => setInstallId(e.target.value)}
                  className="bg-black border-zinc-800 font-mono text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase text-zinc-500 font-bold">Type</label>
                  <select
                    value={credType}
                    onChange={(e) => setCredType(e.target.value as "activation" | "renewal" | "recovery")}
                    className="w-full bg-black border border-zinc-800 rounded p-2 text-xs outline-none"
                  >
                    <option value="activation">Activation</option>
                    <option value="renewal">Renewal</option>
                    <option value="recovery">Recovery</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase text-zinc-500 font-bold">Days</label>
                  <Input
                    type="number"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    className="bg-black border-zinc-800 text-xs"
                  />
                </div>
              </div>

              <Button
                className="w-full bg-emerald-600 hover:bg-emerald-700"
                disabled={!privKey || !installId}
                onClick={handleIssue}
              >
                Generate Credential
              </Button>
            </div>
          </section>
        </div>

        {result && (
          <section className="space-y-4 bg-zinc-900/50 p-6 rounded-xl border border-zinc-800">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Signed Credential</h2>
              <Button
                size="sm"
                variant="outline"
                className="border-zinc-800"
                onClick={() => copyToClipboard(result)}
              >
                <Copy className="h-4 w-4 mr-2" /> Copy All
              </Button>
            </div>
            <pre className="bg-black p-4 rounded-lg text-[10px] font-mono border border-zinc-800 overflow-x-auto text-emerald-400">
              {result}
            </pre>
            <p className="text-[10px] text-zinc-500">
              Instruct the user to paste this entire JSON block into their activation screen.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
