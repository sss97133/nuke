
import { useState } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { 
  Check, 
  ChevronRight, 
  LogIn, 
  User, 
  BrandTwitch, 
  Instagram, 
  Twitter, 
  Video, 
  Gamepad2,
  Camera
} from "lucide-react";

export interface StreamingServiceConfig {
  id: string;
  name: string;
  icon: React.ReactNode;
  active: boolean;
  streamKey?: string;
  username?: string;
  url?: string;
}

interface OnboardingWizardProps {
  onComplete: (services: StreamingServiceConfig[]) => void;
  onCancel: () => void;
}

export const OnboardingWizard = ({ onComplete, onCancel }: OnboardingWizardProps) => {
  const [step, setStep] = useState<'login' | 'services' | 'config'>('login');
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [services, setServices] = useState<StreamingServiceConfig[]>([
    { id: "twitch", name: "Twitch", icon: <BrandTwitch className="h-5 w-5 text-purple-500" />, active: false },
    { id: "instagram", name: "Instagram", icon: <Instagram className="h-5 w-5 text-pink-500" />, active: false },
    { id: "twitter", name: "X / Twitter", icon: <Twitter className="h-5 w-5 text-blue-400" />, active: false },
    { id: "rtmp", name: "RTMP Server", icon: <Video className="h-5 w-5 text-red-500" />, active: false },
    { id: "gopro", name: "GoPro", icon: <Camera className="h-5 w-5 text-slate-500" />, active: false },
    { id: "gaming", name: "Gaming Console", icon: <Gamepad2 className="h-5 w-5 text-green-500" />, active: false },
  ]);
  const { toast } = useToast();
  const { handleEmailLogin, isLoading } = useAuth();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await handleEmailLogin(email, password, false);
      toast({
        title: "Login Successful",
        description: "You've been logged in successfully!",
      });
      setStep('services');
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Login Failed",
        description: "Please check your credentials and try again.",
      });
    }
  };

  const handleServiceToggle = (id: string) => {
    setServices(prev => 
      prev.map(service => 
        service.id === id ? { ...service, active: !service.active } : service
      )
    );
  };

  const handleConfigureServices = () => {
    const activeServices = services.filter(s => s.active);
    if (activeServices.length === 0) {
      toast({
        variant: "destructive",
        title: "No services selected",
        description: "Please select at least one streaming service.",
      });
      return;
    }
    setStep('config');
  };

  const handleServiceConfigChange = (id: string, field: 'streamKey' | 'username' | 'url', value: string) => {
    setServices(prev => 
      prev.map(service => 
        service.id === id ? { ...service, [field]: value } : service
      )
    );
  };

  const handleFinish = () => {
    const activeServices = services.filter(s => s.active);
    onComplete(activeServices);
    
    toast({
      title: "Setup Complete",
      description: `You're now set up to stream to ${activeServices.length} platform${activeServices.length !== 1 ? 's' : ''}.`,
    });
  };

  return (
    <Card className="w-full max-w-2xl mx-auto shadow-lg">
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle>Streaming Setup Wizard</CardTitle>
          <div className="flex space-x-1">
            <Badge variant={step === 'login' ? "default" : "outline"}>1. Login</Badge>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            <Badge variant={step === 'services' ? "default" : "outline"}>2. Services</Badge>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            <Badge variant={step === 'config' ? "default" : "outline"}>3. Configure</Badge>
          </div>
        </div>
        <CardDescription>
          Set up your streaming destinations and configurations
        </CardDescription>
      </CardHeader>
      <CardContent>
        {step === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input 
                id="email" 
                type="email" 
                placeholder="Your email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input 
                id="password" 
                type="password" 
                placeholder="Your password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              <LogIn className="h-4 w-4 mr-2" />
              {isLoading ? "Logging in..." : "Login"}
            </Button>
          </form>
        )}

        {step === 'services' && (
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Select Streaming Services</h3>
            <div className="grid grid-cols-2 gap-3">
              {services.map((service) => (
                <div 
                  key={service.id}
                  className={`p-3 border rounded-md cursor-pointer transition-colors ${
                    service.active ? 'bg-primary/10 border-primary' : 'hover:bg-muted'
                  }`}
                  onClick={() => handleServiceToggle(service.id)}
                >
                  <div className="flex items-center space-x-3">
                    {service.icon}
                    <span className="font-medium">{service.name}</span>
                    {service.active && <Check className="h-4 w-4 ml-auto text-primary" />}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 'config' && (
          <div className="space-y-6">
            <Tabs defaultValue={services.find(s => s.active)?.id || ''}>
              <TabsList className="w-full h-auto flex-wrap">
                {services.filter(s => s.active).map((service) => (
                  <TabsTrigger key={service.id} value={service.id} className="flex items-center">
                    {service.icon}
                    <span className="ml-2">{service.name}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
              
              {services.filter(s => s.active).map((service) => (
                <TabsContent key={service.id} value={service.id} className="space-y-4 pt-4">
                  <h3 className="font-semibold flex items-center">
                    {service.icon}
                    <span className="ml-2">{service.name} Configuration</span>
                  </h3>
                  
                  <div className="space-y-3">
                    {service.id === 'rtmp' && (
                      <div className="space-y-2">
                        <Label htmlFor={`${service.id}-url`}>RTMP URL</Label>
                        <Input 
                          id={`${service.id}-url`}
                          placeholder="rtmp://your-rtmp-server/live"
                          value={service.url || ''}
                          onChange={(e) => handleServiceConfigChange(service.id, 'url', e.target.value)}
                        />
                      </div>
                    )}
                    
                    {(service.id === 'twitch' || service.id === 'rtmp') && (
                      <div className="space-y-2">
                        <Label htmlFor={`${service.id}-key`}>Stream Key</Label>
                        <Input 
                          id={`${service.id}-key`}
                          type="password"
                          placeholder="Your stream key"
                          value={service.streamKey || ''}
                          onChange={(e) => handleServiceConfigChange(service.id, 'streamKey', e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">Never share your stream key with anyone.</p>
                      </div>
                    )}
                    
                    {(service.id === 'instagram' || service.id === 'twitter') && (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor={`${service.id}-username`}>Username</Label>
                          <Input 
                            id={`${service.id}-username`}
                            placeholder={`Your ${service.name} username`}
                            value={service.username || ''}
                            onChange={(e) => handleServiceConfigChange(service.id, 'username', e.target.value)}
                          />
                        </div>
                        <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-md">
                          <h4 className="text-sm font-medium mb-1">Authorization Required</h4>
                          <p className="text-xs text-muted-foreground mb-2">
                            You'll need to authorize this app to stream to your {service.name} account.
                          </p>
                          <Button size="sm" variant="outline">
                            Connect {service.name} Account
                          </Button>
                        </div>
                      </>
                    )}
                    
                    {(service.id === 'gopro') && (
                      <div className="space-y-2">
                        <Label htmlFor={`${service.id}-url`}>GoPro IP Address</Label>
                        <Input 
                          id={`${service.id}-url`}
                          placeholder="10.5.5.9:8080"
                          value={service.url || ''}
                          onChange={(e) => handleServiceConfigChange(service.id, 'url', e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                          Connect to your GoPro's WiFi network first, then enter the camera's IP.
                        </p>
                      </div>
                    )}
                    
                    {(service.id === 'gaming') && (
                      <div className="space-y-3">
                        <div className="space-y-2">
                          <Label htmlFor="capture-device">Capture Device</Label>
                          <select 
                            id="capture-device"
                            className="w-full rounded-md border border-input px-3 py-2 bg-background text-sm"
                          >
                            <option value="">Select a capture device</option>
                            <option value="elgato">Elgato HD60 S</option>
                            <option value="avermedia">AVerMedia Live Gamer</option>
                            <option value="other">Other Device</option>
                          </select>
                        </div>
                        <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-md">
                          <p className="text-xs text-muted-foreground">
                            Make sure your capture card is connected before starting the stream.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <Separator className="my-2" />
                  
                  <div className="text-xs text-muted-foreground">
                    <p>Setup tips:</p>
                    <ul className="list-disc pl-4 mt-1 space-y-1">
                      <li>Test your stream with a short private broadcast before going live</li>
                      <li>Check your bandwidth and ensure stable internet connection</li>
                      <li>Recommended settings: 720p/60fps or 1080p/30fps for most platforms</li>
                    </ul>
                  </div>
                </TabsContent>
              ))}
            </Tabs>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-between">
        {step === 'login' ? (
          <Button variant="ghost" onClick={onCancel}>
            Skip for now
          </Button>
        ) : (
          <Button variant="outline" onClick={() => setStep(step === 'config' ? 'services' : 'login')}>
            Back
          </Button>
        )}
        
        {step === 'login' ? (
          <Button variant="outline" onClick={() => setStep('services')}>
            Continue as Guest
          </Button>
        ) : step === 'services' ? (
          <Button onClick={handleConfigureServices}>
            Configure Selected Services
          </Button>
        ) : (
          <Button onClick={handleFinish}>
            Finish Setup
          </Button>
        )}
      </CardFooter>
    </Card>
  );
};
