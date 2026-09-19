export function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6 animate-pulse">
      <div className="flex flex-col gap-2">
        <div className="h-4 w-48 rounded bg-muted" />
        <div className="h-56 rounded-xl border bg-muted/50" />
      </div>
      <div className="flex flex-col gap-2">
        <div className="h-4 w-40 rounded bg-muted" />
        <div className="h-40 rounded-xl border bg-muted/50" />
      </div>
    </div>
  );
}
