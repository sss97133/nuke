
# Twitch Streaming Integration

This module provides integration with Twitch's streaming API to allow users to broadcast directly from our application.

## Setup Instructions

1. **Register a Twitch application**:
   - Go to [Twitch Developer Console](https://dev.twitch.tv/console/apps)
   - Create a new application
   - Set the OAuth Redirect URL to: `https://your-app-url.com/streaming`
   - Get your Client ID

2. **Set environment variables**:
   - Create a `.env.local` file in your project root if it doesn't exist
   - Add your Twitch Client ID:
   ```
   VITE_TWITCH_CLIENT_ID=your_client_id_here
   ```

3. **Troubleshooting**:
   - If you see "invalid client" errors, make sure your Client ID is correct
   - Ensure the domain you're accessing from matches the domains in your Twitch app settings
   - Check that your redirect URI exactly matches what's configured in the Twitch Developer Console

4. **Limitations**:
   - This integration provides authentication and API integration with Twitch
   - To actually broadcast video, users will need to use OBS Studio or similar software with the stream key provided
   - The connection status and stream controls in this UI will help manage the stream settings

## Usage Flow

1. User connects their Twitch account via the "Connect with Twitch" button
2. The application stores the authentication token
3. When "Start Stream" is clicked, the application sets up the stream on Twitch
4. The user can then use OBS or similar software to send their video to Twitch using the stream key
5. The "End Stream" button will send the API command to end the stream on Twitch

## Additional Resources

- [Twitch API Documentation](https://dev.twitch.tv/docs/api/)
- [OBS Studio Documentation](https://obsproject.com/wiki/)
- [Twitch Developer Dashboard](https://dev.twitch.tv/console/)
