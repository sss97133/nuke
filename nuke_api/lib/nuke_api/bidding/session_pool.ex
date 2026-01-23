defmodule NukeApi.Bidding.SessionPool do
  @moduledoc """
  Manages authenticated sessions for platform credentials.

  Maintains a pool of active sessions per user/platform combination,
  handles session refresh before expiry, and provides sessions for
  bid execution and auction monitoring.
  """

  use GenServer
  require Logger

  alias NukeApi.Bidding.{CredentialManager, PlatformAuthenticator}

  @session_refresh_margin_seconds 300  # Refresh 5 minutes before expiry
  @session_check_interval_ms 60_000    # Check sessions every minute

  # Client API

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc """
  Gets an active session for a user/platform. Creates one if needed.

  Returns {:ok, session} or {:error, reason}.
  """
  @spec get_session(String.t(), String.t()) :: {:ok, map()} | {:error, term()}
  def get_session(user_id, platform) do
    GenServer.call(__MODULE__, {:get_session, user_id, platform}, 30_000)
  end

  @doc """
  Gets session by credential ID.
  """
  @spec get_session_by_credential(String.t()) :: {:ok, map()} | {:error, term()}
  def get_session_by_credential(credential_id) do
    GenServer.call(__MODULE__, {:get_session_by_credential, credential_id}, 30_000)
  end

  @doc """
  Invalidates a session, forcing re-authentication on next use.
  """
  @spec invalidate_session(String.t(), String.t()) :: :ok
  def invalidate_session(user_id, platform) do
    GenServer.cast(__MODULE__, {:invalidate_session, user_id, platform})
  end

  @doc """
  Updates a session after successful operation (extends validity).
  """
  @spec touch_session(String.t(), String.t()) :: :ok
  def touch_session(user_id, platform) do
    GenServer.cast(__MODULE__, {:touch_session, user_id, platform})
  end

  @doc """
  Manually refresh a session.
  """
  @spec refresh_session(String.t(), String.t()) :: {:ok, map()} | {:error, term()}
  def refresh_session(user_id, platform) do
    GenServer.call(__MODULE__, {:refresh_session, user_id, platform}, 30_000)
  end

  @doc """
  Returns stats about the session pool.
  """
  @spec get_stats() :: map()
  def get_stats do
    GenServer.call(__MODULE__, :get_stats)
  end

  # GenServer callbacks

  @impl true
  def init(_opts) do
    # Schedule periodic session check
    schedule_session_check()

    state = %{
      sessions: %{},        # %{{user_id, platform} => session_data}
      pending_auth: %{},    # %{{user_id, platform} => from_list}
      stats: %{
        hits: 0,
        misses: 0,
        refreshes: 0,
        failures: 0
      }
    }

    Logger.info("SessionPool started")
    {:ok, state}
  end

  @impl true
  def handle_call({:get_session, user_id, platform}, from, state) do
    key = {user_id, platform}

    case Map.get(state.sessions, key) do
      %{session: session, expires_at: expires_at} = cached ->
        if session_valid?(session, expires_at) do
          # Cache hit
          Logger.debug("[SessionPool] Cache hit for #{platform}/#{user_id}")
          new_stats = Map.update!(state.stats, :hits, &(&1 + 1))
          {:reply, {:ok, session}, %{state | stats: new_stats}}
        else
          # Session expired, need to refresh or re-auth
          handle_session_miss(user_id, platform, from, state)
        end

      nil ->
        # Cache miss
        handle_session_miss(user_id, platform, from, state)
    end
  end

  @impl true
  def handle_call({:get_session_by_credential, credential_id}, from, state) do
    case CredentialManager.get_credential_by_id(credential_id) do
      {:ok, %{user_id: user_id, platform: platform}} ->
        handle_call({:get_session, user_id, platform}, from, state)

      {:error, reason} ->
        {:reply, {:error, reason}, state}
    end
  end

  @impl true
  def handle_call({:refresh_session, user_id, platform}, _from, state) do
    key = {user_id, platform}
    result = do_refresh_session(user_id, platform)

    case result do
      {:ok, session} ->
        expires_at = session[:expires_at] || DateTime.add(DateTime.utc_now(), 3600, :second)
        new_sessions = Map.put(state.sessions, key, %{session: session, expires_at: expires_at})
        new_stats = Map.update!(state.stats, :refreshes, &(&1 + 1))
        {:reply, {:ok, session}, %{state | sessions: new_sessions, stats: new_stats}}

      {:error, reason} ->
        {:reply, {:error, reason}, state}
    end
  end

  @impl true
  def handle_call(:get_stats, _from, state) do
    stats = Map.merge(state.stats, %{
      active_sessions: map_size(state.sessions),
      pending_auth: map_size(state.pending_auth)
    })
    {:reply, stats, state}
  end

  @impl true
  def handle_cast({:invalidate_session, user_id, platform}, state) do
    key = {user_id, platform}
    Logger.info("[SessionPool] Invalidating session for #{platform}/#{user_id}")
    new_sessions = Map.delete(state.sessions, key)
    {:noreply, %{state | sessions: new_sessions}}
  end

  @impl true
  def handle_cast({:touch_session, user_id, platform}, state) do
    key = {user_id, platform}

    case Map.get(state.sessions, key) do
      %{session: session} ->
        # Extend expiry by 30 minutes
        new_expires = DateTime.add(DateTime.utc_now(), 1800, :second)
        new_sessions = Map.put(state.sessions, key, %{session: session, expires_at: new_expires})
        {:noreply, %{state | sessions: new_sessions}}

      nil ->
        {:noreply, state}
    end
  end

  @impl true
  def handle_info(:check_sessions, state) do
    new_state = check_and_refresh_sessions(state)
    schedule_session_check()
    {:noreply, new_state}
  end

  @impl true
  def handle_info({:auth_result, key, result}, state) do
    {user_id, platform} = key

    # Reply to all waiting callers
    pending = Map.get(state.pending_auth, key, [])
    new_pending = Map.delete(state.pending_auth, key)

    case result do
      {:ok, session} ->
        Logger.info("[SessionPool] Auth successful for #{platform}/#{user_id}")
        expires_at = session[:expires_at] || DateTime.add(DateTime.utc_now(), 3600, :second)
        new_sessions = Map.put(state.sessions, key, %{session: session, expires_at: expires_at})
        new_stats = Map.update!(state.stats, :misses, &(&1 + 1))

        # Reply to all waiting callers
        Enum.each(pending, fn from -> GenServer.reply(from, {:ok, session}) end)

        {:noreply, %{state | sessions: new_sessions, pending_auth: new_pending, stats: new_stats}}

      {:error, reason} ->
        Logger.error("[SessionPool] Auth failed for #{platform}/#{user_id}: #{inspect(reason)}")
        new_stats = Map.update!(state.stats, :failures, &(&1 + 1))

        # Reply to all waiting callers with error
        Enum.each(pending, fn from -> GenServer.reply(from, {:error, reason}) end)

        {:noreply, %{state | pending_auth: new_pending, stats: new_stats}}
    end
  end

  # Private functions

  defp handle_session_miss(user_id, platform, from, state) do
    key = {user_id, platform}
    Logger.debug("[SessionPool] Cache miss for #{platform}/#{user_id}")

    case Map.get(state.pending_auth, key) do
      nil ->
        # No pending auth, start one
        new_pending = Map.put(state.pending_auth, key, [from])
        start_auth_task(user_id, platform, key)
        {:noreply, %{state | pending_auth: new_pending}}

      waiters ->
        # Auth already in progress, add to waiters
        new_pending = Map.put(state.pending_auth, key, [from | waiters])
        {:noreply, %{state | pending_auth: new_pending}}
    end
  end

  defp start_auth_task(user_id, platform, key) do
    parent = self()

    Task.start(fn ->
      result = PlatformAuthenticator.authenticate(user_id, platform)
      send(parent, {:auth_result, key, result})
    end)
  end

  defp session_valid?(session, expires_at) do
    has_data = is_map(session) and (map_size(session.cookies || %{}) > 0 or session[:token] != nil)
    not_expired = DateTime.compare(expires_at, DateTime.utc_now()) == :gt

    has_data and not_expired
  end

  defp do_refresh_session(user_id, platform) do
    case CredentialManager.get_credentials(user_id, platform) do
      {:ok, %{session: session}} when not is_nil(session) ->
        adapter = get_platform_adapter(platform)

        if adapter.validate_session(session) do
          adapter.refresh_session(session)
        else
          # Session invalid, need full re-auth
          PlatformAuthenticator.authenticate(user_id, platform)
        end

      {:ok, _} ->
        # No session, need full auth
        PlatformAuthenticator.authenticate(user_id, platform)

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp check_and_refresh_sessions(state) do
    now = DateTime.utc_now()
    refresh_threshold = DateTime.add(now, @session_refresh_margin_seconds, :second)

    sessions_to_refresh = state.sessions
    |> Enum.filter(fn {_key, %{expires_at: expires_at}} ->
      DateTime.compare(expires_at, refresh_threshold) == :lt and
      DateTime.compare(expires_at, now) == :gt
    end)
    |> Enum.map(fn {key, _} -> key end)

    # Refresh sessions in background
    Enum.each(sessions_to_refresh, fn {user_id, platform} ->
      Task.start(fn ->
        case do_refresh_session(user_id, platform) do
          {:ok, session} ->
            Logger.debug("[SessionPool] Proactively refreshed session for #{platform}/#{user_id}")
            # Update via cast to avoid deadlock
            GenServer.cast(__MODULE__, {:update_session, user_id, platform, session})

          {:error, reason} ->
            Logger.warn("[SessionPool] Failed to refresh session for #{platform}/#{user_id}: #{inspect(reason)}")
        end
      end)
    end)

    # Remove expired sessions
    active_sessions = state.sessions
    |> Enum.reject(fn {_key, %{expires_at: expires_at}} ->
      DateTime.compare(expires_at, now) == :lt
    end)
    |> Map.new()

    %{state | sessions: active_sessions}
  end

  defp schedule_session_check do
    Process.send_after(self(), :check_sessions, @session_check_interval_ms)
  end

  defp get_platform_adapter(platform) do
    case platform do
      "bat" -> NukeApi.Bidding.Platforms.Bat
      "cars_and_bids" -> NukeApi.Bidding.Platforms.CarsAndBids
      _ -> raise "Unknown platform: #{platform}"
    end
  end
end
