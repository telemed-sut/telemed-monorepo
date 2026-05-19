import Image from "next/image";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main
      aria-labelledby="not-found-title"
      className="flex min-h-dvh items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_50%_18%,rgba(189,232,245,0.36),transparent_34%),linear-gradient(180deg,#ffffff_0%,#f7fbff_100%)] px-6 py-10 text-foreground"
    >
      <section className="mx-auto flex w-full max-w-2xl flex-col items-center text-center">
        <h1 id="not-found-title" className="sr-only">
          404
        </h1>
        <Image
          src="/not-found-illustration-transparent.png"
          alt="ภาพประกอบหน้า 404 ไม่พบหน้าที่ต้องการ"
          className="w-full max-w-[520px] select-none object-contain drop-shadow-[0_28px_50px_rgba(15,40,84,0.10)] motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-500"
          draggable={false}
          priority
          sizes="(max-width: 640px) 90vw, 520px"
          width={1254}
          height={1254}
        />
        <Link
          href="/overview"
          className={buttonVariants({
            size: "lg",
            className:
              "-mt-2 min-h-11 rounded-lg px-6 shadow-sm transition-transform motion-safe:hover:-translate-y-0.5 sm:-mt-5",
          })}
        >
          กลับไปหน้าหลัก
        </Link>
      </section>
    </main>
  );
}
