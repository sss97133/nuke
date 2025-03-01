
import { useState, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Search, Info, ArrowUpDown, RefreshCw, Plus, Filter, Copy, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Json } from "@/integrations/supabase/types";
import { TokenAnalytics } from "@/components/terminal/panels/TokenAnalyticsPanel";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

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
  const [sortField, setSortField] = useState<"name" | "symbol" | "total_supply" | "created_at">("name");
  const [selectedToken, setSelectedToken] = useState<Token | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [showOnlyActive, setShowOnlyActive] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const { toast } = useToast();

  // Form state for new token
  const [newToken, setNewToken] = useState({
    name: "",
    symbol: "",
    total_supply: 0,
    decimals: 18,
    description: "",
    status: "active",
  });

  useEffect(() => {
    fetchTokens();
  }, []);

  useEffect(() => {
    // Filter tokens based on search query, status filter, and sort
    let filtered = tokens;
    
    // Search filter
    if (searchQuery) {
      filtered = filtered.filter(
        (token) =>
          token.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          token.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (token.contract_address && token.contract_address.toLowerCase().includes(searchQuery.toLowerCase()))
      );
    }
    
    // Status filter
    if (showOnlyActive) {
      filtered = filtered.filter(token => token.status === 'active');
    }

    // Sort tokens
    const sorted = [...filtered].sort((a, b) => {
      if (sortField === "name") {
        return sortDirection === "asc" 
          ? a.name.localeCompare(b.name) 
          : b.name.localeCompare(a.name);
      } else if (sortField === "symbol") {
        return sortDirection === "asc" 
          ? a.symbol.localeCompare(b.symbol) 
          : b.symbol.localeCompare(a.symbol);
      } else if (sortField === "total_supply") {
        return sortDirection === "asc" 
          ? a.total_supply - b.total_supply 
          : b.total_supply - a.total_supply;
      } else if (sortField === "created_at") {
        return sortDirection === "asc" 
          ? new Date(a.created_at).getTime() - new Date(b.created_at).getTime() 
          : new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      return 0;
    });

    setFilteredTokens(sorted);
  }, [tokens, searchQuery, sortDirection, sortField, showOnlyActive]);

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

  const handleCreateToken = async () => {
    try {
      // Validate form
      if (!newToken.name || !newToken.symbol || newToken.total_supply <= 0) {
        toast({
          title: "Validation Error",
          description: "Please fill all required fields correctly",
          variant: "destructive"
        });
        return;
      }

      const { data, error } = await supabase
        .from('tokens')
        .insert([{
          name: newToken.name,
          symbol: newToken.symbol.toUpperCase(),
          total_supply: newToken.total_supply,
          decimals: newToken.decimals,
          description: newToken.description,
          status: newToken.status,
        }])
        .select();

      if (error) throw error;

      toast({
        title: "Success",
        description: `Token ${newToken.name} created successfully`,
      });

      setIsCreateOpen(false);
      resetNewTokenForm();
      fetchTokens();
    } catch (error) {
      console.error('Error creating token:', error);
      toast({
        title: "Error",
        description: "Failed to create token",
        variant: "destructive"
      });
    }
  };

  const handleUpdateTokenStatus = async (id: string, newStatus: string) => {
    try {
      const { error } = await supabase
        .from('tokens')
        .update({ status: newStatus })
        .eq('id', id);

      if (error) throw error;

      setTokens(tokens.map(token => 
        token.id === id ? { ...token, status: newStatus } : token
      ));

      if (selectedToken && selectedToken.id === id) {
        setSelectedToken({ ...selectedToken, status: newStatus });
      }

      toast({
        title: "Status Updated",
        description: `Token status updated to ${newStatus}`,
      });
    } catch (error) {
      console.error('Error updating token status:', error);
      toast({
        title: "Error",
        description: "Failed to update token status",
        variant: "destructive"
      });
    }
  };

  const resetNewTokenForm = () => {
    setNewToken({
      name: "",
      symbol: "",
      total_supply: 0,
      decimals: 18,
      description: "",
      status: "active",
    });
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

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied",
      description: "Copied to clipboard",
    });
  };

  const formatContractAddress = (address: string | null) => {
    if (!address) return "N/A";
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'inactive':
        return 'bg-red-100 text-red-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <ScrollArea className="h-[calc(100vh-4rem)] p-4">
      <div className="space-y-4">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">Tokens</h1>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setIsFilterOpen(true)}>
              <Filter className="h-4 w-4 mr-1" />
              Filters
            </Button>
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
            <Button variant="default" size="sm" onClick={() => setIsCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Create Token
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
            <Select value={sortField} onValueChange={(value: any) => setSortField(value)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="symbol">Symbol</SelectItem>
                <SelectItem value="total_supply">Total Supply</SelectItem>
                <SelectItem value="created_at">Created Date</SelectItem>
              </SelectContent>
            </Select>
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
                      <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${getStatusColor(token.status)}`}>
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
              {selectedToken?.status && (
                <Badge className={`ml-2 ${getStatusColor(selectedToken.status)}`} variant="outline">
                  {selectedToken.status}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              {selectedToken?.description || "No description available"}
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="details">
            <TabsList className="w-full">
              <TabsTrigger value="details" className="flex-1">Details</TabsTrigger>
              <TabsTrigger value="analytics" className="flex-1">Analytics</TabsTrigger>
              <TabsTrigger value="actions" className="flex-1">Actions</TabsTrigger>
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
                <div className="col-span-2">
                  <p className="text-sm text-muted-foreground">Contract Address</p>
                  <div className="font-medium break-all flex items-center gap-2">
                    <span>{selectedToken?.contract_address || "N/A"}</span>
                    {selectedToken?.contract_address && (
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.stopPropagation();
                          copyToClipboard(selectedToken.contract_address);
                        }}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Created</p>
                  <p className="font-medium">{selectedToken?.created_at ? formatDate(selectedToken.created_at) : "N/A"}</p>
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
            <TabsContent value="actions" className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="token-status">Token Status</Label>
                <div className="flex items-center justify-between">
                  <span>Active</span>
                  <Switch 
                    id="token-status" 
                    checked={selectedToken?.status === 'active'}
                    onCheckedChange={(checked) => {
                      if (selectedToken) {
                        handleUpdateTokenStatus(selectedToken.id, checked ? 'active' : 'inactive');
                      }
                    }}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  Toggle to activate or deactivate this token
                </p>
              </div>
              
              {selectedToken?.contract_address && (
                <div className="space-y-2">
                  <Label>View on Explorer</Label>
                  <Button 
                    variant="outline" 
                    className="w-full flex justify-between"
                    onClick={() => window.open(`https://etherscan.io/token/${selectedToken.contract_address}`, '_blank')}
                  >
                    <span>View on Etherscan</span>
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Filter Dialog */}
      <Dialog open={isFilterOpen} onOpenChange={setIsFilterOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Filter Tokens</DialogTitle>
            <DialogDescription>
              Customize your token view with filters
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4 space-y-4">
            <div className="flex items-center space-x-2">
              <Switch
                id="active-only"
                checked={showOnlyActive}
                onCheckedChange={setShowOnlyActive}
              />
              <Label htmlFor="active-only">Show active tokens only</Label>
            </div>
          </div>
          
          <DialogFooter>
            <Button 
              variant="secondary" 
              onClick={() => {
                setShowOnlyActive(false);
                setIsFilterOpen(false);
              }}
            >
              Reset
            </Button>
            <Button onClick={() => setIsFilterOpen(false)}>Apply Filters</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Token Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={(open) => {
        setIsCreateOpen(open);
        if (!open) resetNewTokenForm();
      }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Create New Token</DialogTitle>
            <DialogDescription>
              Add a new token to your collection
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="token-name">Token Name</Label>
                <Input
                  id="token-name"
                  placeholder="Bitcoin"
                  value={newToken.name}
                  onChange={(e) => setNewToken({...newToken, name: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="token-symbol">Symbol</Label>
                <Input
                  id="token-symbol"
                  placeholder="BTC"
                  value={newToken.symbol}
                  onChange={(e) => setNewToken({...newToken, symbol: e.target.value})}
                />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="token-supply">Total Supply</Label>
                <Input
                  id="token-supply"
                  type="number"
                  placeholder="21000000"
                  value={newToken.total_supply || ''}
                  onChange={(e) => setNewToken({...newToken, total_supply: Number(e.target.value)})}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="token-decimals">Decimals</Label>
                <Input
                  id="token-decimals"
                  type="number"
                  placeholder="18"
                  value={newToken.decimals}
                  onChange={(e) => setNewToken({...newToken, decimals: Number(e.target.value)})}
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="token-description">Description</Label>
              <Input
                id="token-description"
                placeholder="Describe your token"
                value={newToken.description}
                onChange={(e) => setNewToken({...newToken, description: e.target.value})}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="token-status">Status</Label>
              <Select 
                value={newToken.status} 
                onValueChange={(value) => setNewToken({...newToken, status: value})}
              >
                <SelectTrigger id="token-status">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="secondary" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateToken}>Create Token</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ScrollArea>
  );
};

export default TokensPage;
