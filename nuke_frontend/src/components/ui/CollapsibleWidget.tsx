import * as React from "react"
import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "../../lib/utils"

interface CollapsibleWidgetProps {
  title: string
  children: React.ReactNode
  defaultCollapsed?: boolean
  className?: string
  headerClassName?: string
  contentClassName?: string
  /** Optional badge/count to show next to title */
  badge?: React.ReactNode
  /** Optional action button in header */
  action?: React.ReactNode
}

export function CollapsibleWidget({
  title,
  children,
  defaultCollapsed = false,
  className,
  headerClassName,
  contentClassName,
  badge,
  action,
}: CollapsibleWidgetProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed)

  return (
    <div className={cn("rounded-lg border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700", className)}>
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className={cn(
          "flex w-full items-center justify-between p-4 text-left",
          headerClassName
        )}
      >
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium uppercase tracking-wide text-gray-600 dark:text-gray-400">
            {title}
          </h3>
          {badge}
        </div>
        <div className="flex items-center gap-2">
          {action && (
            <span onClick={(e) => e.stopPropagation()}>{action}</span>
          )}
          <ChevronDown
            className={cn(
              "h-4 w-4 text-gray-500 dark:text-gray-400 transition-transform",
              isCollapsed && "-rotate-90"
            )}
          />
        </div>
      </button>
      {!isCollapsed && (
        <div className={cn("border-t border-gray-200 dark:border-gray-700 p-4", contentClassName)}>
          {children}
        </div>
      )}
    </div>
  )
}

CollapsibleWidget.displayName = "CollapsibleWidget"
