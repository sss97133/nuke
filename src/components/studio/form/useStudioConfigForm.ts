
import { useState } from 'react';
import type { PTZTrack } from '../types/workspace';

interface InitialFormData {
  dimensions: {
    length: number;
    width: number;
    height: number;
  };
  ptzTracks: PTZTrack[];
}

interface FormState {
  length: string;
  width: string;
  height: string;
  ptzTracks: {
    position: {
      x: string;
      y: string;
      z: string;
    };
    length: string;
    speed: string;
    coneAngle: string;
  }[];
}

export const useStudioConfigForm = (initialData: InitialFormData, onUpdate: (data: any) => void) => {
  const [formData, setFormData] = useState<FormState>({
    length: initialData.dimensions.length.toString(),
    width: initialData.dimensions.width.toString(),
    height: initialData.dimensions.height.toString(),
    ptzTracks: initialData.ptzTracks.map(track => ({
      position: {
        x: track.position.x.toString(),
        y: track.position.y.toString(),
        z: track.position.z.toString()
      },
      length: (track.length || 10).toString(),  // Default to 10 if undefined
      speed: track.speed.toString(),
      coneAngle: (track.coneAngle || 45).toString()  // Default to 45 if undefined
    }))
  });
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    onUpdate({
      length: Number(formData.length),
      width: Number(formData.width),
      height: Number(formData.height),
      ptzTracks: formData.ptzTracks.map((track, index) => ({
        id: initialData.ptzTracks[index]?.id || `track-${index}`,
        name: initialData.ptzTracks[index]?.name || `Camera ${index + 1}`,
        position: {
          x: Number(track.position.x),
          y: Number(track.position.y),
          z: Number(track.position.z)
        },
        length: Number(track.length),
        speed: Number(track.speed),
        coneAngle: Number(track.coneAngle),
        zoom: initialData.ptzTracks[index]?.zoom || 1
      }))
    });
  };
  
  const handleDimensionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };
  
  const handleTrackChange = (index: number, field: string, value: string) => {
    setFormData(prev => {
      const updatedTracks = [...prev.ptzTracks];
      
      // Handle nested position properties
      if (field.startsWith('position.')) {
        const posKey = field.split('.')[1] as 'x' | 'y' | 'z';
        updatedTracks[index] = {
          ...updatedTracks[index],
          position: {
            ...updatedTracks[index].position,
            [posKey]: value
          }
        };
      } else {
        updatedTracks[index] = {
          ...updatedTracks[index],
          [field]: value
        };
      }
      
      return {
        ...prev,
        ptzTracks: updatedTracks
      };
    });
  };
  
  const addTrack = () => {
    setFormData(prev => ({
      ...prev,
      ptzTracks: [
        ...prev.ptzTracks,
        {
          position: { x: '0', y: '8', z: '0' },
          length: '10',
          speed: '1',
          coneAngle: '45'
        }
      ]
    }));
  };
  
  const removeTrack = (index: number) => {
    setFormData(prev => ({
      ...prev,
      ptzTracks: prev.ptzTracks.filter((_, i) => i !== index)
    }));
  };

  return {
    formData,
    handleSubmit,
    handleDimensionChange,
    handleTrackChange,
    addTrack,
    removeTrack
  };
};
