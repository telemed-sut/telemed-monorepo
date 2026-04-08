import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,rgba(37,99,235,0.08),transparent_38%),linear-gradient(180deg,#f8fafc_0%,#eef4ff_100%)] p-6">
      <div className="w-full max-w-xl rounded-3xl border border-slate-200/80 bg-white/95 p-8 text-center shadow-[0_24px_80px_rgba(15,23,42,0.12)]">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-blue-600">
          404
        </p>
        <h1 className="mt-4 text-3xl font-semibold text-slate-950">
          ไม่พบหน้าที่คุณต้องการ
        </h1>
        <p className="mt-3 text-base text-slate-600">
          หน้านี้อาจถูกย้าย ลบออก หรือคุณอาจยังไม่ได้เข้าสู่ระบบ
        </p>
        <p className="mt-2 text-sm text-slate-500">
          The page you requested does not exist, has moved, or requires a valid session.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link href="/login" className={buttonVariants()}>
            กลับไปหน้าเข้าสู่ระบบ
          </Link>
          <Link
            href="/overview"
            className={buttonVariants({ variant: "outline" })}
          >
            ไปที่แดชบอร์ด
          </Link>
        </div>
      </div>
    </main>
  );
}
