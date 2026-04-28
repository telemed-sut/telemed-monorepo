import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-4xl border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:bg-transparent dark:hover:bg-input/30",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
        glass:
          "relative overflow-hidden rounded-xl border border-white/25 bg-white/15 text-foreground shadow-[6px_6px_16px_rgba(0,0,0,0.12),-6px_-6px_16px_rgba(255,255,255,0.08),inset_0_1px_0_rgba(255,255,255,0.4),inset_0_-1px_0_rgba(255,255,255,0.1)] backdrop-blur-xl hover:bg-white/25 hover:shadow-[8px_8px_20px_rgba(0,0,0,0.15),-8px_-8px_20px_rgba(255,255,255,0.1)] dark:border-white/15 dark:bg-white/10 dark:hover:bg-white/15",
        "glass-primary":
          "relative overflow-hidden rounded-xl border border-white/20 bg-slate-600/60 text-white shadow-[6px_6px_16px_rgba(0,0,0,0.15),-6px_-6px_16px_rgba(255,255,255,0.06),inset_0_1px_0_rgba(255,255,255,0.3),inset_0_-1px_0_rgba(255,255,255,0.1)] backdrop-blur-xl hover:bg-slate-600/70 hover:shadow-[8px_8px_20px_rgba(0,0,0,0.2),-8px_-8px_20px_rgba(255,255,255,0.08)] dark:bg-slate-500/50 dark:hover:bg-slate-500/60",
        "glass-outline":
          "relative overflow-hidden rounded-xl border border-white/30 bg-white/10 text-foreground shadow-[4px_4px_12px_rgba(0,0,0,0.08),-4px_-4px_12px_rgba(255,255,255,0.06),inset_0_1px_0_rgba(255,255,255,0.3)] backdrop-blur-xl hover:border-white/40 hover:bg-white/20 hover:shadow-[6px_6px_16px_rgba(0,0,0,0.1),-6px_-6px_16px_rgba(255,255,255,0.08)] dark:border-white/15 dark:bg-white/5 dark:hover:bg-white/10",
      },
      size: {
        default:
          "h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        lg: "h-10 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-9",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
