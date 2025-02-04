import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";

export type CommandResult = {
  title: string;
  description: string;
  variant?: "default" | "destructive";
};

export type Command = {
  name: string;
  description: string;
  execute: (args: string[]) => Promise<CommandResult>;
};

const systemCommands: Record<string, Command> = {
  help: {
    name: "help",
    description: "Show available commands",
    execute: async () => ({
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
    }),
  },
  status: {
    name: "status",
    description: "Show system status",
    execute: async () => {
      const counts = await Promise.all([
        supabase.from('vehicles').select('*', { count: 'exact', head: true }),
        supabase.from('service_tickets').select('*', { count: 'exact', head: true }),
        supabase.from('inventory').select('*', { count: 'exact', head: true }),
      ]);
      
      return {
        title: "System Status",
        description: `
          Vehicles: ${counts[0].count}
          Tickets: ${counts[1].count}
          Inventory: ${counts[2].count}
          All systems operational
        `,
      };
    },
  },
  clear: {
    name: "clear",
    description: "Clear command",
    execute: async () => ({
      title: "Command cleared",
      description: "",
    }),
  },
  version: {
    name: "version",
    description: "Show system version",
    execute: async () => ({
      title: "System Version",
      description: "TAMS v1.0",
    }),
  },
};

const garageCommands: Record<string, Command> = {
  list: {
    name: "garage list",
    description: "List all garages",
    execute: async () => {
      const { data: garages } = await supabase
        .from('garages')
        .select('name')
        .limit(5);
      
      return {
        title: "Recent Garages",
        description: garages?.map(g => g.name).join("\n") || "No garages found",
      };
    },
  },
  count: {
    name: "garage count",
    description: "Show total garage count",
    execute: async () => {
      const { count } = await supabase
        .from('garages')
        .select('*', { count: 'exact', head: true });
      
      return {
        title: "Garage Count",
        description: `Total garages: ${count}`,
      };
    },
  },
};

const inventoryCommands: Record<string, Command> = {
  count: {
    name: "inv count",
    description: "Show total inventory count",
    execute: async () => {
      const { count } = await supabase
        .from('inventory')
        .select('*', { count: 'exact', head: true });
      
      return {
        title: "Inventory Count",
        description: `Total items: ${count}`,
      };
    },
  },
  search: {
    name: "inv search",
    description: "Search inventory",
    execute: async (args: string[]) => {
      if (!args[0]) {
        return {
          title: "Error",
          description: "Search term required",
          variant: "destructive",
        };
      }

      const { data: items } = await supabase
        .from('inventory')
        .select('name')
        .ilike('name', `%${args[0]}%`)
        .limit(5);
      
      return {
        title: "Inventory Search Results",
        description: items?.map(item => item.name).join("\n") || "No items found",
      };
    },
  },
};

const vehicleCommands: Record<string, Command> = {
  count: {
    name: "vehicle count",
    description: "Show total vehicle count",
    execute: async () => {
      const { count } = await supabase
        .from('vehicles')
        .select('*', { count: 'exact', head: true });
      
      return {
        title: "Vehicle Count",
        description: `Total vehicles: ${count}`,
      };
    },
  },
  search: {
    name: "vehicle search",
    description: "Search vehicles",
    execute: async (args: string[]) => {
      if (!args[0]) {
        return {
          title: "Error",
          description: "Search term required",
          variant: "destructive",
        };
      }

      const { data: vehicles } = await supabase
        .from('vehicles')
        .select('make, model, year')
        .or(`make.ilike.%${args[0]}%,model.ilike.%${args[0]}%`)
        .limit(5);
      
      return {
        title: "Vehicle Search Results",
        description: vehicles?.map(v => `${v.year} ${v.make} ${v.model}`).join("\n") || "No vehicles found",
      };
    },
  },
};

export const commands = {
  system: systemCommands,
  garage: garageCommands,
  inventory: inventoryCommands,
  vehicle: vehicleCommands,
};