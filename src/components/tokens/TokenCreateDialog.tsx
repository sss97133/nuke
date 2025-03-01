
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface TokenCreateDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateToken: (token: NewToken) => Promise<void>;
}

interface NewToken {
  name: string;
  symbol: string;
  total_supply: number;
  decimals: number;
  description: string;
  status: string;
}

export const TokenCreateDialog = ({ isOpen, onOpenChange, onCreateToken }: TokenCreateDialogProps) => {
  const [newToken, setNewToken] = useState<NewToken>({
    name: "",
    symbol: "",
    total_supply: 0,
    decimals: 18,
    description: "",
    status: "active",
  });

  const resetForm = () => {
    setNewToken({
      name: "",
      symbol: "",
      total_supply: 0,
      decimals: 18,
      description: "",
      status: "active",
    });
  };

  const handleSubmit = async () => {
    await onCreateToken(newToken);
    resetForm();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      onOpenChange(open);
      if (!open) resetForm();
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
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit}>Create Token</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
