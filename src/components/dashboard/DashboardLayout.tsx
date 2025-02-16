
import { Link, Outlet } from "react-router-dom";

export const DashboardLayout = () => {
  return (
    <div className="min-h-screen">
      <header className="border-b">
        <nav className="container mx-auto px-4 py-4">
          <ul className="flex space-x-4">
            <li><Link to="/" className="hover:text-blue-500">Home</Link></li>
            <li><Link to="/settings" className="hover:text-blue-500">Settings</Link></li>
            <li><Link to="/import" className="hover:text-blue-500">Import</Link></li>
            <li><Link to="/glossary" className="hover:text-blue-500">Glossary</Link></li>
            <li><Link to="/sitemap" className="hover:text-blue-500">Sitemap</Link></li>
          </ul>
        </nav>
      </header>
      <main className="container mx-auto px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t">
        <div className="container mx-auto px-4 py-4 text-center text-gray-600">
          © 2024 Your Application Name
        </div>
      </footer>
    </div>
  );
};

export default DashboardLayout;
