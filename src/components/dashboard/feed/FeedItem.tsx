import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { FeedItemIcon } from "./FeedItemIcon";

interface FeedItemProfile {
  username: string | null;
  avatar_url: string | null;
}

interface FeedItemProps {
  id: string;
  content: string;
  itemType: string;
  createdAt: string;
  profile: FeedItemProfile | null;
  selected: boolean;
  onSelect: (id: string) => void;
  children?: React.ReactNode;
}

export const FeedItem = ({
  id,
  content,
  itemType,
  createdAt,
  profile,
  selected,
  onSelect,
  children
}: FeedItemProps) => {
  return (
    <div
      className="rounded-lg border bg-card text-card-foreground shadow-sm"
      onClick={() => onSelect(id)}
    >
      <div className="flex items-center justify-between text-sm p-2 hover:bg-accent/50 rounded-md transition-colors">
        <div className="flex items-center gap-3">
          <Avatar className="w-8 h-8">
            <AvatarImage src={profile?.avatar_url || undefined} alt={profile?.username || undefined} />
            <AvatarFallback>{profile?.username?.slice(0, 2).toUpperCase() || 'AN'}</AvatarFallback>
          </Avatar>
          <div>
            <div className="flex items-center gap-2">
              <FeedItemIcon type={itemType} />
              <span className="font-medium">{profile?.username || 'Anonymous'}</span>
            </div>
            <p className="text-muted-foreground">{content}</p>
            <span className="text-xs text-muted-foreground">
              {new Date(createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>
      </div>

      {selected && children}
    </div>
  );
};