import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import type { StudioConfigV2 } from './types/studioConfig';

interface StudioConfigFormV2Props {
  onUpdate: (config: StudioConfigV2) => void;
  initialConfig: StudioConfigV2;
}

export const StudioConfigFormV2 = ({ onUpdate, initialConfig }: StudioConfigFormV2Props) => {
  const { register, handleSubmit, watch, setValue } = useForm<StudioConfigV2>({
    defaultValues: initialConfig
  });

  const formData = watch();

  useEffect(() => {
    onUpdate(formData);
  }, [formData, onUpdate]);

  const handleTrackMovementChange = (
    trackIndex: number,
    field: keyof StudioConfigV2['ptzTracks'][0]['movement'],
    value: any
  ) => {
    const updatedTracks = [...formData.ptzTracks];
    if (field === 'amplitude') {
      updatedTracks[trackIndex].movement.amplitude = value;
    } else {
      updatedTracks[trackIndex].movement[field] = value;
    }
    setValue('ptzTracks', updatedTracks);
  };

  return (
    <form className="space-y-6">
      <Tabs defaultValue="dimensions">
        <TabsList>
          <TabsTrigger value="dimensions">Room</TabsTrigger>
          <TabsTrigger value="tracks">PTZ Tracks</TabsTrigger>
          <TabsTrigger value="cameras">Cameras</TabsTrigger>
          <TabsTrigger value="props">Props</TabsTrigger>
        </TabsList>

        <TabsContent value="dimensions" className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Length (ft)</Label>
              <Input
                type="number"
                {...register('dimensions.length')}
              />
            </div>
            <div>
              <Label>Width (ft)</Label>
              <Input
                type="number"
                {...register('dimensions.width')}
              />
            </div>
            <div>
              <Label>Height (ft)</Label>
              <Input
                type="number"
                {...register('dimensions.height')}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="tracks" className="space-y-4">
          {formData.ptzTracks.map((track, index) => (
            <div key={index} className="space-y-4 p-4 border rounded">
              <h3 className="font-semibold">Track {index + 1}</h3>
              
              <div className="space-y-4">
                <div>
                  <Label>Movement Amplitude X</Label>
                  <Slider
                    value={[track.movement.amplitude.x]}
                    min={0}
                    max={10}
                    step={0.1}
                    onValueChange={(value) => handleTrackMovementChange(index, 'amplitude', {
                      ...track.movement.amplitude,
                      x: value[0]
                    })}
                  />
                </div>

                <div>
                  <Label>Movement Amplitude Z</Label>
                  <Slider
                    value={[track.movement.amplitude.z]}
                    min={0}
                    max={10}
                    step={0.1}
                    onValueChange={(value) => handleTrackMovementChange(index, 'amplitude', {
                      ...track.movement.amplitude,
                      z: value[0]
                    })}
                  />
                </div>

                <div>
                  <Label>Frequency (Hz)</Label>
                  <Slider
                    value={[track.movement.frequency]}
                    min={0}
                    max={2}
                    step={0.1}
                    onValueChange={(value) => handleTrackMovementChange(index, 'frequency', value[0])}
                  />
                </div>

                <div>
                  <Label>Phase Offset (rad)</Label>
                  <Slider
                    value={[track.movement.phase]}
                    min={0}
                    max={2 * Math.PI}
                    step={0.1}
                    onValueChange={(value) => handleTrackMovementChange(index, 'phase', value[0])}
                  />
                </div>

                <div>
                  <Label>Speed</Label>
                  <Slider
                    value={[track.speed]}
                    min={0.1}
                    max={5}
                    step={0.1}
                    onValueChange={(value) => {
                      const updatedTracks = [...formData.ptzTracks];
                      updatedTracks[index].speed = value[0];
                      setValue('ptzTracks', updatedTracks);
                    }}
                  />
                </div>

                <div>
                  <Label>Cone Angle (degrees)</Label>
                  <Slider
                    value={[track.coneAngle]}
                    min={10}
                    max={120}
                    step={5}
                    onValueChange={(value) => {
                      const updatedTracks = [...formData.ptzTracks];
                      updatedTracks[index].coneAngle = value[0];
                      setValue('ptzTracks', updatedTracks);
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="cameras" className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {Object.entries(formData.cameras).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between">
                <Label>{key}</Label>
                <Switch
                  checked={value}
                  onCheckedChange={(checked) => {
                    setValue(`cameras.${key}` as any, checked);
                  }}
                />
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="props" className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {Object.entries(formData.props).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between">
                <Label>{key}</Label>
                <Switch
                  checked={value}
                  onCheckedChange={(checked) => {
                    setValue(`props.${key}` as any, checked);
                  }}
                />
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </form>
  );
};