import React, { useState, useEffect, useRef } from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { 
  Video, Mic, Camera, Settings, PauseCircle, PlayCircle, 
  Film, Download, Share, Monitor, ScreenShare, Users, Sliders,
  SunIcon, Lightbulb
} from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createBasicStudioLighting, createProductLighting } from '@/components/studio/utils/studioLighting';

const StudioPreview = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const [lightMode, setLightMode] = useState<'basic' | 'product'>('basic');

  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      75,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0, 5, 15);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.shadowMap.enabled = true;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    
    scene.userData.renderer = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controlsRef.current = controls;

    const floorGeometry = new THREE.PlaneGeometry(30, 30);
    const floorMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x333333, 
      roughness: 0.8 
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x555555 });
    
    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(30, 15), wallMaterial);
    backWall.position.z = -15;
    backWall.position.y = 7.5;
    backWall.receiveShadow = true;
    scene.add(backWall);

    const boxGeometry = new THREE.BoxGeometry(2, 2, 2);
    const boxMaterial = new THREE.MeshStandardMaterial({ color: 0x3366ff });
    const box = new THREE.Mesh(boxGeometry, boxMaterial);
    box.position.y = 1;
    box.castShadow = true;
    scene.add(box);

    createBasicStudioLighting(scene);

    const animate = () => {
      requestAnimationFrame(animate);
      
      if (controlsRef.current) {
        controlsRef.current.update();
      }
      
      if (rendererRef.current && cameraRef.current && sceneRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    const handleResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;
      
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      
      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(width, height);
    };
    
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      
      if (containerRef.current && rendererRef.current) {
        containerRef.current.removeChild(rendererRef.current.domElement);
      }
      
      if (controlsRef.current) {
        controlsRef.current.dispose();
      }
      
      if (rendererRef.current) {
        rendererRef.current.dispose();
      }
    };
  }, []);

  const changeLighting = (mode: 'basic' | 'product') => {
    if (!sceneRef.current) return;
    
    setLightMode(mode);
    
    sceneRef.current.children.forEach(child => {
      if (child.type === 'DirectionalLight' || child.type === 'AmbientLight' || 
          child.type === 'SpotLight' || child.type === 'Group' || child.type === 'RectAreaLight') {
        sceneRef.current?.remove(child);
      }
    });
    
    if (mode === 'basic') {
      createBasicStudioLighting(sceneRef.current);
    } else {
      createProductLighting(sceneRef.current);
    }
  };

  return (
    <div className="relative h-full">
      <div 
        ref={containerRef} 
        className="w-full aspect-video bg-black rounded-md overflow-hidden"
      />
      <div className="absolute bottom-4 right-4 flex space-x-2">
        <Button 
          variant={lightMode === 'basic' ? "default" : "outline"} 
          size="sm"
          onClick={() => changeLighting('basic')}
        >
          <SunIcon className="h-4 w-4 mr-2" />
          Studio Lighting
        </Button>
        <Button 
          variant={lightMode === 'product' ? "default" : "outline"} 
          size="sm"
          onClick={() => changeLighting('product')}
        >
          <Lightbulb className="h-4 w-4 mr-2" />
          Product Lighting
        </Button>
      </div>
    </div>
  );
};

const Studio = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [isLive, setIsLive] = useState(false);
  
  const toggleRecording = () => setIsRecording(!isRecording);
  const toggleLive = () => setIsLive(!isLive);
  
  return (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <div className="container max-w-7xl p-6 space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Studio</h1>
          <p className="text-muted-foreground">
            Create, record, and stream professional automotive content
          </p>
        </div>
        
        <Tabs defaultValue="record">
          <TabsList className="mb-4">
            <TabsTrigger value="record">Record</TabsTrigger>
            <TabsTrigger value="stream">Stream</TabsTrigger>
            <TabsTrigger value="edit">Edit</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          
          <TabsContent value="record">
            <div className="grid gap-6 md:grid-cols-3">
              <div className="md:col-span-2">
                <Card className="border-2 border overflow-hidden p-0">
                  <StudioPreview />
                </Card>
                
                <div className="flex justify-center space-x-4 mt-4">
                  <Button
                    variant={isRecording ? "destructive" : "default"}
                    size="lg"
                    className="gap-2"
                    onClick={toggleRecording}
                  >
                    {isRecording ? (
                      <>
                        <PauseCircle className="h-5 w-5" />
                        Stop Recording
                      </>
                    ) : (
                      <>
                        <PlayCircle className="h-5 w-5" />
                        Start Recording
                      </>
                    )}
                  </Button>
                  
                  <Button variant="outline" size="lg" className="gap-2">
                    <Film className="h-5 w-5" />
                    Take Snapshot
                  </Button>
                </div>
              </div>
              
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Camera Settings</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm">Resolution</span>
                        <span className="text-sm font-medium">1080p</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm">Frame Rate</span>
                        <span className="text-sm font-medium">30 fps</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm">Format</span>
                        <span className="text-sm font-medium">MP4</span>
                      </div>
                      <Separator className="my-2" />
                      <Button variant="outline" size="sm" className="w-full">
                        <Settings className="h-4 w-4 mr-2" />
                        Advanced Settings
                      </Button>
                    </div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardHeader>
                    <CardTitle>Audio Settings</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm">Microphone</span>
                        <span className="text-sm font-medium">Default</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm">Input Level</span>
                        <span className="text-sm font-medium">-6dB</span>
                      </div>
                      <Separator className="my-2" />
                      <Button variant="outline" size="sm" className="w-full">
                        <Mic className="h-4 w-4 mr-2" />
                        Test Microphone
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="stream">
            <div className="grid gap-6 md:grid-cols-3">
              <div className="md:col-span-2">
                <Card className="border-2 border-dashed flex items-center justify-center aspect-video bg-muted/50">
                  <div className="text-center p-6">
                    <ScreenShare className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
                    <h3 className="font-medium mb-1">Live Stream Preview</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Your stream will appear here once you go live
                    </p>
                    <Button>Setup Stream</Button>
                  </div>
                </Card>
                
                <div className="flex justify-center space-x-4 mt-4">
                  <Button
                    variant={isLive ? "destructive" : "default"}
                    size="lg"
                    className="gap-2"
                    onClick={toggleLive}
                  >
                    {isLive ? (
                      <>
                        <PauseCircle className="h-5 w-5" />
                        End Stream
                      </>
                    ) : (
                      <>
                        <PlayCircle className="h-5 w-5" />
                        Go Live
                      </>
                    )}
                  </Button>
                  
                  <Button variant="outline" size="lg" className="gap-2">
                    <Share className="h-5 w-5" />
                    Share Stream
                  </Button>
                </div>
              </div>
              
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Stream Settings</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm">Platform</span>
                        <span className="text-sm font-medium">YouTube</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm">Quality</span>
                        <span className="text-sm font-medium">720p</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm">Bitrate</span>
                        <span className="text-sm font-medium">3500 kbps</span>
                      </div>
                      <Separator className="my-2" />
                      <Button variant="outline" size="sm" className="w-full">
                        <Settings className="h-4 w-4 mr-2" />
                        Stream Configuration
                      </Button>
                    </div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardHeader>
                    <CardTitle>Viewer Stats</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-center py-4">
                      <Users className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-3xl font-bold">0</p>
                      <p className="text-sm text-muted-foreground">Live Viewers</p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="edit">
            <Card>
              <CardContent className="pt-6">
                <div className="text-center p-10">
                  <Sliders className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
                  <h3 className="text-xl font-medium mb-2">Video Editor</h3>
                  <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                    Edit your recorded videos, add overlays, trim content, and prepare for publishing
                  </p>
                  <div className="flex justify-center gap-4">
                    <Button>Open Editor</Button>
                    <Button variant="outline">Recent Projects</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="settings">
            <Card>
              <CardContent className="pt-6">
                <div className="text-center p-10">
                  <Monitor className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
                  <h3 className="text-xl font-medium mb-2">Studio Configuration</h3>
                  <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                    Configure your workspace, cameras, lighting, and other studio equipment
                  </p>
                  <div className="flex justify-center gap-4">
                    <Button>Studio Setup</Button>
                    <Button variant="outline">Equipment Manager</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  );
};

export default Studio;
