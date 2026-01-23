defmodule NukeApi.Bidding.Platforms.Bat do
  @moduledoc """
  Bring a Trailer (BaT) platform adapter.

  Handles authentication, session management, auction state retrieval,
  and bid placement for bringatrailer.com.

  BaT specifics:
  - Uses session cookies for authentication
  - Soft-close: Any bid in last 2 minutes extends auction by 2 minutes
  - CSRF tokens required for bid submission
  - Rate limiting: ~20 requests/minute recommended
  """

  @behaviour NukeApi.Bidding.Platforms.Behaviour

  require Logger

  @base_url "https://bringatrailer.com"
  @login_url "#{@base_url}/wp-login.php"
  @user_agent "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

  @impl true
  def config do
    %{
      name: "Bring a Trailer",
      base_url: @base_url,
      rate_limit_requests_per_minute: 20,
      min_request_interval_ms: 1500,
      soft_close_window_seconds: 120,
      supports_websocket: false
    }
  end

  @impl true
  def login(credentials) do
    Logger.info("[BaT] Attempting login for user: #{credentials["username"] || credentials[:username]}")

    username = credentials["username"] || credentials[:username]
    password = credentials["password"] || credentials[:password]

    # Build form data for login
    form_data = [
      {"log", username},
      {"pwd", password},
      {"wp-submit", "Log In"},
      {"redirect_to", @base_url},
      {"testcookie", "1"}
    ]

    headers = [
      {"User-Agent", @user_agent},
      {"Content-Type", "application/x-www-form-urlencoded"},
      {"Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"},
      {"Accept-Language", "en-US,en;q=0.9"},
      {"Origin", @base_url},
      {"Referer", "#{@base_url}/wp-login.php"}
    ]

    case Req.post(@login_url, form: form_data, headers: headers, redirect: false, max_redirects: 0) do
      {:ok, %{status: status, headers: resp_headers}} when status in [301, 302, 303] ->
        # Successful login redirects
        cookies = extract_cookies(resp_headers)

        if valid_session_cookies?(cookies) do
          session = build_session(cookies)
          Logger.info("[BaT] Login successful for: #{username}")
          {:ok, session}
        else
          Logger.warn("[BaT] Login failed - no session cookie")
          {:error, :invalid_credentials}
        end

      {:ok, %{status: 200, body: body}} ->
        # Stayed on login page - check for 2FA or error
        cond do
          String.contains?(body, "two-factor") or String.contains?(body, "2fa") ->
            Logger.info("[BaT] 2FA required for: #{username}")
            {:error, {:twofa_required, %{
              method: "totp",
              challenge_data: %{},
              expires_at: DateTime.add(DateTime.utc_now(), 300, :second)
            }}}

          String.contains?(body, "incorrect") or String.contains?(body, "Invalid") ->
            Logger.warn("[BaT] Invalid credentials for: #{username}")
            {:error, :invalid_credentials}

          true ->
            Logger.warn("[BaT] Unexpected login response")
            {:error, :login_failed}
        end

      {:ok, %{status: status}} ->
        Logger.error("[BaT] Unexpected status during login: #{status}")
        {:error, {:unexpected_status, status}}

      {:error, reason} ->
        Logger.error("[BaT] Login request failed: #{inspect(reason)}")
        {:error, reason}
    end
  end

  @impl true
  def validate_session(session) do
    Logger.debug("[BaT] Validating session")

    headers = build_headers(session)

    case Req.get("#{@base_url}/my-bids/", headers: headers, redirect: false) do
      {:ok, %{status: 200, body: body}} ->
        # Check if we're logged in by looking for user-specific content
        is_valid = String.contains?(body, "my-bids") and
                   not String.contains?(body, "wp-login.php")
        Logger.debug("[BaT] Session valid: #{is_valid}")
        is_valid

      {:ok, %{status: status}} when status in [301, 302, 303] ->
        # Redirected to login - session invalid
        Logger.debug("[BaT] Session expired - redirected to login")
        false

      _ ->
        false
    end
  end

  @impl true
  def refresh_session(session) do
    Logger.info("[BaT] Attempting session refresh")

    if validate_session(session) do
      # Session is still valid, just update expiry
      {:ok, %{session | expires_at: DateTime.add(DateTime.utc_now(), 3600, :second)}}
    else
      {:error, :session_expired}
    end
  end

  @impl true
  def get_auction_state(session, auction_url) do
    Logger.info("[BaT] Fetching auction state: #{auction_url}")

    headers = build_headers(session)

    case Req.get(auction_url, headers: headers) do
      {:ok, %{status: 200, body: html}} ->
        parse_auction_state(html)

      {:ok, %{status: 404}} ->
        {:error, :auction_not_found}

      {:ok, %{status: status}} ->
        {:error, {:unexpected_status, status}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @impl true
  def place_bid(session, auction_url, amount_cents) do
    Logger.info("[BaT] Placing bid: $#{amount_cents / 100} on #{auction_url}")

    # First, get the auction page to extract CSRF token and auction ID
    headers = build_headers(session)

    with {:ok, %{status: 200, body: html}} <- Req.get(auction_url, headers: headers),
         {:ok, csrf_token} <- extract_csrf_token(html),
         {:ok, auction_id} <- extract_auction_id(html, auction_url) do

      bid_amount = amount_cents / 100

      # Build bid form data
      form_data = [
        {"action", "submit_bid"},
        {"listing_id", auction_id},
        {"bid_amount", "#{bid_amount}"},
        {"_wpnonce", csrf_token}
      ]

      bid_headers = headers ++ [
        {"Content-Type", "application/x-www-form-urlencoded"},
        {"X-Requested-With", "XMLHttpRequest"},
        {"Referer", auction_url}
      ]

      case Req.post("#{@base_url}/wp-admin/admin-ajax.php", form: form_data, headers: bid_headers) do
        {:ok, %{status: 200, body: body}} ->
          parse_bid_response(body, amount_cents)

        {:ok, %{status: status, body: body}} ->
          Logger.error("[BaT] Bid failed with status #{status}: #{inspect(body)}")
          {:error, {:bid_failed, status}}

        {:error, reason} ->
          Logger.error("[BaT] Bid request failed: #{inspect(reason)}")
          {:error, reason}
      end
    else
      {:error, reason} -> {:error, reason}
    end
  end

  @impl true
  def handle_2fa(session, _method, code) do
    Logger.info("[BaT] Handling 2FA verification")

    headers = build_headers(session)

    form_data = [
      {"authcode", code},
      {"wp-submit", "Authenticate"}
    ]

    two_fa_headers = headers ++ [
      {"Content-Type", "application/x-www-form-urlencoded"}
    ]

    case Req.post("#{@base_url}/wp-login.php?action=validate_2fa", form: form_data, headers: two_fa_headers, redirect: false) do
      {:ok, %{status: status, headers: resp_headers}} when status in [301, 302, 303] ->
        # Successful 2FA
        new_cookies = extract_cookies(resp_headers)
        merged_cookies = Map.merge(session.cookies, new_cookies)

        if valid_session_cookies?(merged_cookies) do
          {:ok, %{session | cookies: merged_cookies}}
        else
          {:error, :twofa_failed}
        end

      {:ok, %{status: 200, body: body}} ->
        if String.contains?(body, "invalid") or String.contains?(body, "incorrect") do
          {:error, :invalid_code}
        else
          {:error, :twofa_failed}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  # Private functions

  defp build_session(cookies) do
    %{
      token: nil,
      cookies: cookies,
      expires_at: DateTime.add(DateTime.utc_now(), 86400, :second), # 24 hours
      user_agent: @user_agent,
      platform_user_id: nil,
      platform_username: nil
    }
  end

  defp build_headers(session) do
    cookie_string = session.cookies
    |> Enum.map(fn {k, v} -> "#{k}=#{v}" end)
    |> Enum.join("; ")

    [
      {"User-Agent", session.user_agent || @user_agent},
      {"Cookie", cookie_string},
      {"Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"},
      {"Accept-Language", "en-US,en;q=0.9"}
    ]
  end

  defp extract_cookies(headers) do
    headers
    |> Enum.filter(fn {name, _} -> String.downcase(name) == "set-cookie" end)
    |> Enum.map(fn {_, value} ->
      [cookie | _] = String.split(value, ";")
      case String.split(cookie, "=", parts: 2) do
        [name, val] -> {String.trim(name), String.trim(val)}
        _ -> nil
      end
    end)
    |> Enum.reject(&is_nil/1)
    |> Map.new()
  end

  defp valid_session_cookies?(cookies) do
    # BaT uses wordpress_logged_in_* cookies
    Enum.any?(cookies, fn {name, _} ->
      String.starts_with?(name, "wordpress_logged_in_")
    end)
  end

  defp parse_auction_state(html) do
    # Parse auction data from page HTML
    # BaT embeds auction data in JavaScript and HTML elements

    with {:ok, current_bid} <- extract_current_bid(html),
         {:ok, end_time} <- extract_end_time(html),
         {:ok, server_time} <- extract_server_time(html) do

      bid_count = extract_bid_count(html)
      high_bidder = extract_high_bidder(html)
      is_reserve_met = extract_reserve_status(html)
      minimum_bid = extract_minimum_bid(html)

      # Check if auction has ended
      now = DateTime.utc_now()
      if DateTime.compare(end_time, now) == :lt do
        {:error, :auction_ended}
      else
        time_remaining = DateTime.diff(end_time, now, :second)

        {:ok, %{
          current_bid_cents: current_bid,
          bid_count: bid_count,
          high_bidder_username: high_bidder,
          auction_end_time: end_time,
          server_time: server_time,
          is_reserve_met: is_reserve_met,
          is_soft_close_active: time_remaining <= 120,
          minimum_bid_cents: minimum_bid,
          bid_increment_cents: calculate_bid_increment(current_bid)
        }}
      end
    end
  end

  defp extract_current_bid(html) do
    # Look for bid amount in various formats BaT uses
    patterns = [
      ~r/data-current-bid="(\d+)"/,
      ~r/Current Bid[:\s]*\$?([\d,]+)/i,
      ~r/class="bid-value"[^>]*>\$?([\d,]+)/
    ]

    result = Enum.find_value(patterns, fn pattern ->
      case Regex.run(pattern, html) do
        [_, amount] ->
          amount
          |> String.replace(",", "")
          |> String.to_integer()
          |> Kernel.*(100) # Convert to cents
        nil -> nil
      end
    end)

    if result, do: {:ok, result}, else: {:error, :bid_not_found}
  end

  defp extract_end_time(html) do
    # BaT stores end time in data attributes or JavaScript
    patterns = [
      ~r/data-end-time="([^"]+)"/,
      ~r/auction_end[_-]?time['":\s]*['"]?(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2})/i,
      ~r/ends?[:\s]*(\w+ \d+, \d{4} at \d+:\d+ [AP]M)/i
    ]

    result = Enum.find_value(patterns, fn pattern ->
      case Regex.run(pattern, html) do
        [_, time_str] -> parse_datetime(time_str)
        nil -> nil
      end
    end)

    if result, do: {:ok, result}, else: {:error, :end_time_not_found}
  end

  defp extract_server_time(html) do
    case Regex.run(~r/data-server-time="([^"]+)"/, html) do
      [_, time_str] -> {:ok, parse_datetime(time_str) || DateTime.utc_now()}
      nil -> {:ok, DateTime.utc_now()}
    end
  end

  defp extract_bid_count(html) do
    case Regex.run(~r/(\d+)\s*bids?/i, html) do
      [_, count] -> String.to_integer(count)
      nil -> 0
    end
  end

  defp extract_high_bidder(html) do
    case Regex.run(~r/high bidder[:\s]*([^\s<]+)/i, html) do
      [_, username] -> username
      nil -> nil
    end
  end

  defp extract_reserve_status(html) do
    cond do
      String.contains?(html, "Reserve Met") -> true
      String.contains?(html, "Reserve Not Met") -> false
      String.contains?(html, "No Reserve") -> true
      true -> nil
    end
  end

  defp extract_minimum_bid(html) do
    case Regex.run(~r/minimum[:\s]*\$?([\d,]+)/i, html) do
      [_, amount] ->
        amount
        |> String.replace(",", "")
        |> String.to_integer()
        |> Kernel.*(100)
      nil -> nil
    end
  end

  defp calculate_bid_increment(current_bid_cents) do
    # BaT's bid increment rules
    cond do
      current_bid_cents < 10_000_00 -> 250_00    # $250 under $10k
      current_bid_cents < 25_000_00 -> 500_00    # $500 under $25k
      current_bid_cents < 100_000_00 -> 1000_00  # $1,000 under $100k
      true -> 2500_00                             # $2,500 over $100k
    end
  end

  defp extract_csrf_token(html) do
    case Regex.run(~r/name="_wpnonce"[^>]*value="([^"]+)"/, html) do
      [_, token] -> {:ok, token}
      nil ->
        case Regex.run(~r/var\s+wpnonce\s*=\s*['"]([^'"]+)['"]/, html) do
          [_, token] -> {:ok, token}
          nil -> {:error, :csrf_token_not_found}
        end
    end
  end

  defp extract_auction_id(html, url) do
    # Try to get from HTML first
    case Regex.run(~r/data-listing-id="(\d+)"/, html) do
      [_, id] -> {:ok, id}
      nil ->
        # Fall back to URL parsing
        case Regex.run(~r/listing\/([^\/]+)/, url) do
          [_, slug] -> {:ok, slug}
          nil -> {:error, :auction_id_not_found}
        end
    end
  end

  defp parse_bid_response(body, bid_amount_cents) do
    case Jason.decode(body) do
      {:ok, %{"success" => true} = data} ->
        {:ok, %{
          success: true,
          bid_amount_cents: bid_amount_cents,
          new_high_bid_cents: (data["new_high_bid"] || bid_amount_cents / 100) * 100,
          is_high_bidder: data["is_high_bidder"] || true,
          message: data["message"],
          error_code: nil
        }}

      {:ok, %{"success" => false} = data} ->
        error = data["message"] || "Bid failed"

        cond do
          String.contains?(error, "minimum") ->
            {:error, :below_minimum}

          String.contains?(error, "ended") ->
            {:error, :auction_ended}

          String.contains?(error, "outbid") ->
            {:ok, %{
              success: false,
              bid_amount_cents: bid_amount_cents,
              new_high_bid_cents: nil,
              is_high_bidder: false,
              message: error,
              error_code: "outbid"
            }}

          true ->
            {:error, {:bid_rejected, error}}
        end

      {:error, _} ->
        # Non-JSON response, try to parse as HTML
        if String.contains?(body, "success") do
          {:ok, %{
            success: true,
            bid_amount_cents: bid_amount_cents,
            new_high_bid_cents: bid_amount_cents,
            is_high_bidder: true,
            message: nil,
            error_code: nil
          }}
        else
          {:error, :invalid_response}
        end
    end
  end

  defp parse_datetime(nil), do: nil
  defp parse_datetime(str) when is_binary(str) do
    # Try ISO format first
    case DateTime.from_iso8601(str) do
      {:ok, dt, _} -> dt
      _ ->
        # Try other common formats
        case Timex.parse(str, "{YYYY}-{0M}-{0D} {h24}:{m}:{s}") do
          {:ok, dt} -> DateTime.from_naive!(dt, "Etc/UTC")
          _ ->
            case Timex.parse(str, "{Mfull} {D}, {YYYY} at {h12}:{m} {AM}") do
              {:ok, dt} -> DateTime.from_naive!(dt, "America/Los_Angeles") |> DateTime.shift_zone!("Etc/UTC")
              _ -> nil
            end
        end
    end
  end
end
