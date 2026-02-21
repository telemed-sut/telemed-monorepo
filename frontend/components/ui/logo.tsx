import type { ImageProps } from "next/image";
import Image from "next/image";
import { cn } from "@/lib/utils";

type LogoProps = Omit<ImageProps, "src" | "alt" | "width" | "height">;

export const Logo = ({ className, ...props }: LogoProps) => (
  <Image
    src="/brand-icon.ico"
    alt="E Med Help logo"
    width={40}
    height={40}
    unoptimized
    className={cn("object-contain", className)}
    {...props}
  />
);
