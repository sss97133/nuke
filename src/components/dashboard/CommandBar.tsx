import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useToast } from "@/components/ui/use-toast";

export const CommandBar = () => {
  const [command, setCommand] = useState("");
  const { toast } = useToast();

  const executeCommand = () => {
    const cmd = command.toLowerCase().trim();
    
    switch (cmd) {
      case "help":
        toast({
          title: "Available Commands",
          description: "help: Show this message\nstatus: Show system status\nclear: Clear command\nversion: Show system version",
        });
        break;
      case "status":
        toast({
          title: "System Status",
          description: "All systems operational",
        });
        break;
      case "clear":
        setCommand("");
        toast({
          title: "Command cleared",
        });
        break;
      case "version":
        toast({
          title: "System Version",
          description: "TAMS v1.0",
        });
        break;
      default:
        toast({
          title: "Unknown Command",
          description: "Type 'help' for available commands",
          variant: "destructive",
        });
    }
    
    setCommand("");
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      executeCommand();
    }
  };

  return (
    <div className="border border-gov-blue p-2 col-span-full">
      <div className="flex gap-2 items-center">
        <span className="text-tiny text-[#666]">CMD:</span>
        <Input
          placeholder="ENTER_COMMAND"
          className="h-7 text-tiny bg-white font-mono"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyPress={handleKeyPress}
        />
        <Button
          size="sm"
          className="h-7 bg-[#283845] hover:bg-[#1a2830] text-white text-tiny"
          onClick={executeCommand}
        >
          EXEC
        </Button>
      </div>
    </div>
  );
};