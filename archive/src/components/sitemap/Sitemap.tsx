
import { Link } from "react-router-dom";
import { useButtonActions } from "@/utils/button-actions";
import { trackButtonAction } from "@/utils/button-debug";

export const Sitemap = () => {
  const { navigateTo, siteMapActions } = useButtonActions();

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
                onClick={() => navigateTo(
                  siteMapActions.vehicleManagement.path, 
                  siteMapActions.vehicleManagement.implemented,
                  { trackAs: 'sitemap:vehicleManagement' }
                )}
                className="text-blue-600 hover:underline text-left"
              >
                Vehicle Management
              </button>
            </li>
            <li>
              <button 
                onClick={() => navigateTo(
                  siteMapActions.inventory.path, 
                  siteMapActions.inventory.implemented,
                  { trackAs: 'sitemap:inventory' }
                )}
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
                onClick={() => navigateTo(
                  siteMapActions.tokenManagement.path, 
                  siteMapActions.tokenManagement.implemented,
                  { trackAs: 'sitemap:tokenManagement' }
                )}
                className="text-blue-600 hover:underline text-left"
              >
                Token Management
              </button>
            </li>
            <li>
              <button 
                onClick={() => navigateTo(
                  siteMapActions.daoGovernance.path, 
                  siteMapActions.daoGovernance.implemented,
                  { trackAs: 'sitemap:daoGovernance' }
                )}
                className="text-blue-600 hover:underline text-left"
              >
                DAO Governance
              </button>
            </li>
            <li>
              <button 
                onClick={() => navigateTo(
                  siteMapActions.vehicleTokens.path, 
                  siteMapActions.vehicleTokens.implemented,
                  { trackAs: 'sitemap:vehicleTokens' }
                )}
                className="text-blue-600 hover:underline text-left"
              >
                Vehicle Tokens
              </button>
            </li>
            <li>
              <button 
                onClick={() => navigateTo(
                  siteMapActions.daoProposals.path, 
                  siteMapActions.daoProposals.implemented,
                  { trackAs: 'sitemap:daoProposals' }
                )}
                className="text-blue-600 hover:underline text-left"
              >
                DAO Proposals
              </button>
            </li>
            <li>
              <button 
                onClick={() => navigateTo(
                  siteMapActions.terminal.path, 
                  siteMapActions.terminal.implemented,
                  { trackAs: 'sitemap:terminal' }
                )}
                className="text-blue-600 hover:underline text-left"
              >
                Bloomberg Terminal
              </button>
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Service</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <button 
                onClick={() => navigateTo(
                  siteMapActions.service.path, 
                  siteMapActions.service.implemented,
                  { trackAs: 'sitemap:service' }
                )}
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
                onClick={() => navigateTo(
                  siteMapActions.mapView.path, 
                  siteMapActions.mapView.implemented,
                  { trackAs: 'sitemap:mapView' }
                )}
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
                onClick={() => navigateTo(
                  siteMapActions.professional.path, 
                  siteMapActions.professional.implemented,
                  { trackAs: 'sitemap:professional' }
                )}
                className="text-blue-600 hover:underline text-left"
              >
                Professional Dashboard
              </button>
            </li>
            <li>
              <button 
                onClick={() => navigateTo(
                  '/auctions', 
                  false,
                  { trackAs: 'sitemap:auctions' }
                )}
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
                onClick={() => navigateTo(
                  '/studio', 
                  false,
                  { trackAs: 'sitemap:studio' }
                )}
                className="text-blue-600 hover:underline text-left"
              >
                Studio Configuration
              </button>
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Documentation</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <button 
                onClick={() => navigateTo(
                  '/algorithms', 
                  true,
                  { trackAs: 'sitemap:algorithms' }
                )}
                className="text-blue-600 hover:underline text-left"
              >
                System Algorithms
              </button>
            </li>
            <li>
              <button 
                onClick={() => navigateTo(
                  '/glossary', 
                  true,
                  { trackAs: 'sitemap:glossary' }
                )}
                className="text-blue-600 hover:underline text-left"
              >
                Glossary
              </button>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
};
