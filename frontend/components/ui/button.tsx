import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 rounded-md border border-transparent bg-clip-padding text-[0.95rem] font-medium focus-visible:ring-[3px] aria-invalid:ring-[3px] [&_svg:not([class*='size-'])]:size-4 inline-flex items-center justify-center whitespace-nowrap transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none shrink-0 [&_svg]:shrink-0 outline-none group/button select-none",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline: "border-border bg-background hover:bg-muted hover:text-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 aria-expanded:bg-muted aria-expanded:text-foreground shadow-xs",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost: "hover:bg-muted hover:text-foreground dark:hover:bg-muted/50 aria-expanded:bg-muted aria-expanded:text-foreground",
        destructive: "bg-destructive/10 hover:bg-destructive/20 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/20 text-destructive focus-visible:border-destructive/40 dark:hover:bg-destructive/30",
        link: "text-primary underline-offset-4 hover:underline",
        // Frosted Glass + Neumorphic style
        glass: "relative overflow-hidden bg-white/15 dark:bg-white/10 backdrop-blur-xl border border-white/25 dark:border-white/15 text-foreground rounded-xl shadow-[6px_6px_16px_rgba(0,0,0,0.12),-6px_-6px_16px_rgba(255,255,255,0.08),inset_0_1px_0_rgba(255,255,255,0.4),inset_0_-1px_0_rgba(255,255,255,0.1)] hover:bg-white/25 dark:hover:bg-white/15 hover:shadow-[8px_8px_20px_rgba(0,0,0,0.15),-8px_-8px_20px_rgba(255,255,255,0.1)] hover:-translate-y-0.5 active:translate-y-0 active:shadow-[inset_4px_4px_12px_rgba(0,0,0,0.15),inset_-4px_-4px_12px_rgba(255,255,255,0.1)]",
        "glass-primary": "relative overflow-hidden bg-slate-600/60 dark:bg-slate-500/50 backdrop-blur-xl border border-white/20 text-white rounded-xl shadow-[6px_6px_16px_rgba(0,0,0,0.15),-6px_-6px_16px_rgba(255,255,255,0.06),inset_0_1px_0_rgba(255,255,255,0.3),inset_0_-1px_0_rgba(255,255,255,0.1)] hover:bg-slate-600/70 dark:hover:bg-slate-500/60 hover:shadow-[8px_8px_20px_rgba(0,0,0,0.2),-8px_-8px_20px_rgba(255,255,255,0.08)] hover:-translate-y-0.5 active:translate-y-0 active:shadow-[inset_4px_4px_12px_rgba(0,0,0,0.2),inset_-4px_-4px_12px_rgba(255,255,255,0.05)]",
        "glass-outline": "relative overflow-hidden bg-white/10 dark:bg-white/5 backdrop-blur-xl border border-white/30 dark:border-white/15 text-foreground rounded-xl shadow-[4px_4px_12px_rgba(0,0,0,0.08),-4px_-4px_12px_rgba(255,255,255,0.06),inset_0_1px_0_rgba(255,255,255,0.3)] hover:bg-white/20 dark:hover:bg-white/10 hover:border-white/40 hover:shadow-[6px_6px_16px_rgba(0,0,0,0.1),-6px_-6px_16px_rgba(255,255,255,0.08)] hover:-translate-y-0.5 active:translate-y-0 active:shadow-[inset_3px_3px_8px_rgba(0,0,0,0.1),inset_-3px_-3px_8px_rgba(255,255,255,0.08)]",
      },
      size: {
        default: "h-10 gap-1.5 px-3 in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-7 gap-1 rounded-[min(var(--radius-md),8px)] px-2 text-[0.82rem] in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-9 gap-1 rounded-[min(var(--radius-md),10px)] px-3 in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        lg: "h-11 gap-1.5 px-3.5 has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5",
        icon: "size-9",
        "icon-xs": "size-6 rounded-[min(var(--radius-md),8px)] in-data-[slot=button-group]:rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-md",
        "icon-lg": "size-11",
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
