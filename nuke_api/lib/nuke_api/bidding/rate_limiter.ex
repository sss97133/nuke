defmodule NukeApi.Bidding.RateLimiter do
  @moduledoc """
  Per-platform rate limiting for external auction API requests.

  Implements sliding window rate limiting with platform-specific
  limits to avoid triggering anti-bot measures.

  Default limits:
  - BaT: 20 requests/minute, minimum 1500ms between requests
  - Cars & Bids: 30 requests/minute, minimum 1000ms between requests
  - Other platforms: 15 requests/minute, minimum 2000ms between requests
  """

  use GenServer
  require Logger

  @cleanup_interval_ms 60_000  # Clean old entries every minute

  # Platform-specific rate limits
  @platform_limits %{
    "bat" => %{
      requests_per_minute: 20,
      min_interval_ms: 1500,
      burst_limit: 5
    },
    "cars_and_bids" => %{
      requests_per_minute: 30,
      min_interval_ms: 1000,
      burst_limit: 8
    },
    "pcarmarket" => %{
      requests_per_minute: 20,
      min_interval_ms: 1500,
      burst_limit: 5
    },
    "collecting_cars" => %{
      requests_per_minute: 15,
      min_interval_ms: 2000,
      burst_limit: 4
    },
    "default" => %{
      requests_per_minute: 15,
      min_interval_ms: 2000,
      burst_limit: 4
    }
  }

  # Client API

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc """
  Checks if a request is allowed under rate limits.
  Returns :ok if allowed, or {:error, :rate_limited} if not.

  Blocks until the request can be made (respecting min_interval).
  """
  @spec check_rate_limit(String.t(), atom()) :: :ok | {:error, :rate_limited}
  def check_rate_limit(platform, request_type \\ :general) do
    GenServer.call(__MODULE__, {:check_rate_limit, platform, request_type}, 10_000)
  end

  @doc """
  Checks rate limit without blocking. Returns immediately.
  """
  @spec check_rate_limit_nowait(String.t(), atom()) :: :ok | {:error, :rate_limited}
  def check_rate_limit_nowait(platform, request_type \\ :general) do
    GenServer.call(__MODULE__, {:check_rate_limit_nowait, platform, request_type})
  end

  @doc """
  Records a request for rate limiting purposes.
  Call this after successful completion of a request.
  """
  @spec record_request(String.t(), atom()) :: :ok
  def record_request(platform, request_type \\ :general) do
    GenServer.cast(__MODULE__, {:record_request, platform, request_type})
  end

  @doc """
  Gets current rate limit statistics for a platform.
  """
  @spec get_stats(String.t()) :: map()
  def get_stats(platform) do
    GenServer.call(__MODULE__, {:get_stats, platform})
  end

  @doc """
  Gets overall rate limiter statistics.
  """
  @spec get_all_stats() :: map()
  def get_all_stats do
    GenServer.call(__MODULE__, :get_all_stats)
  end

  # GenServer callbacks

  @impl true
  def init(_opts) do
    schedule_cleanup()

    state = %{
      requests: %{},      # %{platform => [timestamps]}
      last_request: %{},  # %{platform => timestamp}
      blocked_until: %{}, # %{platform => timestamp}
      stats: %{
        total_allowed: 0,
        total_blocked: 0,
        total_waited: 0
      }
    }

    Logger.info("RateLimiter started")
    {:ok, state}
  end

  @impl true
  def handle_call({:check_rate_limit, platform, request_type}, _from, state) do
    limits = get_platform_limits(platform)
    now = System.monotonic_time(:millisecond)

    case check_limits(state, platform, limits, now) do
      {:ok, new_state} ->
        new_stats = Map.update!(new_state.stats, :total_allowed, &(&1 + 1))
        {:reply, :ok, %{new_state | stats: new_stats}}

      {:wait, wait_ms, new_state} ->
        # Block and wait
        Logger.debug("[RateLimiter] Waiting #{wait_ms}ms for #{platform}/#{request_type}")
        :timer.sleep(wait_ms)
        new_stats = new_state.stats
          |> Map.update!(:total_allowed, &(&1 + 1))
          |> Map.update!(:total_waited, &(&1 + 1))
        {:reply, :ok, %{new_state | stats: new_stats}}

      {:blocked, new_state} ->
        new_stats = Map.update!(new_state.stats, :total_blocked, &(&1 + 1))
        {:reply, {:error, :rate_limited}, %{new_state | stats: new_stats}}
    end
  end

  @impl true
  def handle_call({:check_rate_limit_nowait, platform, _request_type}, _from, state) do
    limits = get_platform_limits(platform)
    now = System.monotonic_time(:millisecond)

    case check_limits(state, platform, limits, now) do
      {:ok, new_state} ->
        new_stats = Map.update!(new_state.stats, :total_allowed, &(&1 + 1))
        {:reply, :ok, %{new_state | stats: new_stats}}

      {:wait, _wait_ms, new_state} ->
        new_stats = Map.update!(new_state.stats, :total_blocked, &(&1 + 1))
        {:reply, {:error, :rate_limited}, %{new_state | stats: new_stats}}

      {:blocked, new_state} ->
        new_stats = Map.update!(new_state.stats, :total_blocked, &(&1 + 1))
        {:reply, {:error, :rate_limited}, %{new_state | stats: new_stats}}
    end
  end

  @impl true
  def handle_call({:get_stats, platform}, _from, state) do
    limits = get_platform_limits(platform)
    requests = Map.get(state.requests, platform, [])
    now = System.monotonic_time(:millisecond)
    window_start = now - 60_000

    recent_requests = Enum.count(requests, fn ts -> ts > window_start end)

    stats = %{
      platform: platform,
      limits: limits,
      requests_in_last_minute: recent_requests,
      requests_remaining: max(0, limits.requests_per_minute - recent_requests),
      last_request_at: Map.get(state.last_request, platform),
      is_blocked: is_blocked?(state, platform, now)
    }

    {:reply, stats, state}
  end

  @impl true
  def handle_call(:get_all_stats, _from, state) do
    now = System.monotonic_time(:millisecond)
    window_start = now - 60_000

    platform_stats = state.requests
    |> Enum.map(fn {platform, requests} ->
      recent = Enum.count(requests, fn ts -> ts > window_start end)
      limits = get_platform_limits(platform)
      {platform, %{
        requests_in_last_minute: recent,
        limit: limits.requests_per_minute,
        utilization: recent / limits.requests_per_minute * 100
      }}
    end)
    |> Map.new()

    stats = Map.merge(state.stats, %{
      platforms: platform_stats
    })

    {:reply, stats, state}
  end

  @impl true
  def handle_cast({:record_request, platform, _request_type}, state) do
    now = System.monotonic_time(:millisecond)

    # Add timestamp to requests list
    requests = Map.get(state.requests, platform, [])
    new_requests = [now | requests]

    new_state = %{state |
      requests: Map.put(state.requests, platform, new_requests),
      last_request: Map.put(state.last_request, platform, now)
    }

    {:noreply, new_state}
  end

  @impl true
  def handle_info(:cleanup, state) do
    now = System.monotonic_time(:millisecond)
    window_start = now - 120_000  # Keep 2 minutes of history

    # Clean old request timestamps
    new_requests = state.requests
    |> Enum.map(fn {platform, timestamps} ->
      filtered = Enum.filter(timestamps, fn ts -> ts > window_start end)
      {platform, filtered}
    end)
    |> Map.new()

    # Clean expired blocks
    new_blocked = state.blocked_until
    |> Enum.filter(fn {_platform, until} -> until > now end)
    |> Map.new()

    schedule_cleanup()
    {:noreply, %{state | requests: new_requests, blocked_until: new_blocked}}
  end

  # Private functions

  defp schedule_cleanup do
    Process.send_after(self(), :cleanup, @cleanup_interval_ms)
  end

  defp get_platform_limits(platform) do
    Map.get(@platform_limits, platform, @platform_limits["default"])
  end

  defp check_limits(state, platform, limits, now) do
    # Check if we're blocked
    if is_blocked?(state, platform, now) do
      {:blocked, state}
    else
      # Check minimum interval
      last = Map.get(state.last_request, platform)
      time_since_last = if last, do: now - last, else: limits.min_interval_ms

      if time_since_last < limits.min_interval_ms do
        wait_ms = limits.min_interval_ms - time_since_last
        {:wait, wait_ms, state}
      else
        # Check requests per minute
        requests = Map.get(state.requests, platform, [])
        window_start = now - 60_000
        recent_requests = Enum.count(requests, fn ts -> ts > window_start end)

        if recent_requests >= limits.requests_per_minute do
          # Rate limited - find when we can make next request
          oldest_in_window = requests
            |> Enum.filter(fn ts -> ts > window_start end)
            |> Enum.min(fn -> now end)

          wait_ms = oldest_in_window + 60_000 - now

          if wait_ms > 5000 do
            # Don't wait more than 5 seconds, just block
            {:blocked, state}
          else
            {:wait, max(wait_ms, limits.min_interval_ms), state}
          end
        else
          # Record this request
          new_requests = [now | requests]
          new_state = %{state |
            requests: Map.put(state.requests, platform, new_requests),
            last_request: Map.put(state.last_request, platform, now)
          }
          {:ok, new_state}
        end
      end
    end
  end

  defp is_blocked?(state, platform, now) do
    case Map.get(state.blocked_until, platform) do
      nil -> false
      until -> until > now
    end
  end
end
