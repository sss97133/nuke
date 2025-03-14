/**
 * VehicleTimelinePage.tsx
 * Example page showcasing the VehicleTimeline component integration
 */
import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';

// Import the VehicleTimeline component
import VehicleTimeline from '../components/VehicleTimeline';

// Page styles
import './VehicleTimelinePage.css';

const VehicleTimelinePage: React.FC = () => {
  const { vin } = useParams<{ vin: string }>();
  const navigate = useNavigate();
  const [isSearching, setIsSearching] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Handle VIN search
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!searchInput.trim()) return;
    
    setIsSearching(true);
    setSearchError(null);
    
    try {
      // Determine if the input is a VIN (17 characters, alphanumeric)
      const isVin = /^[A-HJ-NPR-Z0-9]{17}$/i.test(searchInput.trim());
      
      if (isVin) {
        // If it's a VIN, redirect to the VIN-specific page
        navigate(`/vehicle/${searchInput.trim()}`);
        return;
      }
      
      // Otherwise, handle as make/model search
      // This would connect to your vehicle search API
      const response = await fetch(`/api/vehicles/search?q=${encodeURIComponent(searchInput.trim())}`);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'Failed to search vehicles');
      }
      
      setSearchResults(data.results || []);
      
      if (data.results?.length === 0) {
        setSearchError('No vehicles found. Try another search term.');
      }
    } catch (err: any) {
      console.error('Search error:', err);
      setSearchError(err.message || 'Failed to search vehicles');
    } finally {
      setIsSearching(false);
    }
  };

  // Handle selecting a vehicle from search results
  const handleSelectVehicle = (vehicleId: string) => {
    navigate(`/vehicle/id/${vehicleId}`);
  };

  // Handle timeline event click
  const handleEventClick = (event: any) => {
    console.log('Event clicked:', event);
    // You could open a modal or navigate to a detail page
  };

  return (
    <div className="vehicle-timeline-page">
      <Helmet>
        <title>{vin ? `Vehicle Timeline: ${vin}` : 'Vehicle Timeline'}</title>
        <meta name="description" content="Explore the digital lifecycle of vehicles across various data sources" />
      </Helmet>
      
      <header className="page-header">
        <h1>Vehicle Digital Lifecycle</h1>
        <p className="subheader">Track and analyze vehicle history across multiple data sources</p>
        
        {/* Search form */}
        <form className="search-form" onSubmit={handleSearch}>
          <input
            type="text"
            placeholder="Enter VIN or search by make/model..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <button type="submit" disabled={isSearching}>
            {isSearching ? 'Searching...' : 'Search'}
          </button>
        </form>
      </header>
      
      <main className="page-content">
        {/* If we have search results, show them */}
        {searchResults.length > 0 && !vin && (
          <div className="search-results-section">
            <h2>Search Results</h2>
            <div className="search-results-grid">
              {searchResults.map((vehicle: any) => (
                <div 
                  key={vehicle.id} 
                  className="vehicle-result-card"
                  onClick={() => handleSelectVehicle(vehicle.id)}
                >
                  {vehicle.image_url && (
                    <div className="vehicle-image">
                      <img src={vehicle.image_url} alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`} />
                    </div>
                  )}
                  <div className="vehicle-details">
                    <h3>{vehicle.year} {vehicle.make} {vehicle.model}</h3>
                    {vehicle.vin && <p className="vin-display">VIN: {vehicle.vin}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* Show search error */}
        {searchError && (
          <div className="search-error">
            <p>{searchError}</p>
          </div>
        )}
        
        {/* If we have a VIN parameter, show timeline */}
        {vin && (
          <div className="timeline-container">
            <VehicleTimeline 
              vin={vin} 
              onEventClick={handleEventClick}
              onTimespanChange={(timespan) => {
                console.log('Timeline span:', timespan);
              }}
            />
          </div>
        )}
        
        {/* No VIN parameter and no search results, show intro */}
        {!vin && searchResults.length === 0 && !searchError && (
          <div className="intro-section">
            <h2>Track Vehicle History Across Multiple Sources</h2>
            <div className="feature-grid">
              <div className="feature-card">
                <h3>Comprehensive Timeline</h3>
                <p>View a vehicle's complete digital lifecycle from manufacturer to present day</p>
              </div>
              <div className="feature-card">
                <h3>Multiple Data Sources</h3>
                <p>Aggregate data from VIN databases, auction houses, service records, and more</p>
              </div>
              <div className="feature-card">
                <h3>Confidence Scoring</h3>
                <p>Each data point is rated for reliability based on source and verification</p>
              </div>
              <div className="feature-card">
                <h3>Event Analysis</h3>
                <p>Understand ownership changes, value trends, and vehicle history</p>
              </div>
            </div>
            <p className="start-prompt">
              Enter a VIN or search by make and model to get started
            </p>
          </div>
        )}
      </main>
    </div>
  );
};

export default VehicleTimelinePage;
