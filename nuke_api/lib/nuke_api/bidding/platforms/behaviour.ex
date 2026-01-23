defmodule NukeApi.Bidding.Platforms.Behaviour do
  @moduledoc """
  Behaviour defining the interface for platform adapters.

  Each auction platform (BaT, Cars & Bids, etc.) implements this behaviour
  to provide a consistent interface for authentication, session management,
  auction state retrieval, and bid placement.
  """

  @type session :: %{
    token: String.t() | nil,
    cookies: map(),
    expires_at: DateTime.t() | nil,
    user_agent: String.t(),
    platform_user_id: String.t() | nil,
    platform_username: String.t() | nil
  }

  @type credentials :: %{
    username: String.t(),
    password: String.t()
  }

  @type auction_state :: %{
    current_bid_cents: integer(),
    bid_count: integer(),
    high_bidder_username: String.t() | nil,
    auction_end_time: DateTime.t(),
    server_time: DateTime.t(),
    is_reserve_met: boolean() | nil,
    is_soft_close_active: boolean(),
    minimum_bid_cents: integer() | nil,
    bid_increment_cents: integer() | nil
  }

  @type bid_result :: %{
    success: boolean(),
    bid_amount_cents: integer(),
    new_high_bid_cents: integer() | nil,
    is_high_bidder: boolean(),
    message: String.t() | nil,
    error_code: String.t() | nil
  }

  @type two_fa_challenge :: %{
    method: String.t(),
    challenge_data: map(),
    expires_at: DateTime.t()
  }

  @doc """
  Attempts to log in with the provided credentials.

  Returns {:ok, session} on success.
  Returns {:error, :invalid_credentials} if login fails.
  Returns {:error, {:twofa_required, challenge}} if 2FA is needed.
  """
  @callback login(credentials :: credentials()) ::
    {:ok, session()} |
    {:error, :invalid_credentials} |
    {:error, {:twofa_required, two_fa_challenge()}} |
    {:error, term()}

  @doc """
  Validates that a session is still active.

  Returns true if the session is valid and can be used for operations.
  """
  @callback validate_session(session :: session()) :: boolean()

  @doc """
  Refreshes an existing session before it expires.

  Returns {:ok, new_session} on success.
  Returns {:error, :session_expired} if the session cannot be refreshed.
  """
  @callback refresh_session(session :: session()) ::
    {:ok, session()} |
    {:error, :session_expired} |
    {:error, term()}

  @doc """
  Retrieves the current auction state for a given auction URL.

  Returns {:ok, auction_state} on success.
  """
  @callback get_auction_state(session :: session(), auction_url :: String.t()) ::
    {:ok, auction_state()} |
    {:error, :auction_not_found} |
    {:error, :auction_ended} |
    {:error, term()}

  @doc """
  Places a bid on an auction.

  Returns {:ok, bid_result} on success (even if outbid).
  Returns {:error, reason} on failure.
  """
  @callback place_bid(session :: session(), auction_url :: String.t(), amount_cents :: integer()) ::
    {:ok, bid_result()} |
    {:error, :below_minimum} |
    {:error, :auction_ended} |
    {:error, :outbid} |
    {:error, :insufficient_funds} |
    {:error, term()}

  @doc """
  Completes a 2FA challenge.

  Returns {:ok, session} on successful 2FA completion.
  """
  @callback handle_2fa(session :: session(), method :: String.t(), code :: String.t()) ::
    {:ok, session()} |
    {:error, :invalid_code} |
    {:error, :code_expired} |
    {:error, term()}

  @doc """
  Returns platform-specific configuration.
  """
  @callback config() :: %{
    name: String.t(),
    base_url: String.t(),
    rate_limit_requests_per_minute: integer(),
    min_request_interval_ms: integer(),
    soft_close_window_seconds: integer(),
    supports_websocket: boolean()
  }
end
