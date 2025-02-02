import { ReactNode } from "react";

interface ClassicWindowProps {
  title: string;
  children: ReactNode;
}

export const ClassicWindow = ({ title, children }: ClassicWindowProps) => (
  <div className="classic-window">
    <div className="flex items-center justify-between border-b border-border dark:border-border-dark pb-2 mb-6">
      <div className="flex items-center gap-1">
        <div className="w-3 h-3 bg-destructive rounded-full" />
        <div className="w-3 h-3 bg-accent rounded-full" />
        <div className="w-3 h-3 bg-muted rounded-full" />
      </div>
      <div className="text-center text-sm font-system">{title}</div>
      <div className="w-12" />
    </div>
    {children}
  </div>
);