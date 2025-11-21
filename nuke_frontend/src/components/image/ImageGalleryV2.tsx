import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import ImageGallery from '../images/ImageGallery';
import type { Session } from '@supabase/supabase-js';

interface ImageGalleryV2Props {
  vehicleId: string;
  vehicleYMM?: {
    year?: number | null;
    make?: string | null;
    model?: string | null;
  };
  onImagesUpdated?: () => void;
}

const ImageGalleryV2: React.FC<ImageGalleryV2Props> = ({
  vehicleId,
  vehicleYMM,
  onImagesUpdated
}) => {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    // Get initial session
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);
    };
    getSession();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // SIMPLIFIED: Show upload if user is logged in - let RLS handle actual permissions
  const showUpload = Boolean(session?.user?.id);

  return (
    <ImageGallery
      vehicleId={vehicleId}
      onImagesUpdated={onImagesUpdated}
      showUpload={showUpload}
    />
  );
};

export default ImageGalleryV2;
