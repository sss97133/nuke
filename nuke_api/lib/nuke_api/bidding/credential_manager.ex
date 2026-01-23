defmodule NukeApi.Bidding.CredentialManager do
  @moduledoc """
  Manages platform credentials with encryption and audit logging.

  All credential operations go through this module to ensure:
  - Proper encryption/decryption
  - Audit logging for security compliance
  - Session management
  """

  use GenServer
  require Logger

  alias NukeApi.Bidding.Crypto
  alias NukeApi.Repo

  import Ecto.Query

  @valid_platforms ~w(bat cars_and_bids pcarmarket collecting_cars broad_arrow rmsothebys gooding sbx ebay_motors)

  # Client API

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc """
  Stores encrypted credentials for a user/platform combination.
  """
  @spec store_credentials(String.t(), String.t(), map(), keyword()) ::
    {:ok, map()} | {:error, term()}
  def store_credentials(user_id, platform, credentials, opts \\ []) do
    GenServer.call(__MODULE__, {:store_credentials, user_id, platform, credentials, opts})
  end

  @doc """
  Retrieves and decrypts credentials for a user/platform.
  """
  @spec get_credentials(String.t(), String.t()) :: {:ok, map()} | {:error, term()}
  def get_credentials(user_id, platform) do
    GenServer.call(__MODULE__, {:get_credentials, user_id, platform})
  end

  @doc """
  Updates the session data for credentials (token, cookies, expiry).
  """
  @spec update_session(String.t(), map()) :: {:ok, map()} | {:error, term()}
  def update_session(credential_id, session_data) do
    GenServer.call(__MODULE__, {:update_session, credential_id, session_data})
  end

  @doc """
  Gets credentials by ID with decrypted session.
  """
  @spec get_credential_by_id(String.t()) :: {:ok, map()} | {:error, term()}
  def get_credential_by_id(credential_id) do
    GenServer.call(__MODULE__, {:get_credential_by_id, credential_id})
  end

  @doc """
  Updates credential status.
  """
  @spec update_status(String.t(), String.t(), String.t() | nil) ::
    {:ok, map()} | {:error, term()}
  def update_status(credential_id, status, error_message \\ nil) do
    GenServer.call(__MODULE__, {:update_status, credential_id, status, error_message})
  end

  @doc """
  Stores TOTP secret for automated 2FA.
  """
  @spec store_totp_secret(String.t(), String.t()) :: {:ok, map()} | {:error, term()}
  def store_totp_secret(credential_id, totp_secret) do
    GenServer.call(__MODULE__, {:store_totp_secret, credential_id, totp_secret})
  end

  @doc """
  Gets the TOTP secret for generating 2FA codes.
  """
  @spec get_totp_secret(String.t()) :: {:ok, String.t()} | {:error, term()}
  def get_totp_secret(credential_id) do
    GenServer.call(__MODULE__, {:get_totp_secret, credential_id})
  end

  @doc """
  Deletes credentials for a user/platform.
  """
  @spec delete_credentials(String.t(), String.t()) :: :ok | {:error, term()}
  def delete_credentials(user_id, platform) do
    GenServer.call(__MODULE__, {:delete_credentials, user_id, platform})
  end

  @doc """
  Lists all credentials for a user (without decrypting sensitive data).
  """
  @spec list_credentials(String.t()) :: {:ok, [map()]} | {:error, term()}
  def list_credentials(user_id) do
    GenServer.call(__MODULE__, {:list_credentials, user_id})
  end

  @doc """
  Checks if user has active credentials for a platform.
  """
  @spec has_active_credentials?(String.t(), String.t()) :: boolean()
  def has_active_credentials?(user_id, platform) do
    GenServer.call(__MODULE__, {:has_active_credentials, user_id, platform})
  end

  # GenServer callbacks

  @impl true
  def init(_opts) do
    case Crypto.verify_key_configured() do
      :ok ->
        Logger.info("CredentialManager started with encryption key configured")
        {:ok, %{}}

      {:error, reason} ->
        Logger.error("CredentialManager failed to start: #{inspect(reason)}")
        {:stop, reason}
    end
  end

  @impl true
  def handle_call({:store_credentials, user_id, platform, credentials, opts}, _from, state) do
    result = do_store_credentials(user_id, platform, credentials, opts)
    {:reply, result, state}
  end

  @impl true
  def handle_call({:get_credentials, user_id, platform}, _from, state) do
    result = do_get_credentials(user_id, platform)
    {:reply, result, state}
  end

  @impl true
  def handle_call({:update_session, credential_id, session_data}, _from, state) do
    result = do_update_session(credential_id, session_data)
    {:reply, result, state}
  end

  @impl true
  def handle_call({:get_credential_by_id, credential_id}, _from, state) do
    result = do_get_credential_by_id(credential_id)
    {:reply, result, state}
  end

  @impl true
  def handle_call({:update_status, credential_id, status, error_message}, _from, state) do
    result = do_update_status(credential_id, status, error_message)
    {:reply, result, state}
  end

  @impl true
  def handle_call({:store_totp_secret, credential_id, totp_secret}, _from, state) do
    result = do_store_totp_secret(credential_id, totp_secret)
    {:reply, result, state}
  end

  @impl true
  def handle_call({:get_totp_secret, credential_id}, _from, state) do
    result = do_get_totp_secret(credential_id)
    {:reply, result, state}
  end

  @impl true
  def handle_call({:delete_credentials, user_id, platform}, _from, state) do
    result = do_delete_credentials(user_id, platform)
    {:reply, result, state}
  end

  @impl true
  def handle_call({:list_credentials, user_id}, _from, state) do
    result = do_list_credentials(user_id)
    {:reply, result, state}
  end

  @impl true
  def handle_call({:has_active_credentials, user_id, platform}, _from, state) do
    result = do_has_active_credentials(user_id, platform)
    {:reply, result, state}
  end

  # Implementation functions

  defp do_store_credentials(user_id, platform, credentials, opts) do
    with :ok <- validate_platform(platform),
         :ok <- validate_credentials(credentials),
         {:ok, {ciphertext, iv, tag}} <- Crypto.encrypt_json(credentials) do

      totp_secret = Keyword.get(opts, :totp_secret)
      totp_encrypted = if totp_secret, do: encrypt_totp_secret(totp_secret), else: nil

      now = DateTime.utc_now()

      query = """
        INSERT INTO platform_credentials (
          user_id, platform, encrypted_credentials, encryption_iv, encryption_tag,
          requires_2fa, totp_secret_encrypted, status, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $8)
        ON CONFLICT (user_id, platform)
        DO UPDATE SET
          encrypted_credentials = EXCLUDED.encrypted_credentials,
          encryption_iv = EXCLUDED.encryption_iv,
          encryption_tag = EXCLUDED.encryption_tag,
          totp_secret_encrypted = COALESCE(EXCLUDED.totp_secret_encrypted, platform_credentials.totp_secret_encrypted),
          status = 'pending',
          validation_error = NULL,
          updated_at = $8
        RETURNING id, user_id, platform, status, requires_2fa, created_at, updated_at
      """

      case Repo.query(query, [
        user_id,
        platform,
        ciphertext,
        iv,
        tag,
        totp_secret != nil,
        totp_encrypted,
        now
      ]) do
        {:ok, %{rows: [row], columns: columns}} ->
          credential = Enum.zip(columns, row) |> Map.new()
          log_access(credential["id"], user_id, "created", platform, true)
          {:ok, credential}

        {:error, reason} ->
          Logger.error("Failed to store credentials: #{inspect(reason)}")
          {:error, reason}
      end
    end
  end

  defp do_get_credentials(user_id, platform) do
    query = """
      SELECT id, user_id, platform, encrypted_credentials, encryption_iv, encryption_tag,
             session_token_encrypted, session_expires_at, cookies_encrypted,
             status, requires_2fa, last_validated_at
      FROM platform_credentials
      WHERE user_id = $1 AND platform = $2
    """

    case Repo.query(query, [user_id, platform]) do
      {:ok, %{rows: [row], columns: columns}} ->
        credential = Enum.zip(columns, row) |> Map.new()
        decrypt_credential(credential, user_id)

      {:ok, %{rows: []}} ->
        {:error, :not_found}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp do_get_credential_by_id(credential_id) do
    query = """
      SELECT id, user_id, platform, encrypted_credentials, encryption_iv, encryption_tag,
             session_token_encrypted, session_expires_at, cookies_encrypted,
             status, requires_2fa, last_validated_at
      FROM platform_credentials
      WHERE id = $1
    """

    case Repo.query(query, [credential_id]) do
      {:ok, %{rows: [row], columns: columns}} ->
        credential = Enum.zip(columns, row) |> Map.new()
        decrypt_credential(credential, credential["user_id"])

      {:ok, %{rows: []}} ->
        {:error, :not_found}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp do_update_session(credential_id, session_data) do
    with {:ok, {token_encrypted, token_iv, token_tag}} <- encrypt_if_present(session_data[:token]),
         {:ok, {cookies_encrypted, cookies_iv, cookies_tag}} <- encrypt_if_present(session_data[:cookies]) do

      # Combine IV and tag with ciphertext for storage
      session_token = if token_encrypted, do: token_iv <> token_tag <> token_encrypted, else: nil
      cookies_blob = if cookies_encrypted, do: cookies_iv <> cookies_tag <> cookies_encrypted, else: nil

      query = """
        UPDATE platform_credentials
        SET session_token_encrypted = COALESCE($2, session_token_encrypted),
            session_expires_at = COALESCE($3, session_expires_at),
            cookies_encrypted = COALESCE($4, cookies_encrypted),
            status = 'active',
            last_validated_at = NOW(),
            validation_error = NULL,
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, user_id, platform, status, session_expires_at
      """

      case Repo.query(query, [
        credential_id,
        session_token,
        session_data[:expires_at],
        cookies_blob
      ]) do
        {:ok, %{rows: [row], columns: columns}} ->
          credential = Enum.zip(columns, row) |> Map.new()
          log_access(credential_id, credential["user_id"], "refreshed", credential["platform"], true)
          {:ok, credential}

        {:ok, %{rows: []}} ->
          {:error, :not_found}

        {:error, reason} ->
          {:error, reason}
      end
    end
  end

  defp do_update_status(credential_id, status, error_message) do
    query = """
      UPDATE platform_credentials
      SET status = $2,
          validation_error = $3,
          last_validated_at = CASE WHEN $2 = 'active' THEN NOW() ELSE last_validated_at END,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, user_id, platform, status
    """

    case Repo.query(query, [credential_id, status, error_message]) do
      {:ok, %{rows: [row], columns: columns}} ->
        credential = Enum.zip(columns, row) |> Map.new()
        log_access(credential_id, credential["user_id"], "validated", credential["platform"], status == "active")
        {:ok, credential}

      {:ok, %{rows: []}} ->
        {:error, :not_found}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp do_store_totp_secret(credential_id, totp_secret) do
    case encrypt_totp_secret(totp_secret) do
      nil ->
        {:error, :encryption_failed}

      encrypted ->
        query = """
          UPDATE platform_credentials
          SET totp_secret_encrypted = $2,
              requires_2fa = true,
              updated_at = NOW()
          WHERE id = $1
          RETURNING id, platform, requires_2fa
        """

        case Repo.query(query, [credential_id, encrypted]) do
          {:ok, %{rows: [row], columns: columns}} ->
            {:ok, Enum.zip(columns, row) |> Map.new()}

          {:ok, %{rows: []}} ->
            {:error, :not_found}

          {:error, reason} ->
            {:error, reason}
        end
    end
  end

  defp do_get_totp_secret(credential_id) do
    query = """
      SELECT totp_secret_encrypted, user_id
      FROM platform_credentials
      WHERE id = $1
    """

    case Repo.query(query, [credential_id]) do
      {:ok, %{rows: [[encrypted, user_id]]}} when not is_nil(encrypted) ->
        result = decrypt_totp_secret(encrypted)
        log_access(credential_id, user_id, "decrypted", nil, result != nil)
        if result, do: {:ok, result}, else: {:error, :decryption_failed}

      {:ok, %{rows: [[nil, _]]}} ->
        {:error, :no_totp_configured}

      {:ok, %{rows: []}} ->
        {:error, :not_found}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp do_delete_credentials(user_id, platform) do
    # Get credential ID for audit log
    id_query = "SELECT id FROM platform_credentials WHERE user_id = $1 AND platform = $2"

    case Repo.query(id_query, [user_id, platform]) do
      {:ok, %{rows: [[credential_id]]}} ->
        query = "DELETE FROM platform_credentials WHERE id = $1"
        case Repo.query(query, [credential_id]) do
          {:ok, _} ->
            log_access(credential_id, user_id, "deleted", platform, true)
            :ok
          {:error, reason} ->
            {:error, reason}
        end

      {:ok, %{rows: []}} ->
        {:error, :not_found}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp do_list_credentials(user_id) do
    query = """
      SELECT id, platform, status, requires_2fa, last_validated_at,
             session_expires_at, validation_error, created_at, updated_at
      FROM platform_credentials
      WHERE user_id = $1
      ORDER BY platform
    """

    case Repo.query(query, [user_id]) do
      {:ok, %{rows: rows, columns: columns}} ->
        credentials = Enum.map(rows, fn row ->
          Enum.zip(columns, row) |> Map.new()
        end)
        {:ok, credentials}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp do_has_active_credentials(user_id, platform) do
    query = """
      SELECT EXISTS (
        SELECT 1 FROM platform_credentials
        WHERE user_id = $1 AND platform = $2 AND status = 'active'
      )
    """

    case Repo.query(query, [user_id, platform]) do
      {:ok, %{rows: [[true]]}} -> true
      _ -> false
    end
  end

  # Helper functions

  defp validate_platform(platform) do
    if platform in @valid_platforms do
      :ok
    else
      {:error, {:invalid_platform, platform}}
    end
  end

  defp validate_credentials(credentials) do
    cond do
      not is_map(credentials) ->
        {:error, :invalid_credentials_format}

      not Map.has_key?(credentials, "username") and not Map.has_key?(credentials, :username) ->
        {:error, :missing_username}

      not Map.has_key?(credentials, "password") and not Map.has_key?(credentials, :password) ->
        {:error, :missing_password}

      true ->
        :ok
    end
  end

  defp decrypt_credential(credential, user_id) do
    with {:ok, creds} <- Crypto.decrypt_json(
           credential["encrypted_credentials"],
           credential["encryption_iv"],
           credential["encryption_tag"]
         ) do
      log_access(credential["id"], user_id, "decrypted", credential["platform"], true)

      # Decrypt session if present
      session = decrypt_session_data(credential)

      {:ok, %{
        id: credential["id"],
        user_id: credential["user_id"],
        platform: credential["platform"],
        credentials: creds,
        session: session,
        status: credential["status"],
        requires_2fa: credential["requires_2fa"],
        last_validated_at: credential["last_validated_at"]
      }}
    else
      {:error, reason} ->
        log_access(credential["id"], user_id, "decrypted", credential["platform"], false)
        {:error, {:decryption_failed, reason}}
    end
  end

  defp decrypt_session_data(credential) do
    token = decrypt_combined_blob(credential["session_token_encrypted"])
    cookies = decrypt_combined_blob(credential["cookies_encrypted"])

    if token || cookies do
      %{
        token: token,
        cookies: cookies,
        expires_at: credential["session_expires_at"]
      }
    else
      nil
    end
  end

  defp decrypt_combined_blob(nil), do: nil
  defp decrypt_combined_blob(blob) when byte_size(blob) < @iv_size + @tag_size, do: nil
  defp decrypt_combined_blob(blob) do
    <<iv::binary-size(12), tag::binary-size(16), ciphertext::binary>> = blob
    case Crypto.decrypt(ciphertext, iv, tag) do
      {:ok, plaintext} -> plaintext
      _ -> nil
    end
  end

  @iv_size 12
  @tag_size 16

  defp encrypt_if_present(nil), do: {:ok, {nil, nil, nil}}
  defp encrypt_if_present(data) when is_binary(data), do: Crypto.encrypt(data)
  defp encrypt_if_present(data) when is_map(data) do
    case Jason.encode(data) do
      {:ok, json} -> Crypto.encrypt(json)
      error -> error
    end
  end

  defp encrypt_totp_secret(nil), do: nil
  defp encrypt_totp_secret(secret) do
    case Crypto.encrypt(secret) do
      {:ok, {ciphertext, iv, tag}} -> iv <> tag <> ciphertext
      _ -> nil
    end
  end

  defp decrypt_totp_secret(blob) when byte_size(blob) < @iv_size + @tag_size, do: nil
  defp decrypt_totp_secret(blob) do
    <<iv::binary-size(12), tag::binary-size(16), ciphertext::binary>> = blob
    case Crypto.decrypt(ciphertext, iv, tag) do
      {:ok, secret} -> secret
      _ -> nil
    end
  end

  defp log_access(credential_id, user_id, action, platform, success) do
    query = """
      INSERT INTO credential_access_log (credential_id, user_id, action, platform, success, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
    """

    # Fire and forget - don't block on audit logging
    Task.start(fn ->
      Repo.query(query, [credential_id, user_id, action, platform, success])
    end)
  end
end
