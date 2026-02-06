import { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default marker icons
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

interface Collection {
  slug: string;
  url: string;
  instagram: string | null;
  country: string;
  city: string;
  lat: number;
  lng: number;
  source?: string;
}

interface GeoJSONFeature {
  type: 'Feature';
  properties: {
    name: string;
    url: string;
    instagram: string | null;
    country: string;
    city: string;
    source?: string;
  };
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
}

interface GeoJSONData {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

// Custom marker icons by type
const createCustomIcon = (color: string) => {
  return L.divIcon({
    className: 'custom-marker',
    html: `<div style="
      background-color: ${color};
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: 3px solid white;
      box-shadow: 0 2px 5px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
    ">
      <div style="
        width: 8px;
        height: 8px;
        background: white;
        border-radius: 50%;
      "></div>
    </div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
  });
};

const countryColors: Record<string, string> = {
  'USA': '#3B82F6',
  'UK': '#EF4444',
  'Italy': '#22C55E',
  'Germany': '#F59E0B',
  'France': '#8B5CF6',
  'Monaco': '#EC4899',
  'Switzerland': '#14B8A6',
  'Japan': '#F97316',
  'UAE': '#6366F1',
  'Qatar': '#84CC16',
  'South Korea': '#10B981',
  'Taiwan': '#06B6D4',
  'Australia': '#FBBF24',
  'Canada': '#DC2626',
  'Singapore': '#7C3AED',
  'Belgium': '#FACC15',
  'Poland': '#F43F5E',
  'Denmark': '#C026D3',
  'Chile': '#0EA5E9',
  'Turkey': '#EA580C',
  'Austria': '#A855F7',
  'Norway': '#2563EB',
  'Netherlands': '#F97316',
  'New Zealand': '#000000',
  'Czechia': '#0D9488',
  'Morocco': '#16A34A',
  'Oman': '#059669',
  'Saudi Arabia': '#15803D',
  'Lebanon': '#B91C1C',
  'Slovakia': '#1D4ED8',
  'China': '#B45309',
  'Brazil': '#047857',
  'Thailand': '#9333EA',
  'Hong Kong': '#DC2626',
  'Dominican Republic': '#0369A1',
  'Kazakhstan': '#0891B2',
  'Mexico': '#65A30D',
  'Israel': '#1E40AF',
  'Portugal': '#DC2626',
  'Malaysia': '#F59E0B',
  'India': '#EA580C',
  'default': '#6B7280',
};

function MapController({ selectedCountry }: { selectedCountry: string | null }) {
  const map = useMap();

  useEffect(() => {
    if (selectedCountry) {
      // Zoom to country (simplified - would need country bounds in production)
      const countryCoords: Record<string, [number, number]> = {
        'USA': [39.8283, -98.5795],
        'UK': [55.3781, -3.4360],
        'Italy': [41.8719, 12.5674],
        'Germany': [51.1657, 10.4515],
        'France': [46.2276, 2.2137],
        'Monaco': [43.7384, 7.4246],
        'Switzerland': [46.8182, 8.2275],
        'Japan': [36.2048, 138.2529],
        'UAE': [23.4241, 53.8478],
        'Qatar': [25.3548, 51.1839],
        'South Korea': [35.9078, 127.7669],
        'Taiwan': [23.6978, 120.9605],
        'Australia': [-25.2744, 133.7751],
        'Canada': [56.1304, -106.3468],
        'Singapore': [1.3521, 103.8198],
        'Belgium': [50.5039, 4.4699],
        'Poland': [51.9194, 19.1451],
        'Denmark': [56.2639, 9.5018],
        'Chile': [-35.6751, -71.543],
        'Turkey': [38.9637, 35.2433],
        'Austria': [47.5162, 14.5501],
        'Norway': [60.4720, 8.4689],
        'Netherlands': [52.1326, 5.2913],
        'New Zealand': [-40.9006, 174.886],
        'Czechia': [49.8175, 15.4730],
        'Morocco': [31.7917, -7.0926],
        'Oman': [21.4735, 55.9754],
        'Saudi Arabia': [23.8859, 45.0792],
        'Lebanon': [33.8547, 35.8623],
        'Slovakia': [48.6690, 19.6990],
        'China': [35.8617, 104.1954],
        'Brazil': [-14.2350, -51.9253],
        'Thailand': [15.8700, 100.9925],
        'Hong Kong': [22.3193, 114.1694],
        'Dominican Republic': [18.7357, -70.1627],
        'Kazakhstan': [48.0196, 66.9237],
        'Mexico': [23.6345, -102.5528],
        'Israel': [31.0461, 34.8516],
        'Portugal': [39.3999, -8.2245],
        'Malaysia': [4.2105, 101.9758],
        'India': [20.5937, 78.9629],
      };
      const coords = countryCoords[selectedCountry];
      if (coords) {
        map.flyTo(coords, 5, { duration: 1 });
      }
    } else {
      map.flyTo([20, 0], 2, { duration: 1 });
    }
  }, [selectedCountry, map]);

  return null;
}

export default function CollectionsMap() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [stats, setStats] = useState<Record<string, number>>({});

  useEffect(() => {
    // Load collections from the GeoJSON file or API
    async function loadCollections() {
      try {
        // In production, this would be an API call
        // For now, we'll fetch from a static file or embed the data
        const response = await fetch('/data/collections-map-enhanced.geojson');
        if (response.ok) {
          const data: GeoJSONData = await response.json();
          const parsed = data.features.map((f) => ({
            slug: f.properties.name,
            url: f.properties.url,
            instagram: f.properties.instagram,
            country: f.properties.country,
            city: f.properties.city,
            source: f.properties.source,
            lat: f.geometry.coordinates[1],
            lng: f.geometry.coordinates[0],
          }));
          setCollections(parsed);

          // Calculate stats
          const countryStats: Record<string, number> = {};
          parsed.forEach((c) => {
            countryStats[c.country] = (countryStats[c.country] || 0) + 1;
          });
          setStats(countryStats);
        }
      } catch (error) {
        console.error('Error loading collections:', error);
        // Fallback: load embedded sample data
        setCollections(SAMPLE_COLLECTIONS);
      } finally {
        setLoading(false);
      }
    }

    loadCollections();
  }, []);

  const filteredCollections = collections.filter((c) => {
    const matchesCountry = !selectedCountry || c.country === selectedCountry;
    const matchesSearch = !searchTerm ||
      c.slug.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.city.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.instagram && c.instagram.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesCountry && matchesSearch;
  });

  const sortedCountries = Object.entries(stats)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="h-screen flex flex-col bg-gray-900">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 p-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Collections World Map</h1>
            <p className="text-gray-400 text-sm">
              {collections.length} collections across {Object.keys(stats).length} countries
            </p>
          </div>

          {/* Search */}
          <div className="flex items-center gap-4">
            <input
              type="text"
              placeholder="Search collections..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
            />
            {selectedCountry && (
              <button
                onClick={() => setSelectedCountry(null)}
                className="px-3 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 flex items-center gap-2"
              >
                <span>Clear Filter</span>
                <span className="text-xs bg-gray-600 px-2 py-0.5 rounded">{selectedCountry}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 flex">
        {/* Sidebar */}
        <div className="w-64 bg-gray-800 border-r border-gray-700 overflow-y-auto">
          <div className="p-4">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Countries
            </h2>
            <div className="space-y-1">
              {sortedCountries.map(([country, count]) => (
                <button
                  key={country}
                  onClick={() => setSelectedCountry(selectedCountry === country ? null : country)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                    selectedCountry === country
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: countryColors[country] || countryColors.default }}
                    />
                    <span>{country}</span>
                  </div>
                  <span className="text-xs bg-gray-700 px-2 py-0.5 rounded-full">
                    {count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Notable Collections */}
          <div className="p-4 border-t border-gray-700">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Notable Collections
            </h2>
            <div className="space-y-2 text-sm">
              {collections
                .filter((c) => c.instagram && !c.instagram.includes('exclusivecarregistry'))
                .slice(0, 10)
                .map((c) => (
                  <a
                    key={c.slug}
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-gray-300 hover:text-blue-400 truncate"
                  >
                    @{c.instagram}
                  </a>
                ))}
            </div>
          </div>
        </div>

        {/* Map */}
        <div className="flex-1 relative">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
              <div className="text-gray-400">Loading map data...</div>
            </div>
          ) : (
            <MapContainer
              center={[20, 0]}
              zoom={2}
              className="h-full w-full"
              style={{ background: '#1a1a2e' }}
            >
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
              />
              <MapController selectedCountry={selectedCountry} />

              {filteredCollections.map((collection) => (
                <Marker
                  key={collection.slug}
                  position={[collection.lat, collection.lng]}
                  icon={createCustomIcon(countryColors[collection.country] || countryColors.default)}
                >
                  <Popup className="collection-popup">
                    <div className="min-w-[250px]">
                      <h3 className="font-bold text-lg mb-1">
                        {collection.slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                      </h3>
                      <p className="text-gray-600 text-sm mb-2">
                        {collection.city}, {collection.country}
                      </p>

                      {collection.instagram && (
                        <a
                          href={`https://instagram.com/${collection.instagram.replace('@', '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-pink-500 hover:text-pink-600 text-sm mb-2"
                        >
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073z"/>
                          </svg>
                          @{collection.instagram}
                        </a>
                      )}

                      {collection.source && (
                        <p className="text-xs text-gray-500 mb-2">{collection.source}</p>
                      )}

                      <a
                        href={collection.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block mt-2 px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600"
                      >
                        View Collection
                      </a>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          )}

          {/* Stats overlay */}
          <div className="absolute bottom-4 left-4 bg-gray-800/90 backdrop-blur-sm rounded-lg p-3 text-sm">
            <div className="text-gray-400">
              Showing <span className="text-white font-semibold">{filteredCollections.length}</span> collections
            </div>
          </div>
        </div>

        {/* Collection List Panel */}
        <div className="w-80 bg-gray-800 border-l border-gray-700 overflow-y-auto">
          <div className="p-4 border-b border-gray-700">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
              Collections ({filteredCollections.length})
            </h2>
          </div>
          <div className="divide-y divide-gray-700">
            {filteredCollections.slice(0, 50).map((collection) => (
              <a
                key={collection.slug}
                href={collection.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block p-3 hover:bg-gray-700/50 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-3 h-3 rounded-full mt-1 flex-shrink-0"
                    style={{ backgroundColor: countryColors[collection.country] || countryColors.default }}
                  />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-white font-medium text-sm truncate">
                      {collection.slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                    </h3>
                    <p className="text-gray-400 text-xs truncate">
                      {collection.city}, {collection.country}
                    </p>
                    {collection.instagram && (
                      <p className="text-pink-400 text-xs truncate">@{collection.instagram}</p>
                    )}
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Sample data fallback
const SAMPLE_COLLECTIONS: Collection[] = [
  { slug: 'jay-lenos-car-collection', url: 'https://exclusivecarregistry.com/collection/jay-lenos-car-collection', instagram: 'jaylenosgarage', country: 'USA', city: 'Burbank, CA', lat: 34.1808, lng: -118.309 },
  { slug: 'george-harrisons-car-collection', url: 'https://exclusivecarregistry.com/collection/george-harrisons-car-collection', instagram: null, country: 'UK', city: 'Henley-on-Thames', lat: 51.5354, lng: -0.9014 },
  { slug: 'ferrari-museum-maranello', url: 'https://exclusivecarregistry.com/collection/ferrari-museum-maranello', instagram: null, country: 'Italy', city: 'Maranello', lat: 44.5294, lng: 10.8656 },
];
