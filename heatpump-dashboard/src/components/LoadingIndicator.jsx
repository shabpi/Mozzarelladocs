import OrionHologram from "./OrionHologram";

export default function LoadingIndicator({ label = "Loading…" }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 bg-lb-bg p-8">
      <OrionHologram className="orion-hologram--loading" />
      <p className="text-sm text-lb-text-muted">{label}</p>
    </div>
  );
}
