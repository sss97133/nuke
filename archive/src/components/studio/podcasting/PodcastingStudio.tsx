import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Mic2, Radio, Settings, Users, Monitor, Brain, ThumbsUp, Share2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PodcastAnalytics } from './PodcastAnalytics';

interface GuestInfo {
  name: string;
  role: string;
  connectionQuality: number;
  audioLatency: number;
}

interface CameraStatus {
  id: number;
  name: string;
  status: 'active' | 'standby';
  latency: number;
}

export const PodcastingStudio = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [episodeTitle, setEpisodeTitle] = useState('');
  const [audioLevel, setAudioLevel] = useState([50]);
  const { toast } = useToast();

  const [guests] = useState<GuestInfo[]>([
    { name: 'John Doe', role: 'Guest Speaker', connectionQuality: 95, audioLatency: 45 },
    { name: 'Jane Smith', role: 'Industry Expert', connectionQuality: 88, audioLatency: 52 }
  ]);

  const [cameras] = useState<CameraStatus[]>([
    { id: 1, name: 'Main Camera', status: 'active', latency: 12 },
    { id: 2, name: 'Guest View', status: 'active', latency: 15 },
    { id: 3, name: 'Wide Shot', status: 'standby', latency: 18 }
  ]);

  const handleRecordingToggle = () => {
    setIsRecording(!isRecording);
    toast({
      title: isRecording ? "Recording Stopped" : "Recording Started",
      description: isRecording ? "Your episode has been saved" : "Recording new episode",
    });
  };

  const handleLiveToggle = () => {
    setIsLive(!isLive);
    toast({
      title: isLive ? "Stream Ended" : "Stream Started",
      description: isLive ? "Your live session has ended" : "Going live on configured platforms",
    });
  };

  const handleApprove = () => {
    toast({
      title: "Content Approved",
      description: "The podcast manager has approved the current segment",
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        {/* Main Control Panel */}
        <Card className="col-span-2 p-4 space-y-4">
          <div className="flex justify-between items-center">
            <div className="space-y-2">
              <Label>Episode Title</Label>
              <Input 
                value={episodeTitle}
                onChange={(e) => setEpisodeTitle(e.target.value)}
                placeholder="Enter episode title..."
                className="w-[300px]"
              />
            </div>
            <div className="flex gap-2">
              <Button 
                variant={isRecording ? "destructive" : "default"}
                onClick={handleRecordingToggle}
                className="flex items-center gap-2"
              >
                <Mic2 className="w-4 h-4" />
                {isRecording ? "Stop Recording" : "Start Recording"}
              </Button>
              <Button 
                variant={isLive ? "destructive" : "default"}
                onClick={handleLiveToggle}
                className="flex items-center gap-2"
              >
                <Radio className="w-4 h-4" />
                {isLive ? "End Stream" : "Go Live"}
              </Button>
            </div>
          </div>

          {/* Compact Audio Controls */}
          <div className="flex items-center gap-4 bg-muted p-2 rounded-md">
            <Label className="text-xs">Master Volume</Label>
            <Slider
              value={audioLevel}
              onValueChange={setAudioLevel}
              max={100}
              step={1}
              className="w-32"
            />
            <span className="text-xs text-muted-foreground">{audioLevel}%</span>
          </div>
        </Card>

        {/* Quick Actions */}
        <Card className="p-4">
          <div className="space-y-2">
            <Button onClick={handleApprove} className="w-full flex items-center gap-2">
              <ThumbsUp className="w-4 h-4" />
              Approve Segment
            </Button>
            <Button variant="outline" className="w-full flex items-center gap-2">
              <Share2 className="w-4 h-4" />
              Share Screen
            </Button>
          </div>
        </Card>
      </div>

      {/* Analytics and Engagement Section */}
      <PodcastAnalytics episodeId="mock-episode-id" />

      {/* Detailed Information Tabs */}
      <Tabs defaultValue="guests" className="w-full">
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="guests" className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            Guests
          </TabsTrigger>
          <TabsTrigger value="technical" className="flex items-center gap-2">
            <Settings className="w-4 h-4" />
            Technical
          </TabsTrigger>
          <TabsTrigger value="content" className="flex items-center gap-2">
            <Monitor className="w-4 h-4" />
            Content
          </TabsTrigger>
          <TabsTrigger value="ai" className="flex items-center gap-2">
            <Brain className="w-4 h-4" />
            AI Assistant
          </TabsTrigger>
        </TabsList>

        <TabsContent value="guests" className="mt-4">
          <Card className="p-4">
            <ScrollArea className="h-[200px]">
              {guests.map((guest, index) => (
                <div key={index} className="flex justify-between items-center p-2 border-b last:border-0">
                  <div>
                    <h4 className="font-medium">{guest.name}</h4>
                    <p className="text-sm text-muted-foreground">{guest.role}</p>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant={guest.connectionQuality > 90 ? "default" : "secondary"}>
                      {guest.connectionQuality}% Quality
                    </Badge>
                    <Badge variant="outline">{guest.audioLatency}ms</Badge>
                  </div>
                </div>
              ))}
            </ScrollArea>
          </Card>
        </TabsContent>

        <TabsContent value="technical" className="mt-4">
          <Card className="p-4">
            <ScrollArea className="h-[200px]">
              {cameras.map((camera) => (
                <div key={camera.id} className="flex justify-between items-center p-2 border-b last:border-0">
                  <div>
                    <h4 className="font-medium">{camera.name}</h4>
                    <p className="text-sm text-muted-foreground">Status: {camera.status}</p>
                  </div>
                  <Badge variant="outline">{camera.latency}ms latency</Badge>
                </div>
              ))}
            </ScrollArea>
          </Card>
        </TabsContent>

        <TabsContent value="content" className="mt-4">
          <Card className="p-4">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h4 className="font-medium">Current Segment</h4>
                <Badge>Live</Badge>
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Input placeholder="Add segment notes..." />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm">Previous</Button>
                <Button variant="outline" size="sm">Next</Button>
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="ai" className="mt-4">
          <Card className="p-4">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h4 className="font-medium">AI Assistant</h4>
                <Badge variant="secondary">Active</Badge>
              </div>
              <div className="space-y-2">
                <Label>Generate Visual Content</Label>
                <div className="flex gap-2">
                  <Input placeholder="Describe the visual content you need..." />
                  <Button>Generate</Button>
                </div>
              </div>
              <ScrollArea className="h-[100px] border rounded-md p-2">
                <p className="text-sm text-muted-foreground">AI suggestions will appear here...</p>
              </ScrollArea>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};