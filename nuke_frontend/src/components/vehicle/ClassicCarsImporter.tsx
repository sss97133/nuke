import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';

interface ClassicCarsImporterProps {
  onImportComplete?: (vehicleId: string) => void;
  onClose?: () => void;
}

export const ClassicCarsImporter: React.FC<ClassicCarsImporterProps> = ({
  onImportComplete,
  onClose
}) => {
  const [url, setUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const handleImport = async () => {
    if (!url.trim() || !url.includes('classiccars.com')) {
      setError('Please enter a valid ClassicCars.com listing URL');
      return;
    }

    setImporting(true);
    setError(null);
    setProgress('Fetching listing data...');
    setResult(null);

    try {
      // Get current user
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        throw new Error('You must be logged in to import listings');
      }

      setProgress('Scraping listing and downloading images...');

      // Call the import edge function
      const { data, error: importError } = await supabase.functions.invoke('import-classiccars-listing', {
        body: {
          url: url.trim(),
          userId: user.id
        }
      });

      if (importError) {
        throw importError;
      }

      if (!data?.success) {
        throw new Error(data?.error || 'Import failed');
      }

      setResult({
        vehicleId: data.vehicleId,
        imagesProcessed: data.imagesProcessed,
        conditionScore: data.conditionScore,
        vehicle: data.vehicle
      });

      setProgress(`✅ Import complete! ${data.imagesProcessed} images processed, Condition Score: ${data.conditionScore}/10`);

      // Call callback after a short delay
      if (onImportComplete && data.vehicleId) {
        setTimeout(() => {
          onImportComplete(data.vehicleId);
        }, 2000);
      }

    } catch (err: any) {
      console.error('Import error:', err);
      setError(err.message || 'Failed to import listing');
      setProgress('');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="card p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">Import from ClassicCars.com</h2>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
            aria-label="Close"
          >
            ✕
          </button>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="url" className="block text-sm font-medium mb-2">
            ClassicCars.com Listing URL
          </label>
          <input
            id="url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://classiccars.com/listings/view/..."
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={importing}
          />
          <p className="mt-1 text-sm text-gray-500">
            Paste a ClassicCars.com listing URL to import the vehicle with all images and AI analysis
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {progress && (
          <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded">
            {progress}
          </div>
        )}

        {result && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
            <h3 className="font-semibold mb-2">Import Successful!</h3>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>Vehicle: {result.vehicle.year} {result.vehicle.make} {result.vehicle.model}</li>
              <li>Images Processed: {result.imagesProcessed}</li>
              <li>Condition Score: {result.conditionScore}/10</li>
            </ul>
            <div className="mt-3">
              <a
                href={`/vehicles/${result.vehicleId}`}
                className="text-green-700 underline hover:text-green-900"
              >
                View Vehicle Profile →
              </a>
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={handleImport}
            disabled={importing || !url.trim()}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {importing ? 'Importing...' : 'Import Listing'}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
              disabled={importing}
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      <div className="mt-6 p-4 bg-gray-50 rounded-lg">
        <h3 className="font-semibold mb-2">What gets imported:</h3>
        <ul className="list-disc list-inside space-y-1 text-sm text-gray-700">
          <li>Vehicle details (year, make, model, VIN, mileage, etc.)</li>
          <li>All listing images (downloaded and analyzed)</li>
          <li>Seller contact information</li>
          <li>Listing description and details</li>
          <li>AI-generated condition score based on images</li>
        </ul>
      </div>
    </div>
  );
};

