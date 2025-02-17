
import { Link, Outlet } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { DashboardHeader } from "./header/DashboardHeader";

export const DashboardLayout = () => {
  return (
    <div className="min-h-screen flex flex-col">
      <DashboardHeader handleMenuAction={(action) => console.log('Menu action:', action)} />
      
      <nav className="border-b bg-secondary/50">
        <div className="container mx-auto px-4 py-2">
          <ul className="flex space-x-4">
            <li>
              <Button variant="ghost" asChild>
                <Link to="/">Home</Link>
              </Button>
            </li>
            <li>
              <Button variant="ghost" asChild>
                <Link to="/settings">Settings</Link>
              </Button>
            </li>
            <li>
              <Button variant="ghost" asChild>
                <Link to="/import">Import</Link>
              </Button>
            </li>
            <li>
              <Button variant="ghost" asChild>
                <Link to="/glossary">Glossary</Link>
              </Button>
            </li>
            <li>
              <Button variant="ghost" asChild>
                <Link to="/sitemap">Sitemap</Link>
              </Button>
            </li>
          </ul>
        </div>
      </nav>
      
      <main className="flex-1 container mx-auto px-4 py-8">
        <Outlet />
      </main>
      
      <footer className="border-t bg-background">
        <div className="container mx-auto px-4 py-4 text-center text-muted-foreground">
          © 2024 Your Application Name
        </div>
      </footer>
    </div>
  );
};

export default DashboardLayout;
