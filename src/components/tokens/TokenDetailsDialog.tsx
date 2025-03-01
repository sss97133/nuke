
import { Token } from "@/types/token";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Copy, ExternalLink } from "lucide-react";
import { TokenAnalytics } from "@/components/terminal/panels/TokenAnalyticsPanel";
import { useToast } from "@/hooks/use-toast";

interface TokenDetailsDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  selectedToken: Token | null;
  onUpdateStatus: (id: string, status: string) => Promise<void>;
}

export const TokenDetailsDialog = ({ 
  isOpen, 
  onOpenChange, 
  selectedToken, 
  onUpdateStatus 
}: TokenDetailsDialogProps) => {
  const { toast } = useToast();

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

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied",
      description: "Copied to clipboard",
    });
  };

  if (!selectedToken) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center">
            {selectedToken.name}
            <span className="ml-2 text-sm text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              {selectedToken.symbol}
            </span>
            {selectedToken.status && (
              <Badge className={`ml-2 ${getStatusColor(selectedToken.status)}`} variant="outline">
                {selectedToken.status}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {selectedToken.description || "No description available"}
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
                <p className="font-medium">{selectedToken.total_supply.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Decimals</p>
                <p className="font-medium">{selectedToken.decimals}</p>
              </div>
              <div className="col-span-2">
                <p className="text-sm text-muted-foreground">Contract Address</p>
                <div className="font-medium break-all flex items-center gap-2">
                  <span>{selectedToken.contract_address || "N/A"}</span>
                  {selectedToken.contract_address && (
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
                <p className="font-medium">{selectedToken.created_at ? formatDate(selectedToken.created_at) : "N/A"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Last Updated</p>
                <p className="font-medium">{selectedToken.updated_at ? formatDate(selectedToken.updated_at) : "N/A"}</p>
              </div>
            </div>

            {selectedToken.metadata && Object.keys(selectedToken.metadata).length > 0 && (
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
                  checked={selectedToken.status === 'active'}
                  onCheckedChange={(checked) => {
                    onUpdateStatus(selectedToken.id, checked ? 'active' : 'inactive');
                  }}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                Toggle to activate or deactivate this token
              </p>
            </div>
            
            {selectedToken.contract_address && (
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
  );
};
