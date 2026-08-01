import { createFileRoute, Link } from "@tanstack/react-router";

/**
 * Safety net for the Android share sheet.
 *
 * Normally the service worker intercepts this POST and parks the payload in
 * the inbox. If the worker is not active yet (first launch after install), the
 * POST reaches the server instead — so we keep the text rather than lose it,
 * and say plainly that files could not be carried over this path.
 */
export const Route = createFileRoute("/share-target")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let text = "";
        try {
          const form = await request.formData();
          text = [form.get("text"), form.get("url")]
            .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
            .join("\n");
        } catch {
          text = "";
        }
        const params = new URLSearchParams({ fallback: "1" });
        if (text) params.set("text", text.slice(0, 4000));
        return new Response(null, {
          status: 303,
          headers: { Location: `/inbox?${params.toString()}` },
        });
      },
    },
  },
  head: () => ({
    meta: [
      { title: "Shared to EthioTrack" },
      { name: "description", content: "Handling content shared from another app." },
      { property: "og:title", content: "Shared to EthioTrack" },
      { property: "og:description", content: "Handling content shared from another app." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ShareTargetPage,
});

function ShareTargetPage() {
  return (
    <div className="max-w-md mx-auto p-6 space-y-3 text-center">
      <h1 className="text-lg font-semibold">Nothing was shared</h1>
      <p className="text-sm text-ink-soft">
        This page only receives content sent from another app's share sheet.
      </p>
      <Link
        to="/inbox"
        search={{ text: undefined, fallback: undefined }}
        className="text-sm underline"
      >
        Open the shared inbox
      </Link>
    </div>
  );
}
