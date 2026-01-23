defmodule NukeApi.Bidding.SniperScheduler do
  @moduledoc """
  Schedules sniper bids for last-minute auction execution.

  Strategy:
  1. T-10 min: AuctionSyncCoordinator starts aggressive polling (every 5s)
  2. T-30 sec: Place bid (or custom snipe time)
  3. If extended: Reschedule for new T-30 sec mark
  4. Repeat until max_bid reached or auction ends

  BaT soft-close: Any bid within 2 minutes extends auction by 2 minutes.
  """

  use GenServer
  require Logger

  alias NukeApi.Bidding.{AuctionSyncCoordinator, BidExecutor}
  alias NukeApi.Repo

  @default_snipe_seconds 30     # Bid 30 seconds before end
  @check_interval_ms 1000       # Check scheduled snipes every second
  @max_extensions 50            # Maximum extensions to follow

  # Client API

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc """
  Schedules a snipe bid for a proxy bid request.
  """
  @spec schedule_snipe(String.t(), map()) :: {:ok, map()} | {:error, term()}
  def schedule_snipe(proxy_bid_id, opts \\ %{}) do
    GenServer.call(__MODULE__, {:schedule_snipe, proxy_bid_id, opts})
  end

  @doc """
  Cancels a scheduled snipe.
  """
  @spec cancel_snipe(String.t()) :: :ok | {:error, term()}
  def cancel_snipe(proxy_bid_id) do
    GenServer.call(__MODULE__, {:cancel_snipe, proxy_bid_id})
  end

  @doc """
  Handles auction extension notification from AuctionSyncCoordinator.
  Reschedules snipe for new end time if needed.
  """
  @spec handle_extension(String.t(), DateTime.t()) :: :ok
  def handle_extension(proxy_bid_id, new_end_time) do
    GenServer.cast(__MODULE__, {:handle_extension, proxy_bid_id, new_end_time})
  end

  @doc """
  Gets scheduled snipes statistics.
  """
  @spec get_stats() :: map()
  def get_stats do
    GenServer.call(__MODULE__, :get_stats)
  end

  @doc """
  Lists all scheduled snipes.
  """
  @spec list_scheduled() :: [map()]
  def list_scheduled do
    GenServer.call(__MODULE__, :list_scheduled)
  end

  # GenServer callbacks

  @impl true
  def init(_opts) do
    schedule_check()

    state = %{
      scheduled: %{},  # %{proxy_bid_id => snipe_data}
      stats: %{
        total_scheduled: 0,
        total_executed: 0,
        extensions_handled: 0,
        cancelled: 0
      }
    }

    # Load existing snipe bids from database
    load_scheduled_snipes(state)

    Logger.info("SniperScheduler started")
    {:ok, state}
  end

  @impl true
  def handle_call({:schedule_snipe, proxy_bid_id, opts}, _from, state) do
    case do_schedule_snipe(proxy_bid_id, opts) do
      {:ok, snipe_data} ->
        new_scheduled = Map.put(state.scheduled, proxy_bid_id, snipe_data)
        new_stats = Map.update!(state.stats, :total_scheduled, &(&1 + 1))
        {:reply, {:ok, snipe_data}, %{state | scheduled: new_scheduled, stats: new_stats}}

      {:error, reason} ->
        {:reply, {:error, reason}, state}
    end
  end

  @impl true
  def handle_call({:cancel_snipe, proxy_bid_id}, _from, state) do
    case Map.get(state.scheduled, proxy_bid_id) do
      nil ->
        {:reply, {:error, :not_found}, state}

      snipe_data ->
        # Cancel the queue entry if exists
        if snipe_data[:execution_id] do
          BidExecutor.cancel_execution(snipe_data.execution_id)
        end

        new_scheduled = Map.delete(state.scheduled, proxy_bid_id)
        new_stats = Map.update!(state.stats, :cancelled, &(&1 + 1))
        Logger.info("[SniperScheduler] Cancelled snipe for #{proxy_bid_id}")
        {:reply, :ok, %{state | scheduled: new_scheduled, stats: new_stats}}
    end
  end

  @impl true
  def handle_call(:get_stats, _from, state) do
    stats = Map.merge(state.stats, %{
      currently_scheduled: map_size(state.scheduled)
    })
    {:reply, stats, state}
  end

  @impl true
  def handle_call(:list_scheduled, _from, state) do
    snipes = state.scheduled
    |> Enum.map(fn {id, data} -> Map.put(data, :proxy_bid_id, id) end)
    |> Enum.sort_by(& &1.snipe_at)

    {:reply, snipes, state}
  end

  @impl true
  def handle_cast({:handle_extension, proxy_bid_id, new_end_time}, state) do
    case Map.get(state.scheduled, proxy_bid_id) do
      nil ->
        {:noreply, state}

      snipe_data ->
        if snipe_data.extension_count >= @max_extensions do
          Logger.warn("[SniperScheduler] Max extensions reached for #{proxy_bid_id}")
          {:noreply, state}
        else
          # Reschedule snipe for new end time
          Logger.info("[SniperScheduler] Rescheduling snipe for #{proxy_bid_id} due to extension")

          new_snipe_at = calculate_snipe_time(new_end_time, snipe_data.snipe_seconds_before)

          # Cancel old execution if exists
          if snipe_data[:execution_id] do
            BidExecutor.cancel_execution(snipe_data.execution_id)
          end

          # Create new execution entry
          case create_execution_entry(snipe_data.proxy_bid_id, new_snipe_at, snipe_data.priority) do
            {:ok, execution_id} ->
              new_data = %{snipe_data |
                snipe_at: new_snipe_at,
                end_time: new_end_time,
                execution_id: execution_id,
                extension_count: snipe_data.extension_count + 1
              }

              new_scheduled = Map.put(state.scheduled, proxy_bid_id, new_data)
              new_stats = Map.update!(state.stats, :extensions_handled, &(&1 + 1))
              {:noreply, %{state | scheduled: new_scheduled, stats: new_stats}}

            {:error, _reason} ->
              {:noreply, state}
          end
        end
    end
  end

  @impl true
  def handle_info(:check_snipes, state) do
    new_state = check_and_execute_snipes(state)
    schedule_check()
    {:noreply, new_state}
  end

  @impl true
  def handle_info({:snipe_executed, proxy_bid_id, result}, state) do
    Logger.info("[SniperScheduler] Snipe executed for #{proxy_bid_id}: #{inspect(result)}")

    case result do
      {:ok, %{is_high_bidder: true}} ->
        # We're winning, remove from scheduled
        new_scheduled = Map.delete(state.scheduled, proxy_bid_id)
        new_stats = Map.update!(state.stats, :total_executed, &(&1 + 1))
        {:noreply, %{state | scheduled: new_scheduled, stats: new_stats}}

      {:ok, %{max_reached: true}} ->
        # Max bid reached, remove from scheduled
        new_scheduled = Map.delete(state.scheduled, proxy_bid_id)
        new_stats = Map.update!(state.stats, :total_executed, &(&1 + 1))
        {:noreply, %{state | scheduled: new_scheduled, stats: new_stats}}

      _ ->
        # Keep monitoring for potential re-snipe
        {:noreply, state}
    end
  end

  # Private functions

  defp schedule_check do
    Process.send_after(self(), :check_snipes, @check_interval_ms)
  end

  defp load_scheduled_snipes(_state) do
    # Load proxy bid requests with snipe strategy
    query = """
      SELECT pbr.id, pbr.external_listing_id, pbr.max_bid_cents, pbr.platform,
             el.end_date
      FROM proxy_bid_requests pbr
      LEFT JOIN external_listings el ON el.id = pbr.external_listing_id
      WHERE pbr.bid_strategy = 'snipe_last_minute'
      AND pbr.status IN ('active', 'pending')
      AND (el.end_date IS NULL OR el.end_date > NOW())
    """

    case Repo.query(query, []) do
      {:ok, %{rows: rows}} ->
        Enum.each(rows, fn [id, listing_id, max_bid, platform, end_time] ->
          schedule_snipe(id, %{
            listing_id: listing_id,
            max_bid_cents: max_bid,
            platform: platform,
            end_time: end_time
          })
        end)

      {:error, reason} ->
        Logger.error("[SniperScheduler] Failed to load scheduled snipes: #{inspect(reason)}")
    end
  end

  defp do_schedule_snipe(proxy_bid_id, opts) do
    # Get proxy bid details
    with {:ok, proxy_bid} <- get_proxy_bid(proxy_bid_id) do
      end_time = opts[:end_time] || proxy_bid.auction_end_date

      if is_nil(end_time) do
        {:error, :no_end_time}
      else
        snipe_seconds = opts[:snipe_seconds_before] || @default_snipe_seconds
        snipe_at = calculate_snipe_time(end_time, snipe_seconds)
        priority = opts[:priority] || 10  # High priority for snipes

        # Start monitoring this auction
        AuctionSyncCoordinator.start_monitoring(proxy_bid.external_listing_id, %{
          platform: proxy_bid.platform,
          auction_url: proxy_bid.external_auction_url,
          user_id: proxy_bid.user_id,
          proxy_bid_id: proxy_bid_id,
          end_time: end_time
        })

        # Create execution queue entry
        case create_execution_entry(proxy_bid_id, snipe_at, priority) do
          {:ok, execution_id} ->
            snipe_data = %{
              proxy_bid_id: proxy_bid_id,
              external_listing_id: proxy_bid.external_listing_id,
              platform: proxy_bid.platform,
              max_bid_cents: proxy_bid.max_bid_cents,
              end_time: end_time,
              snipe_at: snipe_at,
              snipe_seconds_before: snipe_seconds,
              execution_id: execution_id,
              priority: priority,
              extension_count: 0,
              created_at: DateTime.utc_now()
            }

            Logger.info("[SniperScheduler] Scheduled snipe for #{proxy_bid_id} at #{snipe_at}")
            {:ok, snipe_data}

          {:error, reason} ->
            {:error, reason}
        end
      end
    end
  end

  defp get_proxy_bid(proxy_bid_id) do
    query = """
      SELECT pbr.id, pbr.user_id, pbr.external_listing_id, pbr.platform,
             pbr.external_auction_url, pbr.max_bid_cents, pbr.status,
             el.end_date
      FROM proxy_bid_requests pbr
      LEFT JOIN external_listings el ON el.id = pbr.external_listing_id
      WHERE pbr.id = $1
    """

    case Repo.query(query, [proxy_bid_id]) do
      {:ok, %{rows: [[id, user_id, listing_id, platform, url, max_bid, status, end_date]], columns: _}} ->
        {:ok, %{
          id: id,
          user_id: user_id,
          external_listing_id: listing_id,
          platform: platform,
          external_auction_url: url,
          max_bid_cents: max_bid,
          status: status,
          end_date: end_date
        }}

      {:ok, %{rows: []}} ->
        {:error, :not_found}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp calculate_snipe_time(end_time, seconds_before) do
    DateTime.add(end_time, -seconds_before, :second)
  end

  defp create_execution_entry(proxy_bid_id, scheduled_for, priority) do
    query = """
      INSERT INTO bid_execution_queue (
        proxy_bid_request_id, scheduled_for, priority, status
      )
      VALUES ($1, $2, $3, 'queued')
      RETURNING id
    """

    case Repo.query(query, [proxy_bid_id, scheduled_for, priority]) do
      {:ok, %{rows: [[id]]}} -> {:ok, id}
      {:error, reason} -> {:error, reason}
    end
  end

  defp check_and_execute_snipes(state) do
    now = DateTime.utc_now()

    # Find snipes that should have executed but haven't
    # (This is a backup - BidExecutor should pick them up from queue)
    overdue = state.scheduled
    |> Enum.filter(fn {_id, data} ->
      DateTime.compare(data.snipe_at, now) == :lt and
      DateTime.diff(now, data.snipe_at, :second) > 60  # More than 60 seconds overdue
    end)

    # Log warnings for overdue snipes
    Enum.each(overdue, fn {id, data} ->
      Logger.warn("[SniperScheduler] Snipe overdue for #{id}, scheduled for #{data.snipe_at}")
    end)

    # Check for auction endings
    ended = state.scheduled
    |> Enum.filter(fn {_id, data} ->
      DateTime.compare(data.end_time, now) == :lt
    end)

    # Remove ended auctions
    new_scheduled = Enum.reduce(ended, state.scheduled, fn {id, _}, acc ->
      Logger.info("[SniperScheduler] Auction ended for #{id}")
      Map.delete(acc, id)
    end)

    %{state | scheduled: new_scheduled}
  end
end
