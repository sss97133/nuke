
import { Link, Outlet } from "react-router-dom";

export const DashboardLayout = () => {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-background">
        <nav className="container mx-auto px-4 py-4">
          <ul className="flex space-x-4">
            <li>
              <Link to="/" className="text-foreground hover:text-primary transition-colors">
                Home
              </Link>
            </li>
            <li>
              <Link to="/settings" className="text-foreground hover:text-primary transition-colors">
                Settings
              </Link>
            </li>
            <li>
              <Link to="/import" className="text-foreground hover:text-primary transition-colors">
                Import
              </Link>
            </li>
            <li>
              <Link to="/glossary" className="text-foreground hover:text-primary transition-colors">
                Glossary
              </Link>
            </li>
            <li>
              <Link to="/sitemap" className="text-foreground hover:text-primary transition-colors">
                Sitemap
              </Link>
            </li>
          </ul>
        </nav>
      </header>
      
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
