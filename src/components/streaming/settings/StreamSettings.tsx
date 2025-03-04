
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";

export const StreamSettings = () => {
  return (
    <Card className="mt-4">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Stream Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="quality">Quality</Label>
          <Select defaultValue="720p">
            <SelectTrigger id="quality">
              <SelectValue placeholder="Select quality" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1080p">1080p (High)</SelectItem>
              <SelectItem value="720p">720p (Medium)</SelectItem>
              <SelectItem value="480p">480p (Low)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <div className="space-y-2">
          <div className="flex justify-between">
            <Label htmlFor="bitrate">Bitrate</Label>
            <span className="text-xs text-muted-foreground">3500 kbps</span>
          </div>
          <Slider 
            defaultValue={[3500]} 
            max={6000} 
            min={1000} 
            step={500}
            id="bitrate"
          />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="platform">Streaming Platform</Label>
          <Select defaultValue="platform1">
            <SelectTrigger id="platform">
              <SelectValue placeholder="Select platform" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="platform1">Platform 1</SelectItem>
              <SelectItem value="platform2">Platform 2</SelectItem>
              <SelectItem value="platform3">Platform 3</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
};
