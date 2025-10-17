defmodule NukeApi.MarketData.ListingMonitorWorker do
  @moduledoc """
  Periodic worker that scans `listing_monitors`, fetches source URLs, detects
  changes (sold/removed/updated), and records snapshots in `vehicle_listing_archives`.
  """

  use GenServer
  require Logger
  import Ecto.Query

  alias NukeApi.Repo
  alias NukeApi.MarketData.{ListingMonitor, VehicleListingArchive}

  @scan_interval_ms :timer.minutes(10)
  @user_agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

  # Client API
  def start_link(opts \\ []), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  def trigger_scan_now, do: GenServer.cast(__MODULE__, :scan)

  # Server callbacks
  @impl true
  def init(_opts) do
    # Kick off first scan shortly after boot
    Process.send_after(self(), :scan, 5_000)
    {:ok, %{}}
  end

  @impl true
  def handle_info(:scan, state) do
    do_scan()
    # Schedule next run
    Process.send_after(self(), :scan, @scan_interval_ms)
    {:noreply, state}
  end

  @impl true
  def handle_cast(:scan, state) do
    do_scan()
    {:noreply, state}
  end

  defp do_scan do
    monitors = Repo.all(from m in ListingMonitor, where: m.status in ["active", "unknown"], limit: 50)

    Enum.each(monitors, fn monitor ->
      with {:ok, html} <- fetch_html(monitor.source_url),
           content_hash <- :crypto.hash(:sha256, html) |> Base.encode16(case: :lower),
           {status, attrs} <- detect_status_and_attrs(html, monitor) do
        maybe_record_archive(monitor, html, attrs)

        changes = %{
          last_checked: DateTime.utc_now(),
          last_status: status,
          last_content_hash: content_hash
        }
        |> Map.merge(Map.take(attrs, [:final_sale_price, :sale_date]))
        |> Map.merge(%{status: status})

        monitor
        |> ListingMonitor.changeset(changes)
        |> Repo.update()
      else
        {:error, reason} ->
          Logger.warning("ListingMonitor fetch failed: #{inspect(reason)} for #{monitor.source_url}")
          monitor
          |> ListingMonitor.changeset(%{last_checked: DateTime.utc_now(), last_status: "error"})
          |> Repo.update()
      end
    end)
  end

  defp fetch_html(url) do
    headers = [{"User-Agent", @user_agent}, {"Accept", "text/html"}]
    case HTTPoison.get(url, headers, follow_redirect: true, timeout: 15_000, recv_timeout: 15_000) do
      {:ok, %HTTPoison.Response{status_code: 200, body: body}} -> {:ok, body}
      {:ok, %HTTPoison.Response{status_code: code}} -> {:error, {:http_status, code}}
      {:error, %HTTPoison.Error{reason: reason}} -> {:error, reason}
    end
  end

  defp detect_status_and_attrs(html, monitor) do
    source = detect_source(monitor.source_url)
    case source do
      :bringatrailer -> detect_bat_status(html)
      :facebook -> detect_facebook_status(html)
      :craigslist -> detect_craigslist_status(html)
      _ -> {monitor.status || "unknown", %{}}
    end
  end

  defp detect_bat_status(html) do
    sold = Regex.match?(~r/Winning bid|Sold for\s*\$[\d,]+/i, html)
    price = case Regex.run(~r/Sold for\s*\$([\d,]+)/i, html) do
      [_, amt] -> Decimal.new(String.replace(amt, ",", ""))
      _ -> nil
    end
    date = case Regex.run(~r/Auction ends?:\s*([^<]+)/i, html) do
      [_, d] -> parse_date(d)
      _ -> nil
    end
    status = if sold, do: "sold", else: "active"
    {status, %{final_sale_price: price, sale_date: date}}
  end

  defp detect_facebook_status(html) do
    removed = Regex.match?(~r/content not available|page isn't available|this content isn't available/i, html)
    status = if removed, do: "removed", else: "active"
    {status, %{}
    }
  end

  defp detect_craigslist_status(html) do
    removed = Regex.match?(~r/This posting has been deleted by its author|no longer available/i, html)
    status = if removed, do: "removed", else: "active"
    {status, %{}
    }
  end

  defp detect_source(url) do
    cond do
      String.contains?(url, "bringatrailer.com") -> :bringatrailer
      String.contains?(url, "facebook.com/marketplace") -> :facebook
      String.contains?(url, "craigslist.org") -> :craigslist
      true -> :generic
    end
  end

  defp parse_date(_str), do: nil

  defp maybe_record_archive(monitor, html, attrs) do
    archive_attrs = %{
      vehicle_id: monitor.vehicle_id,
      source_platform: monitor.source_platform || to_string(detect_source(monitor.source_url)),
      source_url: monitor.source_url,
      html_content: html,
      description_text: nil,
      images: %{},
      metadata: %{},
      scraped_at: DateTime.utc_now(),
      final_sale_price: Map.get(attrs, :final_sale_price),
      sale_date: Map.get(attrs, :sale_date)
    }

    %VehicleListingArchive{}
    |> VehicleListingArchive.changeset(archive_attrs)
    |> Repo.insert()
  end
end
