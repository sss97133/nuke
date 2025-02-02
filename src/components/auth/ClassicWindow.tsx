import { ReactNode } from "react";

interface ClassicWindowProps {
  title: string;
  children: ReactNode;
}

export const ClassicWindow = ({ title, children }: ClassicWindowProps) => (
  <div className="bg-secondary dark:bg-secondary-dark border border-border dark:border-border-dark shadow-classic dark:shadow-classic-dark">
    <div className="flex items-center justify-between border-b border-border dark:border-border-dark p-2">
      <div className="flex items-center gap-1">
        <div className="w-3 h-3 bg-destructive rounded-full" />
        <div className="w-3 h-3 bg-accent rounded-full" />
        <div className="w-3 h-3 bg-muted rounded-full" />
      </div>
      <div className="text-center text-sm font-system">{title}</div>
      <div className="w-12" />
    </div>
    <div className="p-6">
      {children}
    </div>
  </div>
);