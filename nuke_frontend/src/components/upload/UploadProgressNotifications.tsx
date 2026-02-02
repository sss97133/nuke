import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface UploadNotification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  timestamp: Date;
  imageId?: string;
  vehicleId?: string;
  extractedData?: any;
  actionRequired?: boolean;
  onAction?: () => void;
}

interface UploadProgressNotificationsProps {
  vehicleId: string;
  onTitleDetected?: (data: any) => void;
  onValidationNeeded?: (conflicts: any[]) => void;
}

export function UploadProgressNotifications({ 
  vehicleId, 
  onTitleDetected,
  onValidationNeeded 
}: UploadProgressNotificationsProps) {
  const [notifications, setNotifications] = useState<UploadNotification[]>([]);
  const [isListening, setIsListening] = useState(false);

  useEffect(() => {
    if (!vehicleId) return;

    // Listen for image processing events
    const channel = supabase
      .channel(`upload-progress-${vehicleId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'vehicle_images',
          filter: `vehicle_id=eq.${vehicleId}`
        },
        async (payload) => {
          const image = payload.new;
          
          // Check for sensitive document detection
          if (image.is_sensitive && !image.sensitive_type_notified) {
            const docType = image.sensitive_type || 'document';
            
            addNotification({
              type: 'success',
              title: `${docType.toUpperCase()} DETECTED`,
              message: `We found your ${docType} and privatized it. Extracting data...`,
              imageId: image.id,
              vehicleId: image.vehicle_id
            });

            // Fetch extracted data from vehicle_title_documents
            if (docType === 'title') {
              const { data: titleData } = await supabase
                .from('vehicle_title_documents')
                .select('*')
                .eq('image_id', image.id)
                .single();

              if (titleData) {
                const fields = [];
                if (titleData.vin) fields.push(`VIN: ${titleData.vin}`);
                if (titleData.odometer_reading) fields.push(`Mileage: ${titleData.odometer_reading.toLocaleString()}`);
                if (titleData.owner_name) fields.push(`Owner: ${titleData.owner_name}`);
                if (titleData.state) fields.push(`State: ${titleData.state}`);

                addNotification({
                  type: 'info',
                  title: 'Title Data Extracted',
                  message: `Extracted: ${fields.join(', ')}`,
                  imageId: image.id,
                  vehicleId: image.vehicle_id,
                  extractedData: titleData,
                  actionRequired: true
                });

                // Trigger validation check
                if (onTitleDetected) {
                  onTitleDetected(titleData);
                }

                // Check for conflicts
                await checkValidation(titleData);
              }
            }
          }

          // Check for tier 1 analysis complete
          if (image.ai_scan_metadata?.tier_1_analysis && !image.tier1_notified) {
            const analysis = image.ai_scan_metadata.tier_1_analysis;
            
            addNotification({
              type: 'success',
              title: 'Image Analyzed',
              message: `Classified as ${analysis.category || 'general'} - ${analysis.angle || 'unknown angle'}`,
              imageId: image.id
            });
          }
        }
      )
      .subscribe();

    setIsListening(true);

    return () => {
      channel.unsubscribe();
      setIsListening(false);
    };
  }, [vehicleId, onTitleDetected]);

  const addNotification = (notification: Omit<UploadNotification, 'id' | 'timestamp'>) => {
    const newNotification = {
      ...notification,
      id: crypto.randomUUID(),
      timestamp: new Date()
    };
    
    setNotifications(prev => [newNotification, ...prev].slice(0, 10)); // Keep last 10
  };

  const checkValidation = async (titleData: any) => {
    // Get vehicle data
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('vin, mileage, owner_name')
      .eq('id', vehicleId)
      .single();

    if (!vehicle) return;

    const conflicts = [];

    // Check VIN
    if (titleData.vin && vehicle.vin && titleData.vin !== vehicle.vin) {
      conflicts.push({
        field: 'VIN',
        profileValue: vehicle.vin,
        titleValue: titleData.vin,
        severity: 'high'
      });
    }

    // Check mileage (allow 10k variance)
    if (titleData.odometer_reading && vehicle.mileage) {
      const diff = Math.abs(vehicle.mileage - titleData.odometer_reading);
      if (diff > 10000) {
        conflicts.push({
          field: 'Mileage',
          profileValue: vehicle.mileage.toLocaleString(),
          titleValue: titleData.odometer_reading.toLocaleString(),
          severity: 'medium',
          note: `${diff.toLocaleString()} mile difference`
        });
      }
    }

    if (conflicts.length > 0) {
      addNotification({
        type: 'warning',
        title: 'Validation Conflicts Detected',
        message: `${conflicts.length} field(s) don't match - review needed`,
        vehicleId,
        actionRequired: true
      });

      if (onValidationNeeded) {
        onValidationNeeded(conflicts);
      }
    } else if (titleData.vin || titleData.odometer_reading) {
      // No conflicts - can suggest auto-fill
      const suggestions = [];
      if (titleData.vin && !vehicle.vin) suggestions.push('VIN');
      if (titleData.odometer_reading && !vehicle.mileage) suggestions.push('Mileage');

      if (suggestions.length > 0) {
        addNotification({
          type: 'info',
          title: 'Title Can Fill Empty Fields',
          message: `Can auto-fill: ${suggestions.join(', ')}`,
          vehicleId,
          actionRequired: true
        });
      }
    }
  };

  const dismissNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  if (notifications.length === 0) return null;

  return (
    <div className="fixed top-[110px] right-4 z-[101] space-y-2 max-w-md">
      {notifications.map(notification => (
        <div
          key={notification.id}
          className={`
            bg-white dark:bg-gray-800 border-2 rounded-lg shadow-lg p-4
            transform transition-all duration-300 ease-out
            ${notification.type === 'success' ? 'border-green-500' : ''}
            ${notification.type === 'warning' ? 'border-yellow-500' : ''}
            ${notification.type === 'error' ? 'border-red-500' : ''}
            ${notification.type === 'info' ? 'border-blue-500' : ''}
          `}
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center space-x-2">
                {notification.type === 'success' && (
                  <span className="text-2xl">✅</span>
                )}
                {notification.type === 'warning' && (
                  <span className="text-2xl">⚠️</span>
                )}
                {notification.type === 'error' && (
                  <span className="text-2xl">❌</span>
                )}
                {notification.type === 'info' && (
                  <span className="text-2xl">🔒</span>
                )}
                <h3 className="font-bold text-lg text-gray-900 dark:text-white">{notification.title}</h3>
              </div>
              
              <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                {notification.message}
              </p>

              {notification.extractedData && (
                <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600 text-xs font-mono text-gray-800 dark:text-gray-200">
                  <div className="font-bold mb-1">Extracted Fields:</div>
                  {notification.extractedData.vin && (
                    <div>VIN: {notification.extractedData.vin}</div>
                  )}
                  {notification.extractedData.odometer_reading && (
                    <div>Mileage: {notification.extractedData.odometer_reading.toLocaleString()}</div>
                  )}
                  {notification.extractedData.owner_name && (
                    <div>Owner: {notification.extractedData.owner_name}</div>
                  )}
                  {notification.extractedData.state && (
                    <div>State: {notification.extractedData.state}</div>
                  )}
                  <div className="mt-1 text-gray-500 dark:text-gray-400">
                    Confidence: {Math.round((notification.extractedData.extraction_confidence || 0) * 100)}%
                  </div>
                </div>
              )}

              {notification.actionRequired && (
                <button
                  onClick={notification.onAction}
                  className="mt-3 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium"
                >
                  Review Now
                </button>
              )}

              <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {notification.timestamp.toLocaleTimeString()}
              </div>
            </div>

            <button
              onClick={() => dismissNotification(notification.id)}
              className="ml-4 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 text-xl leading-none"
            >
              ×
            </button>
          </div>
        </div>
      ))}

      {isListening && (
        <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
          Listening for image processing updates...
        </div>
      )}
    </div>
  );
}

