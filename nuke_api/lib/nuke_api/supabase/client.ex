defmodule NukeApi.Supabase.Client do
  @moduledoc """
  Client module for interacting with Supabase APIs.
  Handles authentication, data retrieval, and mutation operations for vehicle-centric operations.
  """
  
  use GenServer
  require Logger
  alias HTTPoison.Response
  # Joken uses JOSE under the hood. We use both directly for JWKS-based verification.
  alias Joken.Signer
  alias JOSE.JWK

  # Client API

  @doc """
  Starts the Supabase client with configuration.
  """
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc """
  Gets configuration from the environment.
  """
  def config do
    %{
      url: get_env(:url),
      api_key: get_env(:api_key),
      jwt_secret: get_env(:jwt_secret)
    }
  end

  @doc """
  Performs a GET request to Supabase REST API.
  """
  def get(path, headers \\ []) do
    url = config().url <> path
    headers = build_headers(headers)
    
    HTTPoison.get(url, headers)
    |> handle_response()
  end

  @doc """
  Performs a POST request to Supabase REST API.
  """
  def post(path, body, headers \\ []) do
    url = config().url <> path
    headers = build_headers(headers)
    body = Jason.encode!(body)
    
    HTTPoison.post(url, body, headers)
    |> handle_response()
  end

  @doc """
  Performs a PUT request to Supabase REST API.
  """
  def put(path, body, headers \\ []) do
    url = config().url <> path
    headers = build_headers(headers)
    body = Jason.encode!(body)
    
    HTTPoison.put(url, body, headers)
    |> handle_response()
  end

  @doc """
  Performs a DELETE request to Supabase REST API.
  """
  def delete(path, headers \\ []) do
    url = config().url <> path
    headers = build_headers(headers)

    HTTPoison.delete(url, headers)
    |> handle_response()
  end

  @doc """
  Executes a SQL query using Supabase's PostgREST RPC functionality.
  """
  def query(sql, params \\ []) do
    # For now, we'll use the Postgrex connection directly for SQL queries
    # This connects to your existing database configuration
    case Application.get_env(:nuke_api, NukeApi.Repo) do
      nil -> {:error, "Database configuration not found"}
      _config ->
        try do
          result = Ecto.Adapters.SQL.query!(NukeApi.Repo, sql, params)
          {:ok, %{"rows" => result.rows, "columns" => result.columns}}
        rescue
          error -> {:error, inspect(error)}
        end
    end
  end

  @doc """
  Verifies a JWT token from Supabase.
  """
  def verify_token(token) do
    case get_token_header(token) do
      {:ok, %{"alg" => alg} = header} when alg in ["ES256", "RS256"] ->
        case verify_with_jwks(token, alg, Map.get(header, "kid")) do
          {:ok, claims} -> {:ok, claims}
          {:error, jwks_reason} ->
            Logger.warning("JWKS verification failed (#{alg}): #{inspect(jwks_reason)}. Trying HS256 fallback if configured.")
            verify_with_hs256_fallback(token)
        end

      {:ok, %{"alg" => "HS256"}} ->
        verify_with_hs256_fallback(token)

      {:ok, %{"alg" => other}} ->
        Logger.warning("Unexpected JWT alg '#{other}'. Attempting JWKS verification by default.")
        verify_with_jwks(token, other, nil)

      {:error, :invalid_jwt} ->
        # Silently fail for invalid JWT format during development
        {:error, :invalid_token}
    end
  end

  # Server Callbacks

  @impl true
  def init(_opts) do
    # Initialize state with configuration
    {:ok, %{config: config()}}
  end

  # Private functions

  defp get_env(key) do
    Application.get_env(:nuke_api, :supabase)[key]
  end

  defp build_headers(additional_headers) do
    [
      {"apikey", config().api_key},
      {"Content-Type", "application/json"},
      {"Accept", "application/json"}
    ] ++ additional_headers
  end

  defp handle_response({:ok, %Response{status_code: status, body: body}}) when status in 200..299 do
    case Jason.decode(body) do
      {:ok, decoded} -> {:ok, decoded}
      {:error, _} -> {:ok, body}
    end
  end

  defp handle_response({:ok, %Response{status_code: status, body: body}}) do
    error = case Jason.decode(body) do
      {:ok, decoded} -> decoded
      {:error, _} -> body
    end

    {:error, %{status: status, error: error}}
  end

  defp handle_response({:error, %HTTPoison.Error{reason: reason}}) do
    {:error, %{reason: reason}}
  end

  # ===== Internal helpers =====

  # Attempt HS256 verification only if a jwt_secret is configured.
  defp verify_with_hs256_fallback(token) do
    case get_hs256_signer() do
      {:ok, signer} ->
        case Joken.verify(token, signer) do
          {:ok, claims} -> {:ok, claims}
          {:error, reason} ->
            Logger.error("HS256 verification failed: #{inspect(reason)}")
            {:error, :invalid_token}
        end
      {:error, :missing_jwt_secret} ->
        {:error, :invalid_token}
    end
  end

  defp get_hs256_signer do
    secret = config().jwt_secret
    if is_nil(secret) or secret == "" do
      {:error, :missing_jwt_secret}
    else
      {:ok, Signer.create("HS256", secret)}
    end
  end

  # Parse JWT header (first part) without verifying the signature.
  defp get_token_header(token) do
    with [header_b64 | _] <- String.split(token, "."),
         {:ok, header_json} <- Base.url_decode64(header_b64, padding: false),
         {:ok, header_map} <- Jason.decode(header_json) do
      {:ok, header_map}
    else
      _ -> {:error, :invalid_jwt}
    end
  end

  # Verify using Supabase JWKS (supports ES256/RS256)
  defp verify_with_jwks(token, alg, kid) do
    with {:ok, jwks} <- fetch_jwks(),
         {:ok, jwk_map} <- pick_jwk(jwks, alg, kid),
         jose_jwk <- JWK.from_map(jwk_map),
         signer <- Signer.create(alg, jose_jwk),
         {:ok, claims} <- Joken.verify(token, signer) do
      {:ok, claims}
    else
      {:error, reason} -> {:error, reason}
      other -> {:error, {:jwks_unexpected, other}}
    end
  end

  # Select a JWK by kid or by matching kty/curve suitable for the alg.
  defp pick_jwk(%{"keys" => keys}, alg, kid) when is_list(keys) do
    chosen =
      case kid do
        nil ->
          Enum.find(keys, fn k -> matches_alg?(k, alg) end)
        _ ->
          Enum.find(keys, fn k -> k["kid"] == kid end) || Enum.find(keys, fn k -> matches_alg?(k, alg) end)
      end

    if chosen, do: {:ok, chosen}, else: {:error, :jwk_not_found}
  end
  defp pick_jwk(_, _alg, _kid), do: {:error, :invalid_jwks}

  defp matches_alg?(%{"kty" => "EC", "crv" => crv}, "ES256"), do: crv in ["P-256", "secp256r1"]
  defp matches_alg?(%{"kty" => "RSA"}, "RS256"), do: true
  defp matches_alg?(_k, _alg), do: false

  # Fetch and cache JWKS for 10 minutes using persistent_term
  defp fetch_jwks do
    cache_key = {__MODULE__, :jwks}
    ttl_secs = 600

    case :persistent_term.get(cache_key, :not_found) do
      {:jwks, jwks, fetched_at} ->
        if System.system_time(:second) - fetched_at < ttl_secs do
          {:ok, jwks}
        else
          do_fetch_jwks(cache_key)
        end
      :not_found -> do_fetch_jwks(cache_key)
    end
  end

  defp do_fetch_jwks(cache_key) do
    url = jwks_url()
    case HTTPoison.get(url, [{"Accept", "application/json"}], follow_redirect: true) do
      {:ok, %Response{status_code: 200, body: body}} ->
        case Jason.decode(body) do
          {:ok, jwks} ->
            :persistent_term.put(cache_key, {:jwks, jwks, System.system_time(:second)})
            {:ok, jwks}
          {:error, err} ->
            Logger.error("Failed to decode JWKS JSON: #{inspect(err)}")
            {:error, :invalid_jwks}
        end
      {:ok, %Response{status_code: code, body: body}} ->
        Logger.error("Failed to fetch JWKS (status #{code}): #{inspect(body)}")
        {:error, :jwks_fetch_failed}
      {:error, %HTTPoison.Error{reason: reason}} ->
        Logger.error("HTTP error fetching JWKS: #{inspect(reason)}")
        {:error, :jwks_http_error}
    end
  end

  defp jwks_url do
    base = config().url |> String.trim_trailing("/")
    base <> "/auth/v1/.well-known/jwks.json"
  end
end
