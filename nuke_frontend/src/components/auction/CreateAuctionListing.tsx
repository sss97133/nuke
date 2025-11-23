/**
 * Create Auction Listing Component
 * Comprehensive form for creating auction listings with AI assistance
 */

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import '../../design-system.css';

interface VehicleOption {
  id: string;
  year: number;
  make: string;
  model: string;
  trim: string | null;
  primary_image_url: string | null;
}

export default function CreateAuctionListing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Step 1: Vehicle Selection
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState('');

  // Step 2: Auction Type & Timing
  const [saleType, setSaleType] = useState<'auction' | 'live_auction'>('auction');
  const [auctionDuration, setAuctionDuration] = useState(7); // days
  const [startImmediately, setStartImmediately] = useState(true);
  const [scheduledStartDate, setScheduledStartDate] = useState('');
  const [scheduledStartTime, setScheduledStartTime] = useState('');

  // Step 3: Pricing
  const [startingBid, setStartingBid] = useState('');
  const [reservePrice, setReservePrice] = useState('');
  const [hasReserve, setHasReserve] = useState(false);
  const [buyNowPrice, setBuyNowPrice] = useState('');
  const [hasBuyNow, setHasBuyNow] = useState(false);

  // Step 4: Description & Details
  const [description, setDescription] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);

  useEffect(() => {
    loadUserVehicles();
  }, [user]);

  const loadUserVehicles = async () => {
    if (!user) return;

    const { data, error } = await supabase
      .from('vehicles')
      .select('id, year, make, model, trim, primary_image_url')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setVehicles(data);
    }
  };

  const generateAIDescription = async () => {
    if (!selectedVehicleId) return;

    setAiGenerating(true);

    try {
      // Get vehicle details including timeline, modifications, and history
      const { data: vehicle, error: vehicleError } = await supabase
        .from('vehicles')
        .select(`
          *,
          timeline_events (
            event_type,
            event_date,
            description,
            cost_cents
          )
        `)
        .eq('id', selectedVehicleId)
        .single();

      if (vehicleError) throw vehicleError;

      // Call AI to generate description
      const { data, error } = await supabase.functions.invoke('generate-auction-description', {
        body: {
          vehicle,
          include_timeline: true,
          style: saleType === 'live_auction' ? 'concise' : 'detailed'
        }
      });

      if (error) throw error;

      if (data?.description) {
        setDescription(data.description);
      }
    } catch (error) {
      console.error('Error generating description:', error);
      alert('Failed to generate AI description');
    } finally {
      setAiGenerating(false);
    }
  };

  const createListing = async () => {
    if (!user || !selectedVehicleId) return;

    setLoading(true);

    try {
      let auctionStartTime: string;
      if (startImmediately) {
        auctionStartTime = new Date().toISOString();
      } else {
        const startDateTime = new Date(`${scheduledStartDate}T${scheduledStartTime}`);
        auctionStartTime = startDateTime.toISOString();
      }

      const durationMinutes = saleType === 'live_auction' 
        ? 5 
        : auctionDuration * 24 * 60;

      const auctionEndTime = new Date(
        new Date(auctionStartTime).getTime() + durationMinutes * 60 * 1000
      ).toISOString();

      const { data, error } = await supabase
        .from('vehicle_listings')
        .insert({
          vehicle_id: selectedVehicleId,
          seller_id: user.id,
          sale_type: saleType,
          list_price_cents: startingBid ? Math.floor(parseFloat(startingBid) * 100) : null,
          reserve_price_cents: hasReserve && reservePrice 
            ? Math.floor(parseFloat(reservePrice) * 100) 
            : null,
          auction_start_time: auctionStartTime,
          auction_end_time: auctionEndTime,
          auction_duration_minutes: durationMinutes,
          sniping_protection_minutes: 2,
          status: startImmediately ? 'active' : 'draft',
          description,
          metadata: {
            has_buy_now: hasBuyNow,
            buy_now_price_cents: hasBuyNow && buyNowPrice 
              ? Math.floor(parseFloat(buyNowPrice) * 100) 
              : null,
            created_via: 'create_auction_wizard'
          }
        })
        .select()
        .single();

      if (error) throw error;

      alert('Auction listing created successfully!');
      navigate(`/vehicle/${selectedVehicleId}`);
    } catch (error) {
      console.error('Error creating listing:', error);
      alert('Failed to create listing');
    } finally {
      setLoading(false);
    }
  };

  const selectedVehicle = vehicles.find(v => v.id === selectedVehicleId);

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Progress Indicator */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          {[1, 2, 3, 4].map((s) => (
            <div key={s} className="flex items-center flex-1">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                  step >= s ? 'bg-blue-600 text-white' : 'bg-gray-300 text-gray-600'
                }`}
              >
                {s}
              </div>
              {s < 4 && (
                <div className={`flex-1 h-1 mx-2 ${step > s ? 'bg-blue-600' : 'bg-gray-300'}`} />
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-between mt-2 text-xs text-gray-600">
          <span>Select Vehicle</span>
          <span>Auction Type</span>
          <span>Pricing</span>
          <span>Details</span>
        </div>
      </div>

      {/* Step 1: Vehicle Selection */}
      {step === 1 && (
        <div className="space-y-6">
          <h2 className="text-2xl font-bold">Select Vehicle to List</h2>

          {vehicles.length === 0 ? (
            <div className="bg-gray-50 p-8 rounded-lg text-center">
              <p className="text-gray-600 mb-4">You don't have any vehicles yet.</p>
              <button
                onClick={() => navigate('/add-vehicle')}
                className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Add Your First Vehicle
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {vehicles.map((vehicle) => (
                <button
                  key={vehicle.id}
                  onClick={() => setSelectedVehicleId(vehicle.id)}
                  className={`p-4 rounded-lg border-2 text-left transition-all ${
                    selectedVehicleId === vehicle.id
                      ? 'border-blue-600 bg-blue-50'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <div className="flex gap-4">
                    {vehicle.primary_image_url && (
                      <img
                        src={vehicle.primary_image_url}
                        alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                        className="w-24 h-24 object-cover rounded"
                      />
                    )}
                    <div className="flex-1">
                      <h3 className="font-bold">
                        {vehicle.year} {vehicle.make} {vehicle.model}
                      </h3>
                      {vehicle.trim && (
                        <p className="text-sm text-gray-600">{vehicle.trim}</p>
                      )}
                    </div>
                    {selectedVehicleId === vehicle.id && (
                      <div className="text-blue-600 font-bold text-xl">✓</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          <button
            onClick={() => setStep(2)}
            disabled={!selectedVehicleId}
            className="w-full py-3 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            Continue
          </button>
        </div>
      )}

      {/* Step 2: Auction Type & Timing */}
      {step === 2 && (
        <div className="space-y-6">
          <h2 className="text-2xl font-bold">Auction Configuration</h2>

          <div className="bg-white p-6 rounded-lg border border-gray-200 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Auction Type
              </label>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setSaleType('auction')}
                  className={`p-4 rounded-lg border-2 text-left ${
                    saleType === 'auction'
                      ? 'border-blue-600 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <h3 className="font-bold mb-1">Standard Auction</h3>
                  <p className="text-sm text-gray-600">
                    Traditional multi-day auction (BaT-style)
                  </p>
                </button>
                <button
                  onClick={() => setSaleType('live_auction')}
                  className={`p-4 rounded-lg border-2 text-left ${
                    saleType === 'live_auction'
                      ? 'border-blue-600 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <h3 className="font-bold mb-1">Live Auction</h3>
                  <p className="text-sm text-gray-600">
                    Fast-paced 5-minute auction
                  </p>
                </button>
              </div>
            </div>

            {saleType === 'auction' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Auction Duration
                </label>
                <select
                  value={auctionDuration}
                  onChange={(e) => setAuctionDuration(parseInt(e.target.value))}
                  className="w-full px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="1">1 day</option>
                  <option value="3">3 days</option>
                  <option value="5">5 days</option>
                  <option value="7">7 days (recommended)</option>
                  <option value="10">10 days</option>
                  <option value="14">14 days</option>
                </select>
              </div>
            )}

            <div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={startImmediately}
                  onChange={(e) => setStartImmediately(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-sm font-medium">Start auction immediately</span>
              </label>
            </div>

            {!startImmediately && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={scheduledStartDate}
                    onChange={(e) => setScheduledStartDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Start Time
                  </label>
                  <input
                    type="time"
                    value={scheduledStartTime}
                    onChange={(e) => setScheduledStartTime(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-4">
            <button
              onClick={() => setStep(1)}
              className="flex-1 py-3 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors"
            >
              Back
            </button>
            <button
              onClick={() => setStep(3)}
              className="flex-1 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Pricing */}
      {step === 3 && (
        <div className="space-y-6">
          <h2 className="text-2xl font-bold">Set Pricing</h2>

          <div className="bg-white p-6 rounded-lg border border-gray-200 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Starting Bid ($)
              </label>
              <input
                type="number"
                value={startingBid}
                onChange={(e) => setStartingBid(e.target.value)}
                placeholder="1000"
                step="100"
                className="w-full px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Minimum bid to start the auction
              </p>
            </div>

            <div>
              <label className="flex items-center gap-2 mb-2">
                <input
                  type="checkbox"
                  checked={hasReserve}
                  onChange={(e) => setHasReserve(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-sm font-medium">Set reserve price (hidden from bidders)</span>
              </label>
              {hasReserve && (
                <input
                  type="number"
                  value={reservePrice}
                  onChange={(e) => setReservePrice(e.target.value)}
                  placeholder="5000"
                  step="100"
                  className="w-full px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}
            </div>

            <div>
              <label className="flex items-center gap-2 mb-2">
                <input
                  type="checkbox"
                  checked={hasBuyNow}
                  onChange={(e) => setHasBuyNow(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-sm font-medium">Enable Buy Now option</span>
              </label>
              {hasBuyNow && (
                <input
                  type="number"
                  value={buyNowPrice}
                  onChange={(e) => setBuyNowPrice(e.target.value)}
                  placeholder="10000"
                  step="100"
                  className="w-full px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}
            </div>
          </div>

          <div className="flex gap-4">
            <button
              onClick={() => setStep(2)}
              className="flex-1 py-3 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors"
            >
              Back
            </button>
            <button
              onClick={() => setStep(4)}
              disabled={!startingBid}
              className="flex-1 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Description */}
      {step === 4 && (
        <div className="space-y-6">
          <h2 className="text-2xl font-bold">Auction Description</h2>

          <div className="bg-white p-6 rounded-lg border border-gray-200 space-y-4">
            <div className="flex justify-between items-center">
              <label className="block text-sm font-medium text-gray-700">
                Listing Description
              </label>
              <button
                onClick={generateAIDescription}
                disabled={aiGenerating}
                className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:bg-gray-400 text-sm transition-colors"
              >
                {aiGenerating ? 'Generating...' : 'Generate with AI'}
              </button>
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your vehicle's condition, history, modifications, and what makes it special..."
              rows={12}
              className="w-full px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500">
              Write a compelling description that highlights the vehicle's best features and history.
              Be honest about any issues or imperfections.
            </p>
          </div>

          {selectedVehicle && (
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
              <h3 className="font-bold mb-2">Preview</h3>
              <p className="font-bold">
                {selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}
              </p>
              <p className="text-sm text-gray-600 mt-1">
                Starting Bid: ${startingBid}
                {hasReserve && ' (Reserve)'}
              </p>
              <p className="text-sm text-gray-600">
                {saleType === 'live_auction' ? '5 minute' : `${auctionDuration} day`} auction
              </p>
            </div>
          )}

          <div className="flex gap-4">
            <button
              onClick={() => setStep(3)}
              className="flex-1 py-3 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors"
            >
              Back
            </button>
            <button
              onClick={createListing}
              disabled={loading || !description}
              className="flex-1 py-3 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Creating...' : 'Create Listing'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

