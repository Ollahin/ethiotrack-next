import { createFileRoute } from "@tanstack/react-router";
import { SmsInbox } from "@/components/SmsInbox";
import { StatementImport } from "@/components/StatementImport";
import { TransactionForm } from "@/components/TransactionForm";

export const Route = createFileRoute("/capture")({
  head: () => ({
    meta: [
      { title: "Capture · EthioTrack" },
      {
        name: "description",
        content:
          "Paste any bank or airtime message, drop a distributor screenshot, or enter transactions by hand.",
      },
      { property: "og:title", content: "Quick capture · EthioTrack" },
      {
        property: "og:description",
        content: "One smart capture box, screenshot import, and manual entry.",
      },
    ],
  }),
  component: CapturePage,
});

function CapturePage() {
  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl md:text-2xl font-bold">Quick Capture</h1>
        <p className="text-sm text-ink-soft">
          Paste, share, drop or type — the app works out what it is and shows you the rows before
          anything is saved.
        </p>
      </div>
      <SmsInbox />
      <StatementImport />
      <TransactionForm />
    </div>
  );
}
