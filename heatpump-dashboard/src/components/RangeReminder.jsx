export default function RangeReminder({ message }) {
  if (!message) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-xs rounded-xl border border-[var(--surface-border)] bg-lb-bg-elevated px-4 py-3 text-sm text-lb-text shadow-lg">
      {message}
    </div>
  );
}
