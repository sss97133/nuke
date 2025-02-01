import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";

export const CommandBar = () => {
  const [command, setCommand] = useState("");
  const { toast } = useToast();

  const executeCommand = async () => {
    const [cmd, ...args] = command.toLowerCase().trim().split(" ");
    
    try {
      switch (cmd) {
        case "help":
          toast({
            title: "Available Commands",
            description: [
              "System:",
              "• help - Show this message",
              "• status - Show system status",
              "• clear - Clear command",
              "• version - Show system version",
              "",
              "Garage:",
              "• garage list - List all garages",
              "• garage count - Show total garage count",
              "",
              "Inventory:",
              "• inv count - Show total inventory count",
              "• inv search <term> - Search inventory",
              "",
              "Service:",
              "• ticket list - List recent tickets",
              "• ticket count - Show total tickets",
              "",
              "Vehicle:",
              "• vehicle count - Show total vehicles",
              "• vehicle search <term> - Search vehicles"
            ].join("\n"),
          });
          break;

        case "garage":
          if (args[0] === "list") {
            const { data: garages } = await supabase
              .from('garages')
              .select('name')
              .limit(5);
            
            toast({
              title: "Recent Garages",
              description: garages?.map(g => g.name).join("\n") || "No garages found",
            });
          } else if (args[0] === "count") {
            const { count } = await supabase
              .from('garages')
              .select('*', { count: 'exact', head: true });
            
            toast({
              title: "Garage Count",
              description: `Total garages: ${count}`,
            });
          }
          break;

        case "inv":
          if (args[0] === "count") {
            const { count } = await supabase
              .from('inventory')
              .select('*', { count: 'exact', head: true });
            
            toast({
              title: "Inventory Count",
              description: `Total items: ${count}`,
            });
          } else if (args[0] === "search" && args[1]) {
            const { data: items } = await supabase
              .from('inventory')
              .select('name')
              .ilike('name', `%${args[1]}%`)
              .limit(5);
            
            toast({
              title: "Inventory Search Results",
              description: items?.map(item => item.name).join("\n") || "No items found",
            });
          }
          break;

        case "ticket":
          if (args[0] === "list") {
            const { data: tickets } = await supabase
              .from('service_tickets')
              .select('description, status')
              .limit(5);
            
            toast({
              title: "Recent Tickets",
              description: tickets?.map(t => `${t.description} (${t.status})`).join("\n") || "No tickets found",
            });
          } else if (args[0] === "count") {
            const { count } = await supabase
              .from('service_tickets')
              .select('*', { count: 'exact', head: true });
            
            toast({
              title: "Service Ticket Count",
              description: `Total tickets: ${count}`,
            });
          }
          break;

        case "vehicle":
          if (args[0] === "count") {
            const { count } = await supabase
              .from('vehicles')
              .select('*', { count: 'exact', head: true });
            
            toast({
              title: "Vehicle Count",
              description: `Total vehicles: ${count}`,
            });
          } else if (args[0] === "search" && args[1]) {
            const { data: vehicles } = await supabase
              .from('vehicles')
              .select('make, model, year')
              .or(`make.ilike.%${args[1]}%,model.ilike.%${args[1]}%`)
              .limit(5);
            
            toast({
              title: "Vehicle Search Results",
              description: vehicles?.map(v => `${v.year} ${v.make} ${v.model}`).join("\n") || "No vehicles found",
            });
          }
          break;

        case "status":
          const counts = await Promise.all([
            supabase.from('vehicles').select('*', { count: 'exact', head: true }),
            supabase.from('service_tickets').select('*', { count: 'exact', head: true }),
            supabase.from('inventory').select('*', { count: 'exact', head: true }),
          ]);
          
          toast({
            title: "System Status",
            description: `
              Vehicles: ${counts[0].count}
              Tickets: ${counts[1].count}
              Inventory: ${counts[2].count}
              All systems operational
            `,
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
    } catch (error) {
      console.error('Command execution error:', error);
      toast({
        title: "Command Error",
        description: "An error occurred while executing the command",
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
