const COLORS: Record<string, string> = {
  idle: "bg-muted",
  running: "bg-accent",
  awaiting_approval: "bg-amber",
  error: "bg-danger",
  disabled: "bg-border",
};

export function StatusDot({ status }: { status: string }) {
  const color = COLORS[status] ?? "bg-muted";
  return (
    <span className="relative inline-flex h-2.5 w-2.5">
      {status === "running" && (
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${color} opacity-60`} />
      )}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${color}`} />
    </span>
  );
}
