import { createFileRoute } from "@tanstack/react-router";
import { PasteImport } from "@/components/PasteImport";
import { StatementImport } from "@/components/StatementImport";
import { TransactionForm } from "@/components/TransactionForm";

export const Route = createFileRoute("/capture")({
  head: () => ({
    meta: [
      { title: "Capture · EthioTrack" },
      {
        name: "description",
        content: "Paste bank SMS, drop distributor PDF, or enter transactions by hand.",
      },
      { property: "og:title", content: "Quick capture · EthioTrack" },
      {
        property: "og:description",
        content: "Three ingestion pipelines: paste, PDF import, manual entry.",
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
          Paste, drop, or type — the Brain links agents and settles credits automatically.
        </p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PasteImport />
        <StatementImport />
      </div>
      <TransactionForm />
    </div>
  );
}
