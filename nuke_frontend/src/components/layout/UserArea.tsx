import React from 'react';

interface UserAreaProps {
  session: any;
  userProfile: any;
  unreadCount: number;
  onClick: () => void;
}

export const UserArea: React.FC<UserAreaProps> = ({
  session,
  userProfile,
  unreadCount,
  onClick,
}) => {
  return (
    <button
      className="user-area"
      onClick={onClick}
      type="button"
      aria-label="User menu"
      aria-haspopup="true"
    >
      <div className="user-area-avatar">
        {userProfile?.avatar_url ? (
          <img
            src={userProfile.avatar_url}
            alt=""
            className="user-area-avatar-img"
          />
        ) : (
          <span className="user-area-avatar-fallback">
            {session?.user?.email?.[0]?.toUpperCase() || 'U'}
          </span>
        )}
        {unreadCount > 0 && (
          <span className="user-area-badge" aria-label={`${unreadCount} notifications`} />
        )}
      </div>
    </button>
  );
};
