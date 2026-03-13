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
  /** Use design-system styling (flat, no radius, matches vehicle profile cards) */
  variant?: 'default' | 'profile'
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
  variant = 'default',
}: CollapsibleWidgetProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed)
  const isProfile = variant === 'profile'

  return (
    <div
      className={cn(
        isProfile ? 'collapsible-widget--profile' : 'rounded-lg border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700',
        isProfile && isCollapsed && 'is-collapsed',
        className
      )}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsCollapsed((prev) => !prev);
        }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIsCollapsed((prev) => !prev); } }}
        className={cn(
          'flex w-full items-center justify-between text-left cursor-pointer',
          isProfile ? 'collapsible-widget--profile__header' : 'p-4',
          headerClassName
        )}
      >
        <div className="flex items-center gap-2">
          <h3
            className={
              isProfile
                ? 'collapsible-widget--profile__title'
                : 'text-sm font-medium uppercase tracking-wide text-gray-600 dark:text-gray-400'
            }
          >
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
              'h-4 w-4 transition-transform flex-shrink-0',
              isProfile ? 'collapsible-widget--profile__chevron' : 'text-gray-500 dark:text-gray-400',
              isCollapsed && '-rotate-90'
            )}
          />
        </div>
      </div>
      {!isCollapsed && (
        <div
          className={cn(
            isProfile ? 'collapsible-widget--profile__content' : 'border-t border-gray-200 dark:border-gray-700 p-4',
            contentClassName
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}

CollapsibleWidget.displayName = "CollapsibleWidget"
