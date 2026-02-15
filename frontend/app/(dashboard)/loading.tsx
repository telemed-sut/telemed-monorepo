export default function DashboardLoading() {
  return (
    <main className="flex-1 overflow-auto p-3 sm:p-4 md:p-6 space-y-4 sm:space-y-6 bg-background w-full animate-pulse">
      {/* Welcome skeleton */}
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-3">
          <div className="h-6 w-56 rounded-md bg-muted" />
          <div className="h-4 w-72 rounded-md bg-muted" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-28 rounded-md bg-muted" />
          <div className="h-9 w-28 rounded-md bg-muted" />
        </div>
      </div>

      {/* Stats skeleton */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 p-4 rounded-xl border bg-card">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-3">
            <div className="h-3 w-24 rounded bg-muted" />
            <div className="h-7 w-16 rounded bg-muted" />
            <div className="h-3 w-20 rounded bg-muted" />
          </div>
        ))}
      </div>

      {/* Charts skeleton */}
      <div className="flex flex-col xl:flex-row gap-4">
        <div className="flex-1 h-[300px] rounded-xl border bg-card" />
        <div className="w-full xl:w-[410px] h-[300px] rounded-xl border bg-card" />
      </div>

      {/* Table skeleton */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-md bg-muted" />
          <div className="h-5 w-40 rounded bg-muted" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 w-full rounded bg-muted" />
        ))}
      </div>
    </main>
  );
}
