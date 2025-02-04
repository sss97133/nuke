import { AppMenu } from "./AppMenu";
import { MainMenu } from "./MainMenu";
import { StatusBar } from "./StatusBar";

interface DashboardHeaderProps {
  handleMenuAction: (action: string) => void;
}

export const DashboardHeader = ({ handleMenuAction }: DashboardHeaderProps) => {
  return (
    <header className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center h-6 px-2 bg-secondary border-b border-border shadow-classic">
        <AppMenu handleMenuAction={handleMenuAction} />
        <div className="flex-1">
          <MainMenu handleMenuAction={handleMenuAction} />
        </div>
        <StatusBar />
      </div>
    </header>
  );
};