
import { useState, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Search, Info, ArrowUpDown, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Json } from "@/integrations/supabase/types";
import { TokenAnalytics } from "@/components/terminal/panels/TokenAnalyticsPanel";

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
  const [filteredTokens, setFilteredTokens] = useState<Token[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [selectedToken, setSelectedToken] = useState<Token | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchTokens();
  }, []);

  useEffect(() => {
    // Filter and sort tokens when search query or tokens change
    const filtered = tokens.filter(
      (token) =>
        token.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        token.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (token.contract_address && token.contract_address.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    const sorted = [...filtered].sort((a, b) => {
      if (sortDirection === "asc") {
        return a.name.localeCompare(b.name);
      } else {
        return b.name.localeCompare(a.name);
      }
    });

    setFilteredTokens(sorted);
  }, [tokens, searchQuery, sortDirection]);

  const fetchTokens = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('tokens')
        .select('*');

      if (error) throw error;

      setTokens(data || []);
      setFilteredTokens(data || []);
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

  const toggleSortDirection = () => {
    setSortDirection(sortDirection === "asc" ? "desc" : "asc");
  };

  const handleRefresh = () => {
    fetchTokens();
    toast({
      title: "Refreshed",
      description: "Token list has been refreshed",
    });
  };

  const handleTokenClick = (token: Token) => {
    setSelectedToken(token);
    setIsDetailsOpen(true);
  };

  const formatContractAddress = (address: string | null) => {
    if (!address) return "N/A";
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  return (
    <ScrollArea className="h-[calc(100vh-4rem)] p-4">
      <div className="space-y-4">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">Tokens</h1>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
          </div>
        </div>

        <Card className="p-4 mb-4">
          <div className="flex gap-2 items-center">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search tokens by name, symbol or address..."
                className="pl-8"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Button variant="outline" size="icon" onClick={toggleSortDirection} title={`Sort ${sortDirection === "asc" ? "descending" : "ascending"}`}>
              <ArrowUpDown className="h-4 w-4" />
            </Button>
          </div>
        </Card>
        
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="p-4 bg-muted/50">
                <div className="animate-pulse flex justify-between">
                  <div className="space-y-2">
                    <div className="h-4 w-40 bg-muted rounded"></div>
                    <div className="h-3 w-20 bg-muted rounded"></div>
                  </div>
                  <div className="h-4 w-32 bg-muted rounded"></div>
                </div>
              </Card>
            ))}
          </div>
        ) : filteredTokens.length === 0 ? (
          <Card className="p-4">
            {searchQuery ? (
              <p className="text-muted-foreground">No tokens found matching "{searchQuery}"</p>
            ) : (
              <p className="text-muted-foreground">No tokens found</p>
            )}
          </Card>
        ) : (
          filteredTokens.map((token) => (
            <Card 
              key={token.id} 
              className="p-4 hover:bg-muted/10 transition-colors cursor-pointer"
              onClick={() => handleTokenClick(token)}
            >
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center">
                    <h2 className="text-xl font-semibold">{token.name}</h2>
                    <span className="ml-2 text-sm text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">
                      {token.symbol}
                    </span>
                    {token.status && (
                      <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                        token.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}>
                        {token.status}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Contract: {formatContractAddress(token.contract_address)}
                  </p>
                  <p className="mt-2">
                    <span className="font-medium">Total Supply:</span> {token.total_supply.toLocaleString()}
                  </p>
                  {token.created_at && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Created: {formatDate(token.created_at)}
                    </p>
                  )}
                </div>
                <Button variant="ghost" size="icon">
                  <Info className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>

      {/* Token Details Dialog */}
      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="flex items-center">
              {selectedToken?.name}
              <span className="ml-2 text-sm text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                {selectedToken?.symbol}
              </span>
            </DialogTitle>
            <DialogDescription>
              {selectedToken?.description || "No description available"}
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="details">
            <TabsList className="w-full">
              <TabsTrigger value="details" className="flex-1">Details</TabsTrigger>
              <TabsTrigger value="analytics" className="flex-1">Analytics</TabsTrigger>
            </TabsList>
            <TabsContent value="details" className="space-y-3 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Total Supply</p>
                  <p className="font-medium">{selectedToken?.total_supply.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Decimals</p>
                  <p className="font-medium">{selectedToken?.decimals}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Contract Address</p>
                  <p className="font-medium break-all">{selectedToken?.contract_address || "N/A"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Created</p>
                  <p className="font-medium">{selectedToken?.created_at ? formatDate(selectedToken.created_at) : "N/A"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <p className="font-medium">{selectedToken?.status || "N/A"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Last Updated</p>
                  <p className="font-medium">{selectedToken?.updated_at ? formatDate(selectedToken.updated_at) : "N/A"}</p>
                </div>
              </div>

              {selectedToken?.metadata && Object.keys(selectedToken.metadata).length > 0 && (
                <div className="mt-4">
                  <h3 className="text-sm font-medium mb-2">Additional Metadata</h3>
                  <pre className="bg-muted p-2 rounded-md text-xs overflow-auto">
                    {JSON.stringify(selectedToken.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </TabsContent>
            <TabsContent value="analytics">
              <TokenAnalytics />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </ScrollArea>
  );
};

export default TokensPage;
