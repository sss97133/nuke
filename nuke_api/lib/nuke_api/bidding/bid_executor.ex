defmodule NukeApi.Bidding.BidExecutor do
  @moduledoc """
  Executes bids from the bid_execution_queue.

  Polls the queue for pending executions, claims them with distributed
  locking, executes bids through platform adapters, and handles retries.
  """

  use GenServer
  require Logger

  alias NukeApi.Bidding.{SessionPool, RateLimiter, AuctionSyncCoordinator}
  alias NukeApi.Repo

  @poll_interval_ms 1000          # Poll every second
  @lock_timeout_seconds 60        # Release lock after 60 seconds
  @executor_id_prefix "bid_executor"

  # Client API

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc """
  Manually triggers execution of a specific queue entry.
  """
  @spec execute_now(String.t()) :: {:ok, map()} | {:error, term()}
  def execute_now(execution_id) do
    GenServer.call(__MODULE__, {:execute_now, execution_id}, 60_000)
  end

  @doc """
  Cancels a queued execution.
  """
  @spec cancel_execution(String.t()) :: :ok | {:error, term()}
  def cancel_execution(execution_id) do
    GenServer.call(__MODULE__, {:cancel_execution, execution_id})
  end

  @doc """
  Returns executor statistics.
  """
  @spec get_stats() :: map()
  def get_stats do
    GenServer.call(__MODULE__, :get_stats)
  end

  # GenServer callbacks

  @impl true
  def init(opts) do
    executor_id = "#{@executor_id_prefix}_#{:erlang.unique_integer([:positive])}"

    state = %{
      executor_id: executor_id,
      executing: %{},  # %{execution_id => task_ref}
      stats: %{
        total_executed: 0,
        successful: 0,
        failed: 0,
        retried: 0
      },
      paused: Keyword.get(opts, :paused, false)
    }

    unless state.paused do
      schedule_poll()
    end

    Logger.info("BidExecutor started with ID: #{executor_id}")
    {:ok, state}
  end

  @impl true
  def handle_call({:execute_now, execution_id}, _from, state) do
    result = do_execute(execution_id, state.executor_id)
    {:reply, result, state}
  end

  @impl true
  def handle_call({:cancel_execution, execution_id}, _from, state) do
    result = cancel_queued_execution(execution_id)
    {:reply, result, state}
  end

  @impl true
  def handle_call(:get_stats, _from, state) do
    stats = Map.merge(state.stats, %{
      executor_id: state.executor_id,
      currently_executing: map_size(state.executing),
      paused: state.paused
    })
    {:reply, stats, state}
  end

  @impl true
  def handle_info(:poll_queue, state) do
    new_state = if state.paused do
      state
    else
      poll_and_execute(state)
    end

    schedule_poll()
    {:noreply, new_state}
  end

  @impl true
  def handle_info({ref, result}, state) when is_reference(ref) do
    # Task completed
    {execution_id, new_executing} = pop_by_ref(state.executing, ref)

    new_stats = case result do
      {:ok, _} ->
        state.stats
        |> Map.update!(:total_executed, &(&1 + 1))
        |> Map.update!(:successful, &(&1 + 1))

      {:error, :retrying} ->
        Map.update!(state.stats, :retried, &(&1 + 1))

      {:error, _} ->
        state.stats
        |> Map.update!(:total_executed, &(&1 + 1))
        |> Map.update!(:failed, &(&1 + 1))
    end

    Logger.debug("[BidExecutor] Task completed for execution #{execution_id}: #{inspect(result)}")
    Process.demonitor(ref, [:flush])

    {:noreply, %{state | executing: new_executing, stats: new_stats}}
  end

  @impl true
  def handle_info({:DOWN, ref, :process, _pid, reason}, state) do
    # Task crashed
    {execution_id, new_executing} = pop_by_ref(state.executing, ref)

    if execution_id do
      Logger.error("[BidExecutor] Task crashed for execution #{execution_id}: #{inspect(reason)}")
      release_lock(execution_id)
    end

    new_stats = Map.update!(state.stats, :failed, &(&1 + 1))
    {:noreply, %{state | executing: new_executing, stats: new_stats}}
  end

  # Private functions

  defp schedule_poll do
    Process.send_after(self(), :poll_queue, @poll_interval_ms)
  end

  defp poll_and_execute(state) do
    # Claim next execution from queue
    case claim_next_execution(state.executor_id) do
      {:ok, execution} ->
        Logger.info("[BidExecutor] Claimed execution #{execution.id}")

        # Start execution in background task
        task = Task.async(fn ->
          do_execute(execution.id, state.executor_id)
        end)

        new_executing = Map.put(state.executing, execution.id, task.ref)
        %{state | executing: new_executing}

      {:error, :none_available} ->
        state

      {:error, reason} ->
        Logger.error("[BidExecutor] Failed to claim execution: #{inspect(reason)}")
        state
    end
  end

  defp claim_next_execution(executor_id) do
    query = """
      UPDATE bid_execution_queue
      SET status = 'locked',
          locked_by = $1,
          locked_at = NOW(),
          updated_at = NOW()
      WHERE id = (
        SELECT id FROM bid_execution_queue
        WHERE status = 'queued'
        AND scheduled_for <= NOW() + INTERVAL '5 seconds'
        AND attempts < max_attempts
        ORDER BY priority ASC, scheduled_for ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, proxy_bid_request_id, scheduled_for, priority, attempts
    """

    case Repo.query(query, [executor_id]) do
      {:ok, %{rows: [[id, proxy_bid_id, scheduled_for, priority, attempts]], columns: _}} ->
        {:ok, %{
          id: id,
          proxy_bid_request_id: proxy_bid_id,
          scheduled_for: scheduled_for,
          priority: priority,
          attempts: attempts
        }}

      {:ok, %{rows: []}} ->
        {:error, :none_available}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp do_execute(execution_id, executor_id) do
    Logger.info("[BidExecutor] Executing #{execution_id}")

    # Update status to executing
    update_execution_status(execution_id, "executing")

    # Get execution details and proxy bid request
    with {:ok, execution} <- get_execution_details(execution_id),
         {:ok, proxy_bid} <- get_proxy_bid_request(execution.proxy_bid_request_id),
         {:ok, session} <- SessionPool.get_session(proxy_bid.user_id, proxy_bid.platform),
         :ok <- RateLimiter.check_rate_limit(proxy_bid.platform, :bid) do

      adapter = get_platform_adapter(proxy_bid.platform)

      # Get current auction state
      case adapter.get_auction_state(session, proxy_bid.external_auction_url) do
        {:ok, auction_state} ->
          execute_bid_logic(execution, proxy_bid, session, adapter, auction_state)

        {:error, :auction_ended} ->
          complete_execution(execution_id, false, %{error: "auction_ended"}, "Auction has ended")
          update_proxy_bid_status(proxy_bid.id, "lost")
          {:error, :auction_ended}

        {:error, reason} ->
          handle_execution_error(execution_id, execution.attempts, reason)
      end
    else
      {:error, reason} ->
        handle_execution_error(execution_id, 0, reason)
    end
  end

  defp execute_bid_logic(execution, proxy_bid, session, adapter, auction_state) do
    current_bid = auction_state.current_bid_cents
    our_max_bid = proxy_bid.max_bid_cents
    minimum_bid = auction_state.minimum_bid_cents || (current_bid + auction_state.bid_increment_cents)

    cond do
      # Already winning
      auction_state.high_bidder_username == get_our_username(session) ->
        Logger.info("[BidExecutor] Already winning, no bid needed")
        complete_execution(execution.id, true, %{already_winning: true}, nil)
        update_proxy_bid_status(proxy_bid.id, "winning")
        {:ok, %{already_winning: true}}

      # Our max bid is below current + increment
      our_max_bid < minimum_bid ->
        Logger.info("[BidExecutor] Max bid reached: $#{our_max_bid / 100} < minimum $#{minimum_bid / 100}")
        complete_execution(execution.id, true, %{max_reached: true, current_bid: current_bid}, nil)
        update_proxy_bid_status(proxy_bid.id, "outbid")
        {:ok, %{max_reached: true}}

      # Place bid
      true ->
        # Calculate our bid amount
        bid_amount = calculate_bid_amount(current_bid, our_max_bid, auction_state)

        Logger.info("[BidExecutor] Placing bid: $#{bid_amount / 100} (max: $#{our_max_bid / 100})")

        case adapter.place_bid(session, proxy_bid.external_auction_url, bid_amount) do
          {:ok, result} ->
            handle_bid_result(execution.id, proxy_bid, result, auction_state)

          {:error, reason} ->
            handle_execution_error(execution.id, execution.attempts, reason)
        end
    end
  end

  defp handle_bid_result(execution_id, proxy_bid, result, auction_state) do
    Logger.info("[BidExecutor] Bid result: #{inspect(result)}")

    # Log to execution_log in proxy_bid_requests
    log_bid_action(proxy_bid.id, %{
      action: "bid_placed",
      amount_cents: result.bid_amount_cents,
      is_high_bidder: result.is_high_bidder,
      timestamp: DateTime.utc_now()
    })

    # Update auction state cache
    AuctionSyncCoordinator.update_state(proxy_bid.external_listing_id, auction_state)

    if result.is_high_bidder do
      complete_execution(execution_id, true, result, nil)
      update_proxy_bid_status(proxy_bid.id, "winning", result.bid_amount_cents)
      {:ok, result}
    else
      complete_execution(execution_id, true, result, "Outbid immediately")
      update_proxy_bid_status(proxy_bid.id, "outbid", result.bid_amount_cents)
      {:ok, result}
    end
  end

  defp handle_execution_error(execution_id, attempts, reason) do
    Logger.error("[BidExecutor] Execution #{execution_id} failed: #{inspect(reason)}")

    max_attempts = 3

    if attempts + 1 < max_attempts do
      # Schedule retry with exponential backoff
      retry_delay = :math.pow(2, attempts + 1) |> round() |> Kernel.*(1000)
      schedule_retry(execution_id, retry_delay)
      {:error, :retrying}
    else
      complete_execution(execution_id, false, %{error: reason}, inspect(reason))
      {:error, reason}
    end
  end

  defp calculate_bid_amount(current_bid, max_bid, auction_state) do
    increment = auction_state.bid_increment_cents || calculate_default_increment(current_bid)
    minimum = current_bid + increment

    # Bid the minimum needed, up to our max
    min(minimum, max_bid)
  end

  defp calculate_default_increment(current_bid) do
    cond do
      current_bid < 10_000_00 -> 250_00
      current_bid < 25_000_00 -> 500_00
      current_bid < 100_000_00 -> 1000_00
      true -> 2500_00
    end
  end

  defp get_our_username(session) do
    session[:platform_username]
  end

  defp get_execution_details(execution_id) do
    query = """
      SELECT id, proxy_bid_request_id, scheduled_for, priority, attempts, max_attempts
      FROM bid_execution_queue
      WHERE id = $1
    """

    case Repo.query(query, [execution_id]) do
      {:ok, %{rows: [[id, proxy_bid_id, scheduled_for, priority, attempts, max_attempts]], columns: _}} ->
        {:ok, %{
          id: id,
          proxy_bid_request_id: proxy_bid_id,
          scheduled_for: scheduled_for,
          priority: priority,
          attempts: attempts,
          max_attempts: max_attempts
        }}

      {:ok, %{rows: []}} ->
        {:error, :not_found}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp get_proxy_bid_request(proxy_bid_id) do
    query = """
      SELECT id, user_id, external_listing_id, platform, external_auction_url,
             max_bid_cents, bid_strategy, status
      FROM proxy_bid_requests
      WHERE id = $1
    """

    case Repo.query(query, [proxy_bid_id]) do
      {:ok, %{rows: [[id, user_id, listing_id, platform, url, max_bid, strategy, status]], columns: _}} ->
        {:ok, %{
          id: id,
          user_id: user_id,
          external_listing_id: listing_id,
          platform: platform,
          external_auction_url: url,
          max_bid_cents: max_bid,
          bid_strategy: strategy,
          status: status
        }}

      {:ok, %{rows: []}} ->
        {:error, :not_found}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp update_execution_status(execution_id, status) do
    query = """
      UPDATE bid_execution_queue
      SET status = $2, updated_at = NOW()
      WHERE id = $1
    """

    Repo.query(query, [execution_id, status])
  end

  defp complete_execution(execution_id, success, result_data, error_message) do
    status = if success, do: "completed", else: "failed"

    query = """
      UPDATE bid_execution_queue
      SET status = $2,
          result_data = $3,
          error_message = $4,
          attempts = attempts + 1,
          last_attempt_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
    """

    Repo.query(query, [execution_id, status, result_data, error_message])
  end

  defp schedule_retry(execution_id, delay_ms) do
    next_retry = DateTime.add(DateTime.utc_now(), delay_ms, :millisecond)

    query = """
      UPDATE bid_execution_queue
      SET status = 'queued',
          locked_by = NULL,
          locked_at = NULL,
          attempts = attempts + 1,
          last_attempt_at = NOW(),
          next_retry_at = $2,
          scheduled_for = $2,
          updated_at = NOW()
      WHERE id = $1
    """

    Repo.query(query, [execution_id, next_retry])
  end

  defp release_lock(execution_id) do
    query = """
      UPDATE bid_execution_queue
      SET status = 'queued',
          locked_by = NULL,
          locked_at = NULL,
          updated_at = NOW()
      WHERE id = $1
    """

    Repo.query(query, [execution_id])
  end

  defp cancel_queued_execution(execution_id) do
    query = """
      UPDATE bid_execution_queue
      SET status = 'cancelled', updated_at = NOW()
      WHERE id = $1 AND status = 'queued'
      RETURNING id
    """

    case Repo.query(query, [execution_id]) do
      {:ok, %{rows: [[_]]}} -> :ok
      {:ok, %{rows: []}} -> {:error, :not_found_or_not_queued}
      {:error, reason} -> {:error, reason}
    end
  end

  defp update_proxy_bid_status(proxy_bid_id, status, current_bid \\ nil) do
    query = if current_bid do
      """
        UPDATE proxy_bid_requests
        SET status = $2, current_bid_cents = $3, updated_at = NOW()
        WHERE id = $1
      """
    else
      """
        UPDATE proxy_bid_requests
        SET status = $2, updated_at = NOW()
        WHERE id = $1
      """
    end

    args = if current_bid, do: [proxy_bid_id, status, current_bid], else: [proxy_bid_id, status]
    Repo.query(query, args)
  end

  defp log_bid_action(proxy_bid_id, action) do
    query = """
      UPDATE proxy_bid_requests
      SET execution_log = execution_log || $2::jsonb,
          updated_at = NOW()
      WHERE id = $1
    """

    Repo.query(query, [proxy_bid_id, [action]])
  end

  defp pop_by_ref(map, ref) do
    case Enum.find(map, fn {_, task_ref} -> task_ref == ref end) do
      {id, _} -> {id, Map.delete(map, id)}
      nil -> {nil, map}
    end
  end

  defp get_platform_adapter(platform) do
    case platform do
      "bat" -> NukeApi.Bidding.Platforms.Bat
      "cars_and_bids" -> NukeApi.Bidding.Platforms.CarsAndBids
      _ -> raise "Unknown platform: #{platform}"
    end
  end
end
