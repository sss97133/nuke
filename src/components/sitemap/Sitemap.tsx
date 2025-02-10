
import { Link } from "react-router-dom";

export const Sitemap = () => {
  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Sitemap</h1>
      
      <div className="space-y-6">
        <section>
          <h2 className="text-xl font-semibold mb-3">Main Pages</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li><Link to="/" className="text-blue-600 hover:underline">Home</Link></li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Vehicle Management</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li><Link to="/vehicles" className="text-blue-600 hover:underline">Vehicle Management</Link></li>
            <li><Link to="/inventory" className="text-blue-600 hover:underline">Inventory</Link></li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Service</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li><Link to="/service" className="text-blue-600 hover:underline">Service Management</Link></li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Map & Locations</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li><Link to="/garages" className="text-blue-600 hover:underline">Map View</Link></li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Professional</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li><Link to="/professional" className="text-blue-600 hover:underline">Professional Dashboard</Link></li>
            <li><Link to="/auctions" className="text-blue-600 hover:underline">Auctions</Link></li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Studio</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li><Link to="/studio" className="text-blue-600 hover:underline">Studio Configuration</Link></li>
          </ul>
        </section>
      </div>
    </div>
  );
};
