defmodule NukeApi.Bidding.Crypto do
  @moduledoc """
  AES-256-GCM encryption for platform credentials.

  Uses a master key from environment variable CREDENTIAL_ENCRYPTION_KEY.
  Each encrypted record has a unique IV (initialization vector) and
  authentication tag for integrity verification.
  """

  @aes_key_size 32  # 256 bits
  @iv_size 12       # 96 bits for GCM
  @tag_size 16      # 128 bits

  @doc """
  Encrypts plaintext using AES-256-GCM.

  Returns {:ok, {ciphertext, iv, tag}} or {:error, reason}.
  """
  @spec encrypt(binary()) :: {:ok, {binary(), binary(), binary()}} | {:error, term()}
  def encrypt(plaintext) when is_binary(plaintext) do
    with {:ok, key} <- get_encryption_key(),
         iv <- :crypto.strong_rand_bytes(@iv_size) do
      case :crypto.crypto_one_time_aead(:aes_256_gcm, key, iv, plaintext, <<>>, @tag_size, true) do
        {ciphertext, tag} ->
          {:ok, {ciphertext, iv, tag}}
        error ->
          {:error, {:encryption_failed, error}}
      end
    end
  end

  @doc """
  Encrypts a map/struct as JSON using AES-256-GCM.
  """
  @spec encrypt_json(map()) :: {:ok, {binary(), binary(), binary()}} | {:error, term()}
  def encrypt_json(data) when is_map(data) do
    case Jason.encode(data) do
      {:ok, json} -> encrypt(json)
      {:error, reason} -> {:error, {:json_encode_failed, reason}}
    end
  end

  @doc """
  Decrypts ciphertext using AES-256-GCM.

  Returns {:ok, plaintext} or {:error, reason}.
  """
  @spec decrypt(binary(), binary(), binary()) :: {:ok, binary()} | {:error, term()}
  def decrypt(ciphertext, iv, tag) when is_binary(ciphertext) and is_binary(iv) and is_binary(tag) do
    with {:ok, key} <- get_encryption_key() do
      case :crypto.crypto_one_time_aead(:aes_256_gcm, key, iv, ciphertext, <<>>, tag, false) do
        plaintext when is_binary(plaintext) ->
          {:ok, plaintext}
        :error ->
          {:error, :decryption_failed}
      end
    end
  end

  @doc """
  Decrypts ciphertext and parses as JSON.
  """
  @spec decrypt_json(binary(), binary(), binary()) :: {:ok, map()} | {:error, term()}
  def decrypt_json(ciphertext, iv, tag) do
    with {:ok, plaintext} <- decrypt(ciphertext, iv, tag) do
      Jason.decode(plaintext)
    end
  end

  @doc """
  Generates a new encryption key for initial setup.
  Returns a base64-encoded 32-byte key.
  """
  @spec generate_key() :: String.t()
  def generate_key do
    :crypto.strong_rand_bytes(@aes_key_size)
    |> Base.encode64()
  end

  @doc """
  Verifies the encryption key is properly configured.
  """
  @spec verify_key_configured() :: :ok | {:error, term()}
  def verify_key_configured do
    case get_encryption_key() do
      {:ok, _key} -> :ok
      error -> error
    end
  end

  # Private functions

  defp get_encryption_key do
    case Application.get_env(:nuke_api, :credential_encryption_key) || System.get_env("CREDENTIAL_ENCRYPTION_KEY") do
      nil ->
        {:error, :encryption_key_not_configured}

      key_base64 when is_binary(key_base64) ->
        case Base.decode64(key_base64) do
          {:ok, key} when byte_size(key) == @aes_key_size ->
            {:ok, key}
          {:ok, key} ->
            {:error, {:invalid_key_size, byte_size(key), @aes_key_size}}
          :error ->
            {:error, :invalid_base64_key}
        end
    end
  end
end
