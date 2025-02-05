import { FeedInteraction } from "@/types/feed";

interface FeedInteractionsProps {
  interactions: FeedInteraction[];
}

export const FeedInteractions = ({ interactions }: FeedInteractionsProps) => {
  return (
    <div className="border-t p-2 space-y-2">
      {interactions.map((interaction) => (
        <div key={interaction.id} className="text-sm pl-12">
          <p className="text-muted-foreground">{interaction.content}</p>
          <span className="text-xs text-muted-foreground">
            {new Date(interaction.created_at).toLocaleDateString()}
          </span>
        </div>
      ))}
    </div>
  );
};