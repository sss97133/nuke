
import { NewToken } from "@/types/token";
import { Card, CardContent } from "@/components/ui/card";

interface ReviewStepProps {
  token: NewToken;
}

const ReviewStep = ({ token }: ReviewStepProps) => {
  return (
    <div className="space-y-4 py-2">
      <p className="text-sm text-muted-foreground mb-4">
        Please review your token details before creating. Make sure all information is correct.
      </p>
      
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h3 className="text-sm font-medium text-muted-foreground">Token Name</h3>
              <p className="font-semibold">{token.name}</p>
            </div>
            
            <div>
              <h3 className="text-sm font-medium text-muted-foreground">Symbol</h3>
              <p className="font-semibold">{token.symbol}</p>
            </div>
            
            <div>
              <h3 className="text-sm font-medium text-muted-foreground">Total Supply</h3>
              <p className="font-semibold">{token.total_supply.toLocaleString()}</p>
            </div>
            
            <div>
              <h3 className="text-sm font-medium text-muted-foreground">Decimals</h3>
              <p className="font-semibold">{token.decimals}</p>
            </div>
            
            <div className="col-span-2">
              <h3 className="text-sm font-medium text-muted-foreground">Status</h3>
              <p className="font-semibold capitalize">{token.status}</p>
            </div>
            
            <div className="col-span-2">
              <h3 className="text-sm font-medium text-muted-foreground">Description</h3>
              <p className="text-sm">
                {token.description || "No description provided"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ReviewStep;
