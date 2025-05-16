
import type { Database } from '../types';
import { useState, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { TokenHeader } from "@/components/tokens/TokenHeader";
import { TokenSearch } from "@/components/tokens/TokenSearch";
import { TokenList } from "@/components/tokens/TokenList";
import { TokenDetailsDialog } from "@/components/tokens/TokenDetailsDialog";
import { TokenFilterDialog } from "@/components/tokens/TokenFilterDialog";
import { TokenCreationWizard } from "@/components/tokens/wizard/TokenCreationWizard";
import { Token, NewToken } from "@/types/token";

const TokensPage = () => {
  console.log("Tokens page rendering");  // Debug log to verify component rendering
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

  useEffect(() => {
    console.log("Fetching tokens...");  // Debug log
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

      console.log("Fetched tokens:", data);  // Debug log to check data
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

  const handleCreateToken = async (newToken: NewToken) => {
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
          vehicle_id: newToken.vehicle_id,
        }])
        .select();

      if (error) throw error;

      toast({
        title: "Success",
        description: `Token ${newToken.name} created successfully`,
      });

      setIsCreateOpen(false);
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

  return (
    <ScrollArea className="h-[calc(100vh-4rem)] p-4">
      <div className="space-y-4">
        <TokenHeader 
          onRefresh={handleRefresh}
          onOpenFilter={() => setIsFilterOpen(true)}
          onOpenCreate={() => setIsCreateOpen(true)}
        />

        <TokenSearch 
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          sortField={sortField}
          setSortField={setSortField}
          sortDirection={sortDirection}
          toggleSortDirection={toggleSortDirection}
        />
        
        <TokenList 
          tokens={filteredTokens}
          isLoading={isLoading}
          searchQuery={searchQuery}
          handleTokenClick={handleTokenClick}
        />
      </div>

      <TokenDetailsDialog 
        isOpen={isDetailsOpen}
        onOpenChange={setIsDetailsOpen}
        selectedToken={selectedToken}
        onUpdateStatus={handleUpdateTokenStatus}
      />

      <TokenFilterDialog 
        isOpen={isFilterOpen}
        onOpenChange={setIsFilterOpen}
        showOnlyActive={showOnlyActive}
        setShowOnlyActive={setShowOnlyActive}
      />

      <TokenCreationWizard
        isOpen={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        onCreateToken={handleCreateToken}
      />
    </ScrollArea>
  );
};

export default TokensPage;
