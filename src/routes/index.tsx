import { createFileRoute } from "@tanstack/react-router";
import { DashboardTiles } from "@/components/DashboardTiles";
import { PasteImport } from "@/components/PasteImport";
import { TransactionForm } from "@/components/TransactionForm";
import { useTransactions } from "@/lib/db";

export const Route = createFileRoute("/")({
  component: LogPage,
});

function LogPage() {
  const { transactions } = useTransactions();
  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-4">
      <DashboardTiles txns={transactions} />
      <PasteImport />
      <TransactionForm />
    </div>
  );
}
