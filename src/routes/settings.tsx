import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { UserCog, Download } from "lucide-react";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings · EthioTrack" },
      { name: "description", content: "Jump to Account or Exports." },
      { property: "og:title", content: "Settings · EthioTrack" },
      { property: "og:description", content: "Account & data controls." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-4">
      <h1 className="text-xl md:text-2xl font-bold">Settings</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          to="/account"
          className="rounded-xl border border-border bg-card p-4 shadow-sm hover:border-primary/60 transition-colors"
        >
          <div className="flex items-center gap-2 font-semibold">
            <UserCog className="h-4 w-4 text-primary" /> Account
          </div>
          <div className="text-xs text-ink-soft mt-1">
            Your name, license, daily PIN, master PIN and danger zone.
          </div>
        </Link>
        <Link
          to="/exports"
          className="rounded-xl border border-border bg-card p-4 shadow-sm hover:border-primary/60 transition-colors"
        >
          <div className="flex items-center gap-2 font-semibold">
            <Download className="h-4 w-4 text-primary" /> Exports & backups
          </div>
          <div className="text-xs text-ink-soft mt-1">
            Download JSON or CSV, restore from a file.
          </div>
        </Link>
      </div>
    </div>
  );
}
