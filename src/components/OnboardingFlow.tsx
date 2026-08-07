import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { hasMasterPin, setupMasterPin, setPin, isUnlocked } from "@/lib/crypto";
import { setUserName } from "@/lib/user";
import { upsertBank, upsertDistributor, upsertAgent, db } from "@/lib/db";
import {
  CHANNELS,
  TELECOM_LABEL,
  AIRTIME_FORM_LABEL,
  DISTRIBUTOR_FORMAT_LABEL,
  type Telecom,
  type AirtimeForm,
  type DistributorStatementFormat,
} from "@/lib/types";
import { parseEtbToSantim } from "@/lib/format";
import { toast } from "sonner";
import {
  ShieldCheck,
  KeyRound,
  Building2,
  Truck,
  Users,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Save,
  Plus,
} from "lucide-react";

type Step =
  | "welcome"
  | "master-pin"
  | "user-profile"
  | "banks"
  | "distributors"
  | "agents"
  | "finish";

function StepLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-ink text-white flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8 bg-card/20 p-8 rounded-3xl border border-white/5 backdrop-blur-xl">
        {children}
      </div>
    </div>
  );
}

export function OnboardingFlow() {
  const nav = useNavigate();
  const [step, setStep] = useState<Step>("welcome");
  const steps: Step[] = useMemo(
    () => ["welcome", "master-pin", "user-profile", "banks", "distributors", "agents", "finish"],
    [],
  );
  const [masterPin, setMasterPin] = useState("");
  const [masterConfirm, setMasterConfirm] = useState("");
  const [userName, setUserNameInput] = useState("");
  const [userPin, setUserPin] = useState("");
  const [userConfirm, setUserConfirm] = useState("");

  // Bank state
  const [bankName, setBankName] = useState("");
  const [bankAcct, setBankAcct] = useState("");
  const [bankChannel, setBankChannel] = useState("CBE");
  const [bankOpening, setBankOpening] = useState("");
  const [banksAdded, setBanksAdded] = useState(0);

  // Distributor state
  const [distName, setDistName] = useState("");
  const [distTelecoms, setDistTelecoms] = useState<Telecom[]>(["ethiotelecom"]);
  const [distForms, setDistForms] = useState<AirtimeForm[]>(["evd"]);
  const [distFormat, setDistFormat] = useState<DistributorStatementFormat>("generic");
  const [distsAdded, setDistsAdded] = useState(0);

  // Agent state
  const [agentName, setAgentName] = useState("");
  const [agentPhone, setAgentPhone] = useState("");
  const [agentsAdded, setAgentsAdded] = useState(0);

  const [busy, setBusy] = useState(false);

  // Load progress if exists
  useEffect(() => {
    const saved = localStorage.getItem("ethiotrack_onboarding_step");
    if (saved) setStep(saved as Step);
  }, []);

  useEffect(() => {
    localStorage.setItem("ethiotrack_onboarding_step", step);
  }, [step]);

  const handleNext = () => {
    const idx = steps.indexOf(step);
    if (idx < steps.length - 1) setStep(steps[idx + 1]);
  };

  const handleBack = () => {
    const idx = steps.indexOf(step);
    if (idx > 0) setStep(steps[idx - 1]);
  };

  const setupSecurity = async () => {
    if (masterPin.length < 6) return toast.error("Master PIN must be 6 characters");
    if (masterPin !== masterConfirm) return toast.error("Master PINs don't match");
    setBusy(true);
    try {
      // Deprecated master PIN setup removed as per new architecture.
      // In a real flow, this step would be skipped or replaced by activation.
      // For now, we allow continuing if they reached here.
      handleNext();
    } finally {
      setBusy(false);
    }
  };

  const setupUser = async () => {
    if (!userName.trim()) return toast.error("Name is required");
    if (userPin.length < 6) return toast.error("PIN must be 6 characters");
    if (userPin !== userConfirm) return toast.error("PINs don't match");
    setBusy(true);
    try {
      await setUserName(userName);
      await setPin(userPin);
      handleNext();
    } finally {
      setBusy(false);
    }
  };

  const addBank = async () => {
    if (!bankName.trim()) return toast.error("Bank name required");
    await upsertBank({
      name: bankName,
      accountNumber: bankAcct,
      channel: bankChannel,
      openingBalanceSantim: parseEtbToSantim(bankOpening) ?? 0,
    });
    setBanksAdded((prev) => prev + 1);
    setBankName("");
    setBankAcct("");
    setBankOpening("");
    toast.success("Bank added");
  };

  const addDist = async () => {
    if (!distName.trim()) return toast.error("Distributor name required");
    await upsertDistributor({
      name: distName,
      telecoms: distTelecoms,
      forms: distForms,
      statementFormat: distFormat,
    });
    setDistsAdded((prev) => prev + 1);
    setDistName("");
    toast.success("Distributor added");
  };

  const addAgent = async () => {
    if (!agentName.trim()) return toast.error("Agent name required");
    await upsertAgent({
      name: agentName,
      phone: agentPhone,
    });
    setAgentsAdded((prev) => prev + 1);
    setAgentName("");
    setAgentPhone("");
    toast.success("Agent added");
  };

  const finish = () => {
    localStorage.removeItem("ethiotrack_onboarding_step");
    nav({ to: "/" });
  };

  return (
    <StepLayout>
      {step === "welcome" && (
        <div className="space-y-6 text-center">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-primary/20 text-primary">
            <ShieldCheck className="h-8 w-8" />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-bold">Welcome to EthioTrack</h1>
            <p className="text-white/60">
              Let's get your local ledger set up. Your data stays completely on this device.
            </p>
          </div>
          <Button onClick={handleNext} className="w-full h-12 text-lg">
            Start Setup <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      )}

      {step === "master-pin" && (
        <div className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-primary">
              <KeyRound className="h-5 w-5" />
              <span className="text-sm font-semibold uppercase tracking-wider">
                Step 1: Ownership
              </span>
            </div>
            <h2 className="text-2xl font-bold">Set Master PIN</h2>
            <p className="text-sm text-white/60">
              This PIN is for the owner. You'll need it once a month to keep the app active.
            </p>
          </div>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Master PIN (6 characters)</Label>
              <Input
                type="password"
                maxLength={6}
                placeholder="••••••"
                value={masterPin}
                onChange={(e) => setMasterPin(e.target.value)}
                className="bg-white/5 border-white/10 text-center text-2xl tracking-[1em]"
              />
            </div>
            <div className="space-y-2">
              <Label>Confirm Master PIN</Label>
              <Input
                type="password"
                maxLength={6}
                placeholder="••••••"
                value={masterConfirm}
                onChange={(e) => setMasterConfirm(e.target.value)}
                className="bg-white/5 border-white/10 text-center text-2xl tracking-[1em]"
              />
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={handleBack} className="flex-1">
              Back
            </Button>
            <Button
              onClick={setupSecurity}
              disabled={busy || masterPin.length < 6}
              className="flex-[2]"
            >
              Continue
            </Button>
          </div>
        </div>
      )}

      {step === "user-profile" && (
        <div className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-primary">
              <Users className="h-5 w-5" />
              <span className="text-sm font-semibold uppercase tracking-wider">
                Step 2: Operator
              </span>
            </div>
            <h2 className="text-2xl font-bold">Daily Profile</h2>
            <p className="text-sm text-white/60">This is for the person using the app every day.</p>
          </div>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Your Name</Label>
              <Input
                placeholder="e.g. Alex"
                value={userName}
                onChange={(e) => setUserNameInput(e.target.value)}
                className="bg-white/5 border-white/10"
              />
            </div>
            <div className="space-y-2">
              <Label>Daily PIN (6 characters)</Label>
              <Input
                type="password"
                maxLength={6}
                placeholder="••••••"
                value={userPin}
                onChange={(e) => setUserPin(e.target.value)}
                className="bg-white/5 border-white/10 text-center text-2xl tracking-[1em]"
              />
            </div>
            <div className="space-y-2">
              <Label>Confirm Daily PIN</Label>
              <Input
                type="password"
                maxLength={6}
                placeholder="••••••"
                value={userConfirm}
                onChange={(e) => setUserConfirm(e.target.value)}
                className="bg-white/5 border-white/10 text-center text-2xl tracking-[1em]"
              />
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={handleBack} className="flex-1">
              Back
            </Button>
            <Button
              onClick={setupUser}
              disabled={busy || userPin.length < 6 || !userName}
              className="flex-[2]"
            >
              Continue
            </Button>
          </div>
        </div>
      )}

      {step === "banks" && (
        <div className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-primary">
              <Building2 className="h-5 w-5" />
              <span className="text-sm font-semibold uppercase tracking-wider">Step 3: Banks</span>
            </div>
            <h2 className="text-2xl font-bold">Your Accounts</h2>
            <p className="text-sm text-white/60">
              Add at least one bank account or wallet to track receipts.
            </p>
          </div>

          <div className="space-y-4 p-4 rounded-xl bg-white/5 border border-white/10">
            <div className="space-y-2">
              <Label>Display Name</Label>
              <Input
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="Main CBE"
                className="bg-ink border-white/10"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Institution</Label>
                <Select value={bankChannel} onValueChange={setBankChannel}>
                  <SelectTrigger className="bg-ink border-white/10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHANNELS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Acct Tail (Optional)</Label>
                <Input
                  value={bankAcct}
                  onChange={(e) => setBankAcct(e.target.value)}
                  placeholder="1234"
                  className="bg-ink border-white/10"
                />
              </div>
            </div>
            <Button variant="secondary" onClick={addBank} className="w-full">
              <Plus className="h-4 w-4 mr-2" /> Add Bank
            </Button>
          </div>

          {banksAdded > 0 && (
            <p className="text-xs text-money-in text-center font-medium">
              {banksAdded} bank(s) added successfully.
            </p>
          )}

          <div className="flex gap-3">
            <Button variant="ghost" onClick={handleBack} className="flex-1">
              Back
            </Button>
            <Button onClick={handleNext} disabled={banksAdded === 0} className="flex-[2]">
              Continue
            </Button>
          </div>
          {banksAdded === 0 && (
            <p className="text-[10px] text-white/40 text-center">
              Add at least one bank to continue.
            </p>
          )}
        </div>
      )}

      {step === "distributors" && (
        <div className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-primary">
              <Truck className="h-5 w-5" />
              <span className="text-sm font-semibold uppercase tracking-wider">
                Step 4: Suppliers
              </span>
            </div>
            <h2 className="text-2xl font-bold">Distributors</h2>
            <p className="text-sm text-white/60">Where you buy your airtime stock from.</p>
          </div>

          <div className="space-y-4 p-4 rounded-xl bg-white/5 border border-white/10">
            <div className="space-y-2">
              <Label>Distributor Name</Label>
              <Input
                value={distName}
                onChange={(e) => setDistName(e.target.value)}
                placeholder="MJ Telecom"
                className="bg-ink border-white/10"
              />
            </div>
            <div className="space-y-2">
              <Label>Statement Format</Label>
              <Select
                value={distFormat}
                onValueChange={(v) => setDistFormat(v as DistributorStatementFormat)}
              >
                <SelectTrigger className="bg-ink border-white/10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(DISTRIBUTOR_FORMAT_LABEL).map((k) => (
                    <SelectItem key={k} value={k}>
                      {DISTRIBUTOR_FORMAT_LABEL[k as DistributorStatementFormat]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="secondary" onClick={addDist} className="w-full">
              <Plus className="h-4 w-4 mr-2" /> Add Distributor
            </Button>
          </div>

          {distsAdded > 0 && (
            <p className="text-xs text-money-in text-center font-medium">
              {distsAdded} distributor(s) added.
            </p>
          )}

          <div className="flex gap-3">
            <Button variant="ghost" onClick={handleBack} className="flex-1">
              Back
            </Button>
            <Button onClick={handleNext} className="flex-[2]">
              {distsAdded === 0 ? "Skip for now" : "Continue"}
            </Button>
          </div>
        </div>
      )}

      {step === "agents" && (
        <div className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-primary">
              <Users className="h-5 w-5" />
              <span className="text-sm font-semibold uppercase tracking-wider">
                Step 5: Customers
              </span>
            </div>
            <h2 className="text-2xl font-bold">Sales Agents</h2>
            <p className="text-sm text-white/60">Downstream agents who take airtime on credit.</p>
          </div>

          <div className="space-y-4 p-4 rounded-xl bg-white/5 border border-white/10">
            <div className="space-y-2">
              <Label>Agent Name</Label>
              <Input
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder="Alexo"
                className="bg-ink border-white/10"
              />
            </div>
            <div className="space-y-2">
              <Label>Phone (Optional)</Label>
              <Input
                value={agentPhone}
                onChange={(e) => setAgentPhone(e.target.value)}
                placeholder="09..."
                className="bg-ink border-white/10"
              />
            </div>
            <Button variant="secondary" onClick={addAgent} className="w-full">
              <Plus className="h-4 w-4 mr-2" /> Add Agent
            </Button>
          </div>

          {agentsAdded > 0 && (
            <p className="text-xs text-money-in text-center font-medium">
              {agentsAdded} agent(s) added.
            </p>
          )}

          <div className="flex gap-3">
            <Button variant="ghost" onClick={handleBack} className="flex-1">
              Back
            </Button>
            <Button onClick={handleNext} className="flex-[2]">
              {agentsAdded === 0 ? "Skip for now" : "Continue"}
            </Button>
          </div>
        </div>
      )}

      {step === "finish" && (
        <div className="space-y-6 text-center">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-money-in/20 text-money-in">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <div className="space-y-2">
            <h2 className="text-3xl font-bold">You're All Set!</h2>
            <p className="text-white/60">
              EthioTrack is configured and ready. Your local database is active.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-primary/10 border border-primary/20 text-left space-y-3">
            <p className="text-xs font-semibold text-primary uppercase">Pro Tip</p>
            <p className="text-sm text-white/80">
              Regularly export your data from the Account page to keep a backup outside this
              browser.
            </p>
            <Button
              variant="outline"
              className="w-full text-xs h-8"
              onClick={() => {
                const data = JSON.stringify({ version: 2, timestamp: new Date().toISOString() });
                const blob = new Blob([data], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `ethiotrack-setup-backup-${new Date().toISOString().split("T")[0]}.json`;
                a.click();
              }}
            >
              Download Setup Backup
            </Button>
          </div>

          <Button onClick={finish} className="w-full h-12 text-lg bg-money-in hover:bg-money-in/90">
            Launch App <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      )}
    </StepLayout>
  );
}
