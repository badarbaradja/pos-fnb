import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Shared empty-state (icon + text) -- Phase 2 /pos redesign, 20 September
 * 2026. Replaces ad-hoc `<p className="text-sm text-muted-foreground">`
 * scattered across cart/product-grid empty messages with one consistent
 * pattern. Deliberately minimal (no illustration library) -- one muted
 * icon circle + title + optional description.
 */
function EmptyState({
  icon: Icon,
  title,
  description,
  className,
}: {
  icon: LucideIcon
  title: string
  description?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 py-8 text-center",
        className
      )}
    >
      <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? (
        <p className="max-w-[22rem] text-xs text-muted-foreground">{description}</p>
      ) : null}
    </div>
  )
}

export { EmptyState }
