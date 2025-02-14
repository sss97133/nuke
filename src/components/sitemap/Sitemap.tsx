
import { Link } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";

export const Sitemap = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleNavigation = (path: string, implemented: boolean) => {
    if (!implemented) {
      toast({
        title: "Page not available",
        description: "This page is currently under development",
        variant: "destructive",
      });
      return;
    }
    navigate(path);
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Sitemap</h1>
      
      <div className="space-y-6">
        <section>
          <h2 className="text-xl font-semibold mb-3">Main Pages</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <Link to="/" className="text-blue-600 hover:underline">
                Home
              </Link>
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Vehicle Management</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <button 
                onClick={() => handleNavigation('/vehicles', true)}
                className="text-blue-600 hover:underline text-left"
              >
                Vehicle Management
              </button>
            </li>
            <li>
              <button 
                onClick={() => handleNavigation('/inventory', true)}
                className="text-blue-600 hover:underline text-left"
              >
                Inventory
              </button>
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Tokenization & DAO</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <button 
                onClick={() => handleNavigation('/token-management', false)}
                className="text-blue-600 hover:underline text-left"
              >
                Token Management
              </button>
            </li>
            <li>
              <button 
                onClick={() => handleNavigation('/dao-governance', false)}
                className="text-blue-600 hover:underline text-left"
              >
                DAO Governance
              </button>
            </li>
            <li>
              <button 
                onClick={() => handleNavigation('/vehicle-tokens', false)}
                className="text-blue-600 hover:underline text-left"
              >
                Vehicle Tokens
              </button>
            </li>
            <li>
              <button 
                onClick={() => handleNavigation('/proposals', false)}
                className="text-blue-600 hover:underline text-left"
              >
                DAO Proposals
              </button>
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Service</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <button 
                onClick={() => handleNavigation('/service', true)}
                className="text-blue-600 hover:underline text-left"
              >
                Service Management
              </button>
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Map & Locations</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <button 
                onClick={() => handleNavigation('/garages', true)}
                className="text-blue-600 hover:underline text-left"
              >
                Map View
              </button>
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Professional</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <button 
                onClick={() => handleNavigation('/professional', false)}
                className="text-blue-600 hover:underline text-left"
              >
                Professional Dashboard
              </button>
            </li>
            <li>
              <button 
                onClick={() => handleNavigation('/auctions', false)}
                className="text-blue-600 hover:underline text-left"
              >
                Auctions
              </button>
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Studio</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <button 
                onClick={() => handleNavigation('/studio', false)}
                className="text-blue-600 hover:underline text-left"
              >
                Studio Configuration
              </button>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
};
