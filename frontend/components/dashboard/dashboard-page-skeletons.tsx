type DashboardPageSkeletonVariant =
  | "overview"
  | "table"
  | "calendar"
  | "form"
  | "detail"
  | "monitor"
  | "call";

function SkeletonLine({
  className,
}: {
  className: string;
}) {
  return <div className={`rounded-full bg-slate-200/80 ${className}`} />;
}

function DashboardTableSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="h-[182px] rounded-3xl border border-slate-200/80 bg-white/90 animate-pulse"
          />
        ))}
      </div>

      <section className="rounded-[28px] border border-slate-200/80 bg-white/95 p-4 shadow-[0_12px_32px_rgba(15,23,42,0.05)] sm:p-5 animate-pulse">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <SkeletonLine className="h-5 w-40" />
            <SkeletonLine className="h-4 w-56 bg-slate-100" />
          </div>
          <div className="flex gap-2">
            <div className="h-11 w-52 rounded-2xl bg-slate-100" />
            <div className="h-11 w-28 rounded-2xl bg-slate-200/80" />
          </div>
        </div>

        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-100">
          <div className="grid grid-cols-[72px_minmax(220px,1.4fr)_minmax(180px,1fr)_minmax(120px,.6fr)_minmax(220px,1.2fr)_minmax(220px,1.2fr)_80px] gap-0 border-b border-slate-100 bg-slate-50/90 px-4 py-3">
            {Array.from({ length: 7 }).map((_, index) => (
              <SkeletonLine key={index} className="h-4 w-16" />
            ))}
          </div>

          {Array.from({ length: 6 }).map((_, rowIndex) => (
            <div
              key={rowIndex}
              className="grid grid-cols-[72px_minmax(220px,1.4fr)_minmax(180px,1fr)_minmax(120px,.6fr)_minmax(220px,1.2fr)_minmax(220px,1.2fr)_80px] items-center gap-0 border-b border-slate-100 px-4 py-4 last:border-b-0"
            >
              {Array.from({ length: 7 }).map((_, cellIndex) => (
                <div
                  key={cellIndex}
                  className={`h-4 rounded-full bg-slate-100 ${
                    cellIndex === 1 ? "w-36" : cellIndex === 6 ? "w-10" : "w-24"
                  }`}
                />
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function DashboardOverviewSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <section className="h-20 rounded-[28px] border border-slate-200/80 bg-white/95" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="h-[148px] rounded-3xl border border-slate-200/80 bg-white/95"
          />
        ))}
      </div>
      <section className="h-[320px] rounded-[28px] border border-slate-200/80 bg-white/95" />
      <section className="h-[360px] rounded-[28px] border border-slate-200/80 bg-white/95" />
    </div>
  );
}

function DashboardCalendarSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <section className="rounded-[28px] border border-slate-200/80 bg-white/95 p-5">
        <div className="flex flex-col gap-4">
          <div className="space-y-2">
            <SkeletonLine className="h-6 w-44" />
            <SkeletonLine className="h-4 w-64 bg-slate-100" />
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="h-11 w-32 rounded-2xl bg-slate-100" />
            <div className="h-11 w-56 rounded-2xl bg-slate-100" />
            <div className="h-11 flex-1 rounded-2xl bg-slate-100" />
          </div>
        </div>
      </section>
      <section className="rounded-[28px] border border-slate-200/80 bg-white/95 p-4">
        <div className="grid grid-cols-7 gap-0 overflow-hidden rounded-2xl border border-slate-100">
          {Array.from({ length: 21 }).map((_, index) => (
            <div
              key={index}
              className="h-32 border-b border-r border-slate-100 bg-white/90 last:border-r-0"
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function DashboardFormSkeleton() {
  return (
    <div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr] animate-pulse">
      {Array.from({ length: 2 }).map((_, sectionIndex) => (
        <section
          key={sectionIndex}
          className="rounded-[28px] border border-slate-200/80 bg-white/95 p-5"
        >
          <div className="space-y-2">
            <SkeletonLine className="h-6 w-40" />
            <SkeletonLine className="h-4 w-56 bg-slate-100" />
          </div>
          <div className="mt-5 space-y-4">
            {Array.from({ length: 5 }).map((__, fieldIndex) => (
              <div key={fieldIndex} className="space-y-2">
                <SkeletonLine className="h-4 w-28" />
                <div className="h-11 rounded-2xl bg-slate-100" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function DashboardDetailSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <section className="h-40 rounded-[30px] border border-slate-200/80 bg-white/95" />
      <div className="grid gap-5 xl:grid-cols-[1.3fr_.7fr]">
        <section className="h-[420px] rounded-[28px] border border-slate-200/80 bg-white/95" />
        <section className="h-[420px] rounded-[28px] border border-slate-200/80 bg-white/95" />
      </div>
    </div>
  );
}

function DashboardMonitorSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <section className="rounded-[28px] border border-slate-200/80 bg-white/95 p-5">
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-11 w-36 rounded-2xl bg-slate-100" />
          ))}
        </div>
      </section>
      <div className="grid gap-5 xl:grid-cols-2">
        <section className="h-[320px] rounded-[28px] border border-slate-200/80 bg-white/95" />
        <section className="h-[320px] rounded-[28px] border border-slate-200/80 bg-white/95" />
      </div>
      <section className="h-[360px] rounded-[28px] border border-slate-200/80 bg-white/95" />
    </div>
  );
}

function DashboardCallSkeleton() {
  return (
    <div className="grid h-full min-h-[70svh] gap-4 lg:grid-cols-[1fr_340px] animate-pulse">
      <section className="rounded-[30px] border border-slate-200/80 bg-slate-950/90" />
      <section className="space-y-4 rounded-[30px] border border-slate-200/80 bg-white/95 p-5">
        <SkeletonLine className="h-6 w-40" />
        <SkeletonLine className="h-4 w-56 bg-slate-100" />
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="h-16 rounded-2xl bg-slate-100" />
        ))}
      </section>
    </div>
  );
}

export function DashboardPageSkeleton({
  variant = "table",
}: {
  variant?: DashboardPageSkeletonVariant;
}) {
  return (
    <main className="flex-1 overflow-auto px-3 py-3 sm:px-4 sm:py-4">
      {variant === "overview" ? <DashboardOverviewSkeleton /> : null}
      {variant === "table" ? <DashboardTableSkeleton /> : null}
      {variant === "calendar" ? <DashboardCalendarSkeleton /> : null}
      {variant === "form" ? <DashboardFormSkeleton /> : null}
      {variant === "detail" ? <DashboardDetailSkeleton /> : null}
      {variant === "monitor" ? <DashboardMonitorSkeleton /> : null}
      {variant === "call" ? <DashboardCallSkeleton /> : null}
    </main>
  );
}
