
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Json } from "@/integrations/supabase/types";

interface Token {
  id: string;
  name: string;
  symbol: string;
  total_supply: number;
  metadata: Json;
  contract_address: string;
  created_at: string;
  decimals: number;
  description: string;
  owner_id: string;
  status: string;
  updated_at: string;
}

export const TokensPage = () => {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    const fetchTokens = async () => {
      try {
        const { data, error } = await supabase
          .from('tokens')
          .select('*');

        if (error) throw error;

        setTokens(data || []);
      } catch (error) {
        console.error('Error fetching tokens:', error);
        toast({
          title: "Error",
          description: "Failed to load tokens",
          variant: "destructive"
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchTokens();
  }, []);

  if (isLoading) {
    return (
      <div className="p-4">
        <p>Loading tokens...</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[calc(100vh-4rem)] p-4">
      <div className="space-y-4">
        <h1 className="text-2xl font-bold mb-4">Tokens</h1>
        
        {tokens.length === 0 ? (
          <Card className="p-4">
            <p className="text-muted-foreground">No tokens found</p>
          </Card>
        ) : (
          tokens.map((token) => (
            <Card key={token.id} className="p-4">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-xl font-semibold">{token.name}</h2>
                  <p className="text-sm text-muted-foreground">Symbol: {token.symbol}</p>
                  <p className="mt-2">Total Supply: {token.total_supply.toLocaleString()}</p>
                </div>
                <div className="flex gap-2">
                  {/* Add token action buttons here when needed */}
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </ScrollArea>
  );
};

export default TokensPage;
