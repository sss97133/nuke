
import { useState, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Award, MessageSquare, User, Users, Heart, ThumbsUp, Send, Camera, Mic, MicOff, Video, VideoOff, ScreenShare, Settings, Tool, Package, Tag } from "lucide-react";

interface StreamMetadata {
  title: string;
  description: string;
  category: string;
}

interface WorkstationItem {
  id: string;
  name: string;
  type: "tool" | "product" | "part";
  description: string;
  price: string;
  purchaseLink: string;
}

export const Streaming = () => {
  const [messages, setMessages] = useState<Array<{id: number, user: string, text: string, timestamp: string}>>([
    { id: 1, user: "TechSupport", text: "Welcome to the live stream! Ask questions about the repair process.", timestamp: "10:30 AM" },
    { id: 2, user: "Viewer1", text: "How often should this maintenance be performed?", timestamp: "10:32 AM" },
    { id: 3, user: "TechSupport", text: "Great question! For this model, every 10,000 miles is recommended.", timestamp: "10:33 AM" }
  ]);
  const [newMessage, setNewMessage] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [streamMetadata, setStreamMetadata] = useState<StreamMetadata>({
    title: "Professional Repair Demonstration",
    description: "Live tutorial on engine diagnostics",
    category: "Automotive"
  });
  const [workstationItems, setWorkstationItems] = useState<WorkstationItem[]>([
    {
      id: "1",
      name: "OBD-II Scanner Pro",
      type: "tool",
      description: "Professional diagnostic scanner for modern vehicles",
      price: "$129.99",
      purchaseLink: "https://example.com/obd-scanner"
    },
    {
      id: "2",
      name: "High-Performance Synthetic Oil",
      type: "product",
      description: "Full synthetic oil for maximum engine protection",
      price: "$49.99",
      purchaseLink: "https://example.com/synthetic-oil"
    },
    {
      id: "3",
      name: "Replacement Air Filter",
      type: "part",
      description: "Premium air filter for improved engine performance",
      price: "$24.99",
      purchaseLink: "https://example.com/air-filter"
    }
  ]);
  const { toast } = useToast();

  // Simulated AWS Rekognition data processing
  useEffect(() => {
    if (streaming) {
      // This would be an API call to your AWS Rekognition service in a real implementation
      // For demo purposes, we're simulating delayed data from recognition
      const timer = setTimeout(() => {
        // Simulating updated data based on video content recognition
        setStreamMetadata({
          title: "Engine Timing Belt Replacement Guide",
          description: "Step-by-step professional tutorial on replacing timing belts on 4-cylinder engines",
          category: "Automotive Repair"
        });

        // Simulating detected items in the workstation
        setWorkstationItems([
          {
            id: "1",
            name: "Timing Belt Tool Kit",
            type: "tool",
            description: "Complete professional timing belt replacement toolkit",
            price: "$89.99",
            purchaseLink: "https://example.com/timing-belt-kit"
          },
          {
            id: "2",
            name: "OEM Timing Belt",
            type: "part",
            description: "Original equipment manufacturer timing belt",
            price: "$45.99",
            purchaseLink: "https://example.com/timing-belt"
          },
          {
            id: "3",
            name: "Engine Degreaser",
            type: "product",
            description: "Professional-grade engine degreaser spray",
            price: "$12.99",
            purchaseLink: "https://example.com/degreaser"
          },
          {
            id: "4",
            name: "Torque Wrench",
            type: "tool",
            description: "Precision torque wrench for accurate bolt tightening",
            price: "$79.99",
            purchaseLink: "https://example.com/torque-wrench"
          }
        ]);

        toast({
          title: "Stream Analysis Complete",
          description: "Title, description, and workstation items have been updated based on video content.",
        });
      }, 5000); // Simulate a 5-second processing time

      return () => clearTimeout(timer);
    }
  }, [streaming, toast]);

  const sendMessage = () => {
    if (newMessage.trim()) {
      const newMsg = {
        id: messages.length + 1,
        user: "You",
        text: newMessage,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages([...messages, newMsg]);
      setNewMessage("");
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  };

  const toggleStreaming = () => {
    setStreaming(!streaming);
    toast({
      title: streaming ? "Stream Ended" : "Stream Started",
      description: streaming ? "Your stream has been ended successfully." : "You are now live! Viewers can join your stream.",
    });
  };

  const handleSponsor = () => {
    toast({
      title: "Sponsorship",
      description: "Thank you for sponsoring this stream! Your support helps create more content.",
    });
  };

  return (
    <ScrollArea className="h-[calc(100vh-4rem)] p-4">
      <div className="space-y-4 max-w-7xl mx-auto">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold">Streaming Studio</h1>
          <div className="flex items-center space-x-2">
            <Badge variant={streaming ? "destructive" : "default"} className="px-3 py-1">
              {streaming ? "LIVE" : "OFFLINE"}
            </Badge>
            <Button 
              variant={streaming ? "destructive" : "default"}
              onClick={toggleStreaming}
            >
              {streaming ? "End Stream" : "Go Live"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Main Stream View */}
          <div className="md:col-span-2 space-y-4">
            <Card className="overflow-hidden">
              <div className="bg-slate-900 aspect-video relative flex items-center justify-center">
                {streaming ? (
                  <>
                    <div className="absolute top-4 left-4 flex space-x-2 z-10">
                      <Badge className="bg-red-500 animate-pulse">LIVE</Badge>
                      <Badge className="bg-slate-800">
                        <Users className="h-3 w-3 mr-1" /> 24
                      </Badge>
                    </div>
                    <img 
                      src="https://images.unsplash.com/photo-1617886012304-427e3babf1a1?q=80&w=1920&auto=format&fit=crop" 
                      alt="Stream preview" 
                      className="w-full h-full object-cover"
                    />
                  </>
                ) : (
                  <div className="text-center text-white">
                    <Camera className="h-16 w-16 mx-auto mb-4 opacity-30" />
                    <p className="text-lg opacity-70">Stream preview will appear here</p>
                    <p className="text-sm opacity-50">Configure your settings and click "Go Live" to start</p>
                  </div>
                )}
              </div>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <Avatar>
                      <User className="h-6 w-6" />
                    </Avatar>
                    <div>
                      <CardTitle>{streamMetadata.title}</CardTitle>
                      <CardDescription>{streamMetadata.description}</CardDescription>
                      <div className="flex mt-1">
                        <Badge className="mr-2">{streamMetadata.category}</Badge>
                        {streaming && <Badge variant="outline" className="animate-pulse">Auto-updated by AI</Badge>}
                      </div>
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    <Button variant="outline" size="sm">
                      <ThumbsUp className="h-4 w-4 mr-1" /> 42
                    </Button>
                    {/* Sponsor button removed from here, moved to viewer section */}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex justify-center space-x-3">
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => setMicEnabled(!micEnabled)}
                  >
                    {micEnabled ? <Mic className="h-4 w-4 mr-1" /> : <MicOff className="h-4 w-4 mr-1" />}
                    {micEnabled ? "Mute" : "Unmute"}
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => setCameraEnabled(!cameraEnabled)}
                  >
                    {cameraEnabled ? <VideoOff className="h-4 w-4 mr-1" /> : <Video className="h-4 w-4 mr-1" />}
                    {cameraEnabled ? "Hide Camera" : "Show Camera"}
                  </Button>
                  <Button variant="outline" size="sm">
                    <ScreenShare className="h-4 w-4 mr-1" /> Share Screen
                  </Button>
                  <Button variant="outline" size="sm">
                    <Settings className="h-4 w-4 mr-1" /> Settings
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Workstation/Supply Section - New Component */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center">
                  <Tool className="h-5 w-5 mr-2" /> 
                  Workstation & Supplies
                  {streaming && <Badge variant="outline" className="ml-3 text-xs animate-pulse">Auto-detected</Badge>}
                </CardTitle>
                <CardDescription>
                  Tools, products, and parts detected in your stream
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {workstationItems.map(item => (
                    <div key={item.id} className="flex border rounded-lg p-3 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors">
                      <div className="mr-3 mt-1">
                        {item.type === "tool" && <Tool className="h-5 w-5 text-blue-500" />}
                        {item.type === "product" && <Package className="h-5 w-5 text-green-500" />}
                        {item.type === "part" && <Tag className="h-5 w-5 text-amber-500" />}
                      </div>
                      <div className="flex-1">
                        <div className="flex justify-between items-start">
                          <p className="font-medium">{item.name}</p>
                          <Badge variant="outline">{item.price}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{item.description}</p>
                        <Button variant="link" size="sm" className="px-0 h-6 mt-1" asChild>
                          <a href={item.purchaseLink} target="_blank" rel="noopener noreferrer">
                            Purchase Link
                          </a>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Achievement Tracking</CardTitle>
                <CardDescription>Skills demonstrated during this stream</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div className="flex items-center p-3 border rounded-lg">
                    <Award className="h-5 w-5 mr-3 text-amber-500" />
                    <div>
                      <p className="font-medium text-sm">Engine Diagnostics</p>
                      <p className="text-xs text-muted-foreground">Advanced - Level 3</p>
                    </div>
                  </div>
                  <div className="flex items-center p-3 border rounded-lg">
                    <Award className="h-5 w-5 mr-3 text-amber-500" />
                    <div>
                      <p className="font-medium text-sm">Code Reading</p>
                      <p className="text-xs text-muted-foreground">Expert - Level 4</p>
                    </div>
                  </div>
                  <div className="flex items-center p-3 border rounded-lg">
                    <Award className="h-5 w-5 mr-3 text-slate-400" />
                    <div>
                      <p className="font-medium text-sm">Part Replacement</p>
                      <p className="text-xs text-muted-foreground">Intermediate - Level 2</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Chat and Info Panel */}
          <div className="space-y-4">
            <Tabs defaultValue="chat">
              <TabsList className="w-full">
                <TabsTrigger value="chat" className="flex-1">
                  <MessageSquare className="h-4 w-4 mr-2" /> Chat
                </TabsTrigger>
                <TabsTrigger value="viewers" className="flex-1">
                  <Users className="h-4 w-4 mr-2" /> Viewers
                </TabsTrigger>
                <TabsTrigger value="info" className="flex-1">
                  <Award className="h-4 w-4 mr-2" /> Info
                </TabsTrigger>
              </TabsList>
              <TabsContent value="chat" className="mt-4">
                <Card className="h-[500px] flex flex-col">
                  <CardHeader className="px-4 py-2">
                    <CardTitle className="text-lg">Live Chat</CardTitle>
                  </CardHeader>
                  <CardContent className="flex-grow overflow-y-auto px-4 py-2">
                    <ScrollArea className="h-[350px] pr-4">
                      {messages.map((msg) => (
                        <div key={msg.id} className="mb-4">
                          <div className="flex items-start">
                            <div className="bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-2 w-full">
                              <div className="flex items-center mb-1">
                                <span className="font-bold text-sm">{msg.user}</span>
                                <span className="text-xs text-muted-foreground ml-auto">{msg.timestamp}</span>
                              </div>
                              <p className="text-sm">{msg.text}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </ScrollArea>
                  </CardContent>
                  <CardFooter className="border-t p-3">
                    <div className="flex w-full space-x-2">
                      <Input 
                        placeholder="Type a message..." 
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        onKeyDown={handleKeyPress}
                      />
                      <Button onClick={sendMessage} size="icon">
                        <Send className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardFooter>
                </Card>
              </TabsContent>
              <TabsContent value="viewers" className="mt-4">
                <Card className="h-[500px]">
                  <CardHeader>
                    <CardTitle>Active Viewers</CardTitle>
                    <CardDescription>24 people are currently watching</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[380px]">
                      <div className="space-y-4">
                        {["TechEnthusiast", "CarGuru", "DIYMechanic", "RepairPro", "EngineFan"].map((viewer, i) => (
                          <div key={i} className="flex items-center justify-between border-b pb-3">
                            <div className="flex items-center space-x-3">
                              <Avatar>
                                <User className="h-5 w-5" />
                              </Avatar>
                              <div>
                                <p className="text-sm font-medium">{viewer}</p>
                                <p className="text-xs text-muted-foreground">Watching for {10 + i} min</p>
                              </div>
                            </div>
                            <Badge variant="outline" className="flex items-center">
                              <Award className="h-3 w-3 mr-1" />
                              {["Expert", "Beginner", "Advanced", "Pro", "Enthusiast"][i]}
                            </Badge>
                          </div>
                        ))}
                      </div>

                      {/* Added viewer actions section with sponsor button */}
                      <div className="mt-6 pt-4 border-t">
                        <h3 className="text-sm font-semibold mb-3">Viewer Actions</h3>
                        <div className="flex space-x-2">
                          <Button variant="outline" size="sm" onClick={handleSponsor}>
                            <Heart className="h-4 w-4 mr-1" /> Sponsor
                          </Button>
                          <Button variant="outline" size="sm">
                            <ThumbsUp className="h-4 w-4 mr-1" /> Like
                          </Button>
                        </div>
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="info" className="mt-4">
                <Card className="h-[500px]">
                  <CardHeader>
                    <CardTitle>Stream Information</CardTitle>
                    <CardDescription>Details about this broadcast</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div>
                        <h3 className="text-sm font-semibold mb-1">Stream Title</h3>
                        <p className="text-sm">{streamMetadata.title}</p>
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold mb-1">Description</h3>
                        <p className="text-sm">{streamMetadata.description}</p>
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold mb-1">Category</h3>
                        <Badge>{streamMetadata.category}</Badge>
                        {streaming && (
                          <div className="mt-2 p-2 bg-slate-100 dark:bg-slate-800 rounded text-xs">
                            <p className="font-medium">AI-Generated Content</p>
                            <p className="mt-1 text-muted-foreground">
                              Stream title, description, and category are automatically generated based on AWS Rekognition analysis of the video content.
                            </p>
                          </div>
                        )}
                      </div>
                      <Separator />
                      <div>
                        <h3 className="text-sm font-semibold mb-1">Stream Quality</h3>
                        <p className="text-sm">1080p at 30fps</p>
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold mb-1">Started</h3>
                        <p className="text-sm">Today at 10:30 AM</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </ScrollArea>
  );
};

export default Streaming;
