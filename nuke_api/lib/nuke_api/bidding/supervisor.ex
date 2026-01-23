defmodule NukeApi.Bidding.Supervisor do
  @moduledoc """
  Supervisor for the automated bidding system.

  Supervision tree:
  - CredentialManager: Encrypt/decrypt platform credentials
  - RateLimiter: Per-platform rate limiting
  - SessionPool: Maintain authenticated sessions
  - PlatformAuthenticator: Login/2FA flows
  - AuctionSyncCoordinator: Real-time auction polling
  - BidExecutor: Execute bids from queue
  - SniperScheduler: Schedule snipe bids

  All processes restart independently on failure.
  """

  use Supervisor
  require Logger

  def start_link(opts \\ []) do
    Supervisor.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(_opts) do
    children = [
      # Core infrastructure (must start first)
      {NukeApi.Bidding.RateLimiter, []},
      {NukeApi.Bidding.CredentialManager, []},

      # Authentication layer
      {NukeApi.Bidding.SessionPool, []},
      {NukeApi.Bidding.PlatformAuthenticator, []},

      # Bidding execution
      {NukeApi.Bidding.AuctionSyncCoordinator, []},
      {NukeApi.Bidding.BidExecutor, []},
      {NukeApi.Bidding.SniperScheduler, []}
    ]

    Logger.info("Starting Bidding Supervisor with #{length(children)} children")

    # Use one_for_one strategy - if a child crashes, only that child restarts
    # This prevents cascading failures
    Supervisor.init(children, strategy: :one_for_one)
  end

  @doc """
  Returns the current status of all bidding system components.
  """
  def status do
    children = Supervisor.which_children(__MODULE__)

    Enum.map(children, fn {id, pid, type, _modules} ->
      status = if is_pid(pid) and Process.alive?(pid), do: :running, else: :stopped

      %{
        id: id,
        pid: pid,
        type: type,
        status: status
      }
    end)
  end

  @doc """
  Restarts a specific child process.
  """
  def restart_child(child_id) do
    Supervisor.terminate_child(__MODULE__, child_id)
    Supervisor.restart_child(__MODULE__, child_id)
  end

  @doc """
  Gets comprehensive stats from all components.
  """
  def get_all_stats do
    %{
      rate_limiter: safe_call(NukeApi.Bidding.RateLimiter, :get_all_stats, []),
      session_pool: safe_call(NukeApi.Bidding.SessionPool, :get_stats, []),
      bid_executor: safe_call(NukeApi.Bidding.BidExecutor, :get_stats, []),
      auction_sync: safe_call(NukeApi.Bidding.AuctionSyncCoordinator, :get_stats, []),
      sniper_scheduler: safe_call(NukeApi.Bidding.SniperScheduler, :get_stats, [])
    }
  end

  defp safe_call(module, function, args) do
    try do
      apply(module, function, args)
    rescue
      _ -> %{error: "unavailable"}
    catch
      :exit, _ -> %{error: "unavailable"}
    end
  end
end
