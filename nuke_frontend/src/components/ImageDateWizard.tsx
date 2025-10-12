import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Button } from './ui/button';
import type { Calendar } from 'lucide-react';

interface UndatedImage {
  id: string;
  image_url: string;
  created_at: string;
  vehicle_id: string;
  exif_data?: any; // Optional EXIF data object
}

export function ImageDateWizard() {
  const { vehicleId } = useParams();
  const [undatedImages, setUndatedImages] = useState<UndatedImage[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadUndatedImages();
  }, [vehicleId]);

  const loadUndatedImages = async () => {
    if (!vehicleId) return;

    const { data, error } = await supabase
      .from('vehicle_images')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .or(`exif_data.is.null,and(exif_data->>dateTimeOriginal.is.null,exif_data->>dateTime.is.null)`);

    if (!error && data) {
      setUndatedImages(data);
    }
    setLoading(false);
  };

  const handleDateSubmit = async () => {
    if (!selectedDate || !undatedImages[currentIndex]) return;

    const image = undatedImages[currentIndex];
    
    // Update the image with the provided date
    const { error } = await supabase
      .from('vehicle_images')
      .update({
        exif_data: {
          ...image.exif_data,
          dateTimeOriginal: selectedDate + ' 00:00:00',
          source: 'user_provided',
          dateProvided: new Date().toISOString()
        }
      })
      .eq('id', image.id);

    if (!error) {
      // Move to next image
      if (currentIndex < undatedImages.length - 1) {
        setCurrentIndex(currentIndex + 1);
        setSelectedDate('');
      } else {
        // All done - trigger timeline regeneration
        await regenerateTimeline();
        window.location.href = `/vehicle/${vehicleId}`;
      }
    }
  };

  const regenerateTimeline = async () => {
    // Call a database function to regenerate timeline with new dates
    await supabase.rpc('regenerate_vehicle_timeline', {
      vehicle_id: vehicleId
    });
  };

  if (loading) {
    return <div>Loading undated images...</div>;
  }

  if (undatedImages.length === 0) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-2xl font-bold mb-4">All Images Have Dates</h2>
        <p>Great! All your images have date information.</p>
        <Button onClick={() => window.location.href = `/vehicle/${vehicleId}`}>
          Back to Vehicle
        </Button>
      </div>
    );
  }

  const currentImage = undatedImages[currentIndex];

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-2">Add Dates to Your Images</h2>
        <p className="text-gray-600">
          Image {currentIndex + 1} of {undatedImages.length} - These images are missing date information
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <img 
            src={currentImage.image_url} 
            alt="Undated vehicle image"
            className="w-full rounded-lg shadow-lg"
          />
          <div className="text-sm text-gray-500">
            Uploaded: {new Date(currentImage.created_at).toLocaleDateString()}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              When was this photo taken?
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              max={new Date().toISOString().split('T')[0]}
            />
            <p className="text-sm text-gray-500 mt-2">
              Try to remember when this work was done or photo was taken
            </p>
          </div>

          <div className="flex gap-3">
            <Button 
              onClick={handleDateSubmit}
              disabled={!selectedDate}
              className="flex-1"
            >
              <Calendar className="w-4 h-4 mr-2" />
              Save & Next
            </Button>
            
            <Button 
              variant="outline"
              onClick={() => {
                if (currentIndex < undatedImages.length - 1) {
                  setCurrentIndex(currentIndex + 1);
                  setSelectedDate('');
                }
              }}
              disabled={currentIndex >= undatedImages.length - 1}
            >
              Skip
            </Button>
          </div>

          <Button
            variant="ghost"
            onClick={() => window.location.href = `/vehicle/${vehicleId}`}
            className="w-full"
          >
            Save Progress & Exit
          </Button>
        </div>
      </div>

      {/* Progress indicator */}
      <div className="mt-8">
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div 
            className="bg-blue-600 h-2 rounded-full"
            style={{ width: `${((currentIndex + 1) / undatedImages.length) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
