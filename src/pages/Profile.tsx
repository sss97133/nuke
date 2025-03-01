
import { ScrollArea } from "@/components/ui/scroll-area";
import UserProfile from "@/components/profile/UserProfile";

export const Profile = () => {
  return (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <div className="container mx-auto py-6 px-4 md:px-6 max-w-6xl">
        <UserProfile />
      </div>
    </ScrollArea>
  );
};

export default Profile;
