import { Outlet } from "react-router-dom";

export const DashboardLayout = () => {
  return (
    <div className="min-h-screen">
      <header className="border-b">
        <nav className="container mx-auto px-4 py-4">
          <ul className="flex space-x-4">
            <li><a href="/" className="hover:text-blue-500">Home</a></li>
            <li><a href="/settings" className="hover:text-blue-500">Settings</a></li>
            <li><a href="/import" className="hover:text-blue-500">Import</a></li>
            <li><a href="/glossary" className="hover:text-blue-500">Glossary</a></li>
            <li><a href="/sitemap" className="hover:text-blue-500">Sitemap</a></li>
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
