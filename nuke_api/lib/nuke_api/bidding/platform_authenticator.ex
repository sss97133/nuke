defmodule NukeApi.Bidding.PlatformAuthenticator do
  @moduledoc """
  Handles authentication flows for external auction platforms.

  Supports:
  - Basic username/password login
  - Automated TOTP 2FA (when user provides TOTP secret)
  - Manual 2FA flow (creates pending request for user to enter code)
  """

  use GenServer
  require Logger

  alias NukeApi.Bidding.{CredentialManager, RateLimiter}
  alias NukeApi.Repo

  @two_fa_timeout_seconds 300  # 5 minutes for manual 2FA

  # Client API

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc """
  Authenticates a user on a platform.

  Returns {:ok, session} on success.
  Returns {:error, :2fa_pending} if manual 2FA input is required.
  Returns {:error, reason} on failure.
  """
  @spec authenticate(String.t(), String.t()) :: {:ok, map()} | {:error, term()}
  def authenticate(user_id, platform) do
    GenServer.call(__MODULE__, {:authenticate, user_id, platform}, 60_000)
  end

  @doc """
  Submits a 2FA code for a pending authentication.
  """
  @spec submit_2fa_code(String.t(), String.t()) :: {:ok, map()} | {:error, term()}
  def submit_2fa_code(request_id, code) do
    GenServer.call(__MODULE__, {:submit_2fa_code, request_id, code}, 30_000)
  end

  @doc """
  Gets the pending 2FA request for a user/platform.
  """
  @spec get_pending_2fa(String.t(), String.t()) :: {:ok, map()} | {:error, :not_found}
  def get_pending_2fa(user_id, platform) do
    GenServer.call(__MODULE__, {:get_pending_2fa, user_id, platform})
  end

  @doc """
  Validates an existing session with the platform.
  """
  @spec validate_session(String.t(), String.t()) :: {:ok, boolean()} | {:error, term()}
  def validate_session(user_id, platform) do
    GenServer.call(__MODULE__, {:validate_session, user_id, platform}, 30_000)
  end

  # GenServer callbacks

  @impl true
  def init(_opts) do
    Logger.info("PlatformAuthenticator started")
    {:ok, %{pending_2fa: %{}}}
  end

  @impl true
  def handle_call({:authenticate, user_id, platform}, _from, state) do
    result = do_authenticate(user_id, platform, state)
    {:reply, result, state}
  end

  @impl true
  def handle_call({:submit_2fa_code, request_id, code}, _from, state) do
    result = do_submit_2fa_code(request_id, code)
    {:reply, result, state}
  end

  @impl true
  def handle_call({:get_pending_2fa, user_id, platform}, _from, state) do
    result = do_get_pending_2fa(user_id, platform)
    {:reply, result, state}
  end

  @impl true
  def handle_call({:validate_session, user_id, platform}, _from, state) do
    result = do_validate_session(user_id, platform)
    {:reply, result, state}
  end

  # Implementation

  defp do_authenticate(user_id, platform, _state) do
    Logger.info("[PlatformAuth] Starting authentication for #{platform}/#{user_id}")

    with {:ok, cred_data} <- CredentialManager.get_credentials(user_id, platform),
         :ok <- RateLimiter.check_rate_limit(platform, :auth),
         adapter <- get_platform_adapter(platform) do

      # Update status to validating
      CredentialManager.update_status(cred_data.id, "validating")

      case adapter.login(cred_data.credentials) do
        {:ok, session} ->
          # Login successful
          save_session(cred_data.id, session)
          CredentialManager.update_status(cred_data.id, "active")
          Logger.info("[PlatformAuth] Login successful for #{platform}/#{user_id}")
          {:ok, session}

        {:error, {:2fa_required, challenge}} ->
          # 2FA required
          handle_2fa_challenge(cred_data, challenge, adapter)

        {:error, :invalid_credentials} ->
          CredentialManager.update_status(cred_data.id, "invalid", "Invalid username or password")
          Logger.warn("[PlatformAuth] Invalid credentials for #{platform}/#{user_id}")
          {:error, :invalid_credentials}

        {:error, reason} ->
          CredentialManager.update_status(cred_data.id, "expired", inspect(reason))
          Logger.error("[PlatformAuth] Login failed for #{platform}/#{user_id}: #{inspect(reason)}")
          {:error, reason}
      end
    end
  end

  defp handle_2fa_challenge(cred_data, challenge, adapter) do
    Logger.info("[PlatformAuth] 2FA required for #{cred_data.platform}/#{cred_data.user_id}")

    # Check if we have TOTP secret for automated 2FA
    case CredentialManager.get_totp_secret(cred_data.id) do
      {:ok, totp_secret} ->
        # Generate TOTP code automatically
        code = generate_totp_code(totp_secret)
        Logger.info("[PlatformAuth] Auto-generating TOTP code")

        # Need a partial session to complete 2FA
        partial_session = %{
          cookies: %{},
          user_agent: "Mozilla/5.0",
          token: nil,
          expires_at: nil,
          platform_user_id: nil,
          platform_username: nil
        }

        case adapter.handle_2fa(partial_session, challenge.method, code) do
          {:ok, session} ->
            save_session(cred_data.id, session)
            CredentialManager.update_status(cred_data.id, "active")
            {:ok, session}

          {:error, reason} ->
            Logger.warn("[PlatformAuth] Automated 2FA failed: #{inspect(reason)}")
            # Fall back to manual 2FA
            create_pending_2fa_request(cred_data, challenge)
        end

      {:error, :no_totp_configured} ->
        # No TOTP secret, create manual 2FA request
        create_pending_2fa_request(cred_data, challenge)

      {:error, reason} ->
        Logger.error("[PlatformAuth] Failed to get TOTP secret: #{inspect(reason)}")
        create_pending_2fa_request(cred_data, challenge)
    end
  end

  defp create_pending_2fa_request(cred_data, challenge) do
    expires_at = DateTime.add(DateTime.utc_now(), @two_fa_timeout_seconds, :second)

    query = """
      INSERT INTO pending_2fa_requests (credential_id, method, challenge_data, expires_at, status)
      VALUES ($1, $2, $3, $4, 'pending')
      RETURNING id
    """

    case Repo.query(query, [
      cred_data.id,
      challenge.method,
      challenge.challenge_data,
      expires_at
    ]) do
      {:ok, %{rows: [[request_id]]}} ->
        CredentialManager.update_status(cred_data.id, "2fa_required")
        Logger.info("[PlatformAuth] Created pending 2FA request: #{request_id}")

        # TODO: Send push notification to user

        {:error, {:2fa_pending, %{
          request_id: request_id,
          method: challenge.method,
          challenge_data: challenge.challenge_data,
          expires_at: expires_at
        }}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp do_submit_2fa_code(request_id, code) do
    Logger.info("[PlatformAuth] Submitting 2FA code for request: #{request_id}")

    # Get the pending request and credential
    query = """
      SELECT p2fa.id, p2fa.credential_id, p2fa.method, p2fa.status, p2fa.expires_at,
             pc.platform, pc.user_id
      FROM pending_2fa_requests p2fa
      JOIN platform_credentials pc ON pc.id = p2fa.credential_id
      WHERE p2fa.id = $1
    """

    case Repo.query(query, [request_id]) do
      {:ok, %{rows: [[id, credential_id, method, status, expires_at, platform, user_id]], columns: _}} ->
        cond do
          status != "pending" ->
            {:error, :request_already_processed}

          DateTime.compare(expires_at, DateTime.utc_now()) == :lt ->
            update_2fa_status(id, "expired")
            {:error, :code_expired}

          true ->
            # Update status to submitted
            update_2fa_status(id, "submitted", code)

            # Attempt 2FA verification
            case CredentialManager.get_credentials(user_id, platform) do
              {:ok, cred_data} ->
                adapter = get_platform_adapter(platform)

                partial_session = %{
                  cookies: cred_data.session[:cookies] || %{},
                  user_agent: "Mozilla/5.0",
                  token: nil,
                  expires_at: nil,
                  platform_user_id: nil,
                  platform_username: nil
                }

                case adapter.handle_2fa(partial_session, method, code) do
                  {:ok, session} ->
                    update_2fa_status(id, "verified")
                    save_session(credential_id, session)
                    CredentialManager.update_status(credential_id, "active")
                    Logger.info("[PlatformAuth] 2FA successful for #{platform}/#{user_id}")
                    {:ok, session}

                  {:error, :invalid_code} ->
                    update_2fa_status(id, "failed")
                    {:error, :invalid_code}

                  {:error, reason} ->
                    update_2fa_status(id, "failed")
                    {:error, reason}
                end

              {:error, reason} ->
                {:error, reason}
            end
        end

      {:ok, %{rows: []}} ->
        {:error, :request_not_found}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp do_get_pending_2fa(user_id, platform) do
    query = """
      SELECT p2fa.id, p2fa.method, p2fa.challenge_data, p2fa.expires_at
      FROM pending_2fa_requests p2fa
      JOIN platform_credentials pc ON pc.id = p2fa.credential_id
      WHERE pc.user_id = $1 AND pc.platform = $2
      AND p2fa.status = 'pending'
      AND p2fa.expires_at > NOW()
      ORDER BY p2fa.created_at DESC
      LIMIT 1
    """

    case Repo.query(query, [user_id, platform]) do
      {:ok, %{rows: [[id, method, challenge_data, expires_at]], columns: _}} ->
        {:ok, %{
          request_id: id,
          method: method,
          challenge_data: challenge_data,
          expires_at: expires_at
        }}

      {:ok, %{rows: []}} ->
        {:error, :not_found}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp do_validate_session(user_id, platform) do
    case CredentialManager.get_credentials(user_id, platform) do
      {:ok, %{session: nil}} ->
        {:ok, false}

      {:ok, %{session: session}} ->
        adapter = get_platform_adapter(platform)
        {:ok, adapter.validate_session(session)}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp save_session(credential_id, session) do
    session_data = %{
      token: session[:token],
      cookies: session[:cookies] && Jason.encode!(session[:cookies]),
      expires_at: session[:expires_at]
    }

    CredentialManager.update_session(credential_id, session_data)
  end

  defp update_2fa_status(request_id, status, code \\ nil) do
    query = if code do
      """
        UPDATE pending_2fa_requests
        SET status = $2, user_code = $3, submitted_at = NOW()
        WHERE id = $1
      """
    else
      """
        UPDATE pending_2fa_requests
        SET status = $2
        WHERE id = $1
      """
    end

    args = if code, do: [request_id, status, code], else: [request_id, status]
    Repo.query(query, args)
  end

  defp generate_totp_code(secret) do
    # Use NimbleTOTP for TOTP code generation
    NimbleTOTP.verification_code(secret)
  end

  defp get_platform_adapter(platform) do
    case platform do
      "bat" -> NukeApi.Bidding.Platforms.Bat
      "cars_and_bids" -> NukeApi.Bidding.Platforms.CarsAndBids
      "pcarmarket" -> NukeApi.Bidding.Platforms.PCarMarket
      "collecting_cars" -> NukeApi.Bidding.Platforms.CollectingCars
      _ -> raise "Unknown platform: #{platform}"
    end
  end
end
