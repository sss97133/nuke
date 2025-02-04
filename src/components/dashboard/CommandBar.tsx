import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useToast } from "@/components/ui/use-toast";
import { commands } from "@/utils/commands";

export const CommandBar = () => {
  const [command, setCommand] = useState("");
  const { toast } = useToast();

  const executeCommand = async () => {
    const parts = command.toLowerCase().trim().split(" ");
    const cmd = parts[0];
    const subCmd = parts[1];
    const args = parts.slice(2);
    
    try {
      let result;

      if (cmd === "help" || cmd === "status" || cmd === "clear" || cmd === "version") {
        result = await commands.system[cmd].execute(args);
      } else if (cmd === "garage" && commands.garage[subCmd]) {
        result = await commands.garage[subCmd].execute(args);
      } else if (cmd === "inv" && commands.inventory[subCmd]) {
        result = await commands.inventory[subCmd].execute(args);
      } else if (cmd === "vehicle" && commands.vehicle[subCmd]) {
        result = await commands.vehicle[subCmd].execute(args);
      } else {
        result = {
          title: "Unknown Command",
          description: "Type 'help' for available commands",
          variant: "destructive",
        };
      }

      toast(result);
    } catch (error) {
      console.error('Command execution error:', error);
      toast({
        title: "Command Error",
        description: "An error occurred while executing the command",
        variant: "destructive",
      });
    }
    
    if (cmd === "clear") {
      setCommand("");
    }
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