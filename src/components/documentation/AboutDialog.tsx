
import React from "react";
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Atom, Github, ExternalLink } from "lucide-react";
import packageJson from "../../../package.json";

interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const AboutDialog = ({ open, onOpenChange }: AboutDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px] max-h-[90vh]">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <Atom className="h-6 w-6 text-red-500" />
            <DialogTitle className="text-2xl">About NUKE</DialogTitle>
          </div>
          <DialogDescription>
            System information and application details
          </DialogDescription>
        </DialogHeader>
        
        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold">Application</h3>
              <p className="text-sm text-muted-foreground mb-2">Core application details</p>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="font-medium">Version</div>
                <div className="col-span-2">{packageJson.version || '1.0.0'}</div>
                
                <div className="font-medium">Build Date</div>
                <div className="col-span-2">{new Date().toLocaleDateString()}</div>
                
                <div className="font-medium">License</div>
                <div className="col-span-2">MIT</div>
              </div>
            </div>
            
            <Separator />
            
            <div>
              <h3 className="text-lg font-semibold">Technologies</h3>
              <p className="text-sm text-muted-foreground mb-2">Core frameworks and libraries</p>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="font-medium">React</div>
                <div className="col-span-2">{packageJson.dependencies.react || 'Latest'}</div>
                
                <div className="font-medium">Tailwind CSS</div>
                <div className="col-span-2">Latest</div>
                
                <div className="font-medium">TypeScript</div>
                <div className="col-span-2">Latest</div>
                
                <div className="font-medium">Supabase</div>
                <div className="col-span-2">{packageJson.dependencies["@supabase/supabase-js"] || 'Latest'}</div>
              </div>
            </div>
            
            <Separator />
            
            <div>
              <h3 className="text-lg font-semibold">Team</h3>
              <p className="text-sm text-muted-foreground mb-2">The people who built this</p>
              <div className="space-y-3">
                <div className="bg-secondary p-3 rounded-md">
                  <p className="font-semibold">Lead Developer</p>
                  <p className="text-sm text-muted-foreground">John Doe</p>
                </div>
                <div className="bg-secondary p-3 rounded-md">
                  <p className="font-semibold">UI/UX Designer</p>
                  <p className="text-sm text-muted-foreground">Jane Smith</p>
                </div>
                <div className="bg-secondary p-3 rounded-md">
                  <p className="font-semibold">Project Manager</p>
                  <p className="text-sm text-muted-foreground">Alex Johnson</p>
                </div>
              </div>
            </div>
            
            <Separator />
            
            <div>
              <h3 className="text-lg font-semibold">Support</h3>
              <p className="text-sm text-muted-foreground mb-2">Get help and provide feedback</p>
              <div className="flex flex-col gap-2">
                <Button variant="outline" className="justify-start">
                  <Github className="mr-2 h-4 w-4" />
                  Report an issue on GitHub
                </Button>
                <Button variant="outline" className="justify-start">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Documentation
                </Button>
              </div>
            </div>
          </div>
        </ScrollArea>
        
        <div className="flex justify-end mt-4">
          <Button onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
