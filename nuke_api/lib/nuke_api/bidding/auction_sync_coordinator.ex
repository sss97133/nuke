defmodule NukeApi.Bidding.AuctionSyncCoordinator do
  @moduledoc """
  Coordinates real-time auction state synchronization.

  Implements adaptive polling based on auction urgency:
  - > 1 hour: Every 60 seconds
  - < 1 hour: Every 30 seconds
  - < 10 min: Every 15 seconds
  - < 2 min (soft-close): Every 5 seconds

  Also handles server time synchronization to ensure accurate snipe timing.
  """

  use GenServer
  require Logger

  alias NukeApi.Bidding.{SessionPool, RateLimiter, SniperScheduler}
  alias NukeApi.Repo

  @check_interval_ms 5000  # Check which auctions need polling every 5s

  # Client API

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc """
  Registers an auction for active monitoring.
  """
  @spec start_monitoring(String.t(), map()) :: :ok
  def start_monitoring(external_listing_id, opts \\ %{}) do
    GenServer.cast(__MODULE__, {:start_monitoring, external_listing_id, opts})
  end

  @doc """
  Stops monitoring an auction.
  """
  @spec stop_monitoring(String.t()) :: :ok
  def stop_monitoring(external_listing_id) do
    GenServer.cast(__MODULE__, {:stop_monitoring, external_listing_id})
  end

  @doc """
  Manually updates auction state (called by BidExecutor after placing bids).
  """
  @spec update_state(String.t(), map()) :: :ok
  def update_state(external_listing_id, auction_state) do
    GenServer.cast(__MODULE__, {:update_state, external_listing_id, auction_state})
  end

  @doc """
  Gets current cached state for an auction.
  """
  @spec get_state(String.t()) :: {:ok, map()} | {:error, :not_found}
  def get_state(external_listing_id) do
    GenServer.call(__MODULE__, {:get_state, external_listing_id})
  end

  @doc """
  Gets server time offset for a platform.
  """
  @spec get_time_offset(String.t()) :: integer()
  def get_time_offset(platform) do
    GenServer.call(__MODULE__, {:get_time_offset, platform})
  end

  @doc """
  Returns monitoring statistics.
  """
  @spec get_stats() :: map()
  def get_stats do
    GenServer.call(__MODULE__, :get_stats)
  end

  # GenServer callbacks

  @impl true
  def init(_opts) do
    # Schedule periodic check
    schedule_check()

    state = %{
      monitored: %{},       # %{listing_id => %{last_polled, poll_interval, ...}}
      time_offsets: %{},    # %{platform => offset_ms}
      stats: %{
        total_polls: 0,
        extensions_detected: 0,
        sync_errors: 0
      }
    }

    # Load existing active bids that need monitoring
    load_active_bids(state)

    Logger.info("AuctionSyncCoordinator started")
    {:ok, state}
  end

  @impl true
  def handle_cast({:start_monitoring, listing_id, opts}, state) do
    Logger.info("[AuctionSync] Starting monitoring for listing #{listing_id}")

    entry = %{
      platform: opts[:platform],
      auction_url: opts[:auction_url],
      user_id: opts[:user_id],
      proxy_bid_id: opts[:proxy_bid_id],
      last_polled: nil,
      poll_interval_ms: 60_000,  # Start with 1 minute
      end_time: opts[:end_time]
    }

    new_monitored = Map.put(state.monitored, listing_id, entry)
    {:noreply, %{state | monitored: new_monitored}}
  end

  @impl true
  def handle_cast({:stop_monitoring, listing_id}, state) do
    Logger.info("[AuctionSync] Stopping monitoring for listing #{listing_id}")
    new_monitored = Map.delete(state.monitored, listing_id)
    {:noreply, %{state | monitored: new_monitored}}
  end

  @impl true
  def handle_cast({:update_state, listing_id, auction_state}, state) do
    # Update database cache
    save_auction_state(listing_id, auction_state, "bid_execution")

    # Update local tracking if monitored
    case Map.get(state.monitored, listing_id) do
      nil ->
        {:noreply, state}

      entry ->
        new_entry = %{entry |
          end_time: auction_state.auction_end_time,
          last_polled: DateTime.utc_now()
        }

        # Check for extensions
        new_stats = if entry.end_time && auction_state.auction_end_time &&
                       DateTime.compare(auction_state.auction_end_time, entry.end_time) == :gt do
          Logger.info("[AuctionSync] Extension detected for #{listing_id}")
          # Notify sniper scheduler of extension
          SniperScheduler.handle_extension(entry.proxy_bid_id, auction_state.auction_end_time)
          Map.update!(state.stats, :extensions_detected, &(&1 + 1))
        else
          state.stats
        end

        new_monitored = Map.put(state.monitored, listing_id, new_entry)
        {:noreply, %{state | monitored: new_monitored, stats: new_stats}}
    end
  end

  @impl true
  def handle_call({:get_state, listing_id}, _from, state) do
    result = fetch_cached_state(listing_id)
    {:reply, result, state}
  end

  @impl true
  def handle_call({:get_time_offset, platform}, _from, state) do
    offset = Map.get(state.time_offsets, platform, 0)
    {:reply, offset, state}
  end

  @impl true
  def handle_call(:get_stats, _from, state) do
    stats = Map.merge(state.stats, %{
      monitored_count: map_size(state.monitored),
      platforms_synced: map_size(state.time_offsets)
    })
    {:reply, stats, state}
  end

  @impl true
  def handle_info(:check_auctions, state) do
    new_state = poll_due_auctions(state)
    schedule_check()
    {:noreply, new_state}
  end

  @impl true
  def handle_info({:poll_result, listing_id, result}, state) do
    new_state = handle_poll_result(state, listing_id, result)
    {:noreply, new_state}
  end

  # Private functions

  defp schedule_check do
    Process.send_after(self(), :check_auctions, @check_interval_ms)
  end

  defp load_active_bids(state) do
    # Load active proxy bids from database
    query = """
      SELECT pbr.id, pbr.user_id, pbr.external_listing_id, pbr.platform, pbr.external_auction_url,
             el.auction_end_date
      FROM proxy_bid_requests pbr
      LEFT JOIN external_listings el ON el.id = pbr.external_listing_id
      WHERE pbr.status IN ('active', 'winning', 'outbid')
      AND (el.auction_end_date IS NULL OR el.auction_end_date > NOW())
    """

    case Repo.query(query, []) do
      {:ok, %{rows: rows}} ->
        Enum.each(rows, fn [id, user_id, listing_id, platform, url, end_time] ->
          start_monitoring(listing_id, %{
            platform: platform,
            auction_url: url,
            user_id: user_id,
            proxy_bid_id: id,
            end_time: end_time
          })
        end)

      {:error, reason} ->
        Logger.error("[AuctionSync] Failed to load active bids: #{inspect(reason)}")
    end

    state
  end

  defp poll_due_auctions(state) do
    now = DateTime.utc_now()

    # Find auctions that need polling
    due_auctions = state.monitored
    |> Enum.filter(fn {_id, entry} -> should_poll?(entry, now) end)
    |> Enum.map(fn {id, entry} -> {id, entry} end)

    # Poll each due auction
    Enum.each(due_auctions, fn {listing_id, entry} ->
      poll_auction_async(listing_id, entry)
    end)

    # Update last_polled times
    new_monitored = Enum.reduce(due_auctions, state.monitored, fn {id, entry}, acc ->
      new_entry = %{entry |
        last_polled: now,
        poll_interval_ms: calculate_poll_interval(entry.end_time, now)
      }
      Map.put(acc, id, new_entry)
    end)

    new_stats = Map.update!(state.stats, :total_polls, &(&1 + length(due_auctions)))
    %{state | monitored: new_monitored, stats: new_stats}
  end

  defp should_poll?(entry, now) do
    case entry.last_polled do
      nil -> true
      last ->
        elapsed_ms = DateTime.diff(now, last, :millisecond)
        elapsed_ms >= entry.poll_interval_ms
    end
  end

  defp calculate_poll_interval(nil, _now), do: 60_000  # Default 1 minute

  defp calculate_poll_interval(end_time, now) do
    seconds_remaining = DateTime.diff(end_time, now, :second)

    cond do
      seconds_remaining <= 0 -> nil  # Auction ended
      seconds_remaining <= 120 -> 5_000    # < 2 min: 5 seconds (soft-close)
      seconds_remaining <= 600 -> 15_000   # < 10 min: 15 seconds
      seconds_remaining <= 3600 -> 30_000  # < 1 hour: 30 seconds
      true -> 60_000                        # > 1 hour: 60 seconds
    end
  end

  defp poll_auction_async(listing_id, entry) do
    parent = self()

    Task.start(fn ->
      result = do_poll_auction(entry)
      send(parent, {:poll_result, listing_id, result})
    end)
  end

  defp do_poll_auction(entry) do
    with {:ok, session} <- SessionPool.get_session(entry.user_id, entry.platform),
         :ok <- RateLimiter.check_rate_limit(entry.platform, :poll) do

      adapter = get_platform_adapter(entry.platform)
      start_time = System.monotonic_time(:millisecond)

      case adapter.get_auction_state(session, entry.auction_url) do
        {:ok, state} ->
          elapsed = System.monotonic_time(:millisecond) - start_time
          {:ok, Map.put(state, :latency_ms, elapsed)}

        {:error, :auction_ended} ->
          {:error, :auction_ended}

        {:error, reason} ->
          {:error, reason}
      end
    end
  end

  defp handle_poll_result(state, listing_id, result) do
    case result do
      {:ok, auction_state} ->
        # Update database cache
        save_auction_state(listing_id, auction_state, "poll")

        # Check for extension
        case Map.get(state.monitored, listing_id) do
          nil ->
            state

          entry ->
            if entry.end_time && auction_state.auction_end_time &&
               DateTime.compare(auction_state.auction_end_time, entry.end_time) == :gt do
              Logger.info("[AuctionSync] Extension detected for #{listing_id}")
              SniperScheduler.handle_extension(entry.proxy_bid_id, auction_state.auction_end_time)

              new_entry = %{entry | end_time: auction_state.auction_end_time}
              new_monitored = Map.put(state.monitored, listing_id, new_entry)
              new_stats = Map.update!(state.stats, :extensions_detected, &(&1 + 1))
              %{state | monitored: new_monitored, stats: new_stats}
            else
              state
            end
        end

      {:error, :auction_ended} ->
        Logger.info("[AuctionSync] Auction ended for #{listing_id}")
        finalize_auction(listing_id, state.monitored[listing_id])
        new_monitored = Map.delete(state.monitored, listing_id)
        %{state | monitored: new_monitored}

      {:error, reason} ->
        Logger.warn("[AuctionSync] Poll failed for #{listing_id}: #{inspect(reason)}")
        new_stats = Map.update!(state.stats, :sync_errors, &(&1 + 1))
        %{state | stats: new_stats}
    end
  end

  defp save_auction_state(listing_id, auction_state, source) do
    query = """
      INSERT INTO auction_state_cache (
        external_listing_id, current_bid_cents, bid_count, high_bidder_username,
        auction_end_time, server_time_offset_ms, last_synced_at, sync_source,
        sync_latency_ms, is_soft_close_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9)
      ON CONFLICT (external_listing_id)
      DO UPDATE SET
        current_bid_cents = EXCLUDED.current_bid_cents,
        bid_count = EXCLUDED.bid_count,
        high_bidder_username = EXCLUDED.high_bidder_username,
        auction_end_time = EXCLUDED.auction_end_time,
        server_time_offset_ms = COALESCE(EXCLUDED.server_time_offset_ms, auction_state_cache.server_time_offset_ms),
        last_synced_at = NOW(),
        sync_source = EXCLUDED.sync_source,
        sync_latency_ms = EXCLUDED.sync_latency_ms,
        is_soft_close_active = EXCLUDED.is_soft_close_active,
        last_extension_at = CASE
          WHEN auction_state_cache.auction_end_time IS NOT NULL
            AND EXCLUDED.auction_end_time > auction_state_cache.auction_end_time
          THEN NOW()
          ELSE auction_state_cache.last_extension_at
        END,
        extension_count = CASE
          WHEN auction_state_cache.auction_end_time IS NOT NULL
            AND EXCLUDED.auction_end_time > auction_state_cache.auction_end_time
          THEN auction_state_cache.extension_count + 1
          ELSE auction_state_cache.extension_count
        END,
        updated_at = NOW()
    """

    Repo.query(query, [
      listing_id,
      auction_state.current_bid_cents,
      auction_state.bid_count,
      auction_state.high_bidder_username,
      auction_state.auction_end_time,
      calculate_time_offset(auction_state),
      source,
      auction_state[:latency_ms],
      auction_state.is_soft_close_active
    ])
  end

  defp fetch_cached_state(listing_id) do
    query = """
      SELECT current_bid_cents, bid_count, high_bidder_username, auction_end_time,
             server_time_offset_ms, last_synced_at, sync_source, is_soft_close_active,
             extension_count
      FROM auction_state_cache
      WHERE external_listing_id = $1
    """

    case Repo.query(query, [listing_id]) do
      {:ok, %{rows: [[bid, count, bidder, end_time, offset, synced, source, soft_close, extensions]], columns: _}} ->
        {:ok, %{
          current_bid_cents: bid,
          bid_count: count,
          high_bidder_username: bidder,
          auction_end_time: end_time,
          server_time_offset_ms: offset,
          last_synced_at: synced,
          sync_source: source,
          is_soft_close_active: soft_close,
          extension_count: extensions
        }}

      {:ok, %{rows: []}} ->
        {:error, :not_found}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp calculate_time_offset(auction_state) do
    case auction_state[:server_time] do
      nil -> nil
      server_time ->
        DateTime.diff(server_time, DateTime.utc_now(), :millisecond)
    end
  end

  defp finalize_auction(listing_id, entry) when not is_nil(entry) do
    # Update proxy bid request status based on final state
    query = """
      SELECT high_bidder_username, current_bid_cents
      FROM auction_state_cache
      WHERE external_listing_id = $1
    """

    case Repo.query(query, [listing_id]) do
      {:ok, %{rows: [[high_bidder, final_bid]]}} ->
        # Determine if we won (need to check our username)
        # For now, just mark as expired and let manual review determine outcome
        update_query = """
          UPDATE proxy_bid_requests
          SET status = 'expired',
              final_bid_cents = $2,
              updated_at = NOW()
          WHERE external_listing_id = $1
          AND status IN ('active', 'winning', 'outbid')
        """

        Repo.query(update_query, [listing_id, final_bid])

      _ ->
        :ok
    end
  end

  defp finalize_auction(_, nil), do: :ok

  defp get_platform_adapter(platform) do
    case platform do
      "bat" -> NukeApi.Bidding.Platforms.Bat
      "cars_and_bids" -> NukeApi.Bidding.Platforms.CarsAndBids
      _ -> raise "Unknown platform: #{platform}"
    end
  end
end
