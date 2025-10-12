defmodule NukeApi.Products do
  @moduledoc """
  Context for managing automotive products and parts.

  Provides functions for creating, updating, and querying products
  that can be linked to damage and modification tags.
  """

  import Ecto.Query, warn: false
  alias NukeApi.Repo
  alias NukeApi.Products.Product

  @doc """
  Returns the list of products.
  """
  def list_products do
    Repo.all(Product)
  end

  @doc """
  Gets a single product.
  """
  def get_product!(id), do: Repo.get!(Product, id)
  def get_product(id), do: Repo.get(Product, id)

  @doc """
  Creates a product.
  """
  def create_product(attrs \\ %{}) do
    %Product{}
    |> Product.changeset(attrs)
    |> Repo.insert()
  end

  @doc """
  Updates a product.
  """
  def update_product(%Product{} = product, attrs) do
    product
    |> Product.changeset(attrs)
    |> Repo.update()
  end

  @doc """
  Deletes a product.
  """
  def delete_product(%Product{} = product) do
    Repo.delete(product)
  end

  @doc """
  Searches products by query string across name, brand, model, and tags.
  """
  def search_products(query_string) when is_binary(query_string) do
    Product.search_query(query_string)
    |> Repo.all()
  end

  @doc """
  Gets products by category.
  """
  def get_products_by_category(category) do
    from(p in Product, where: p.category == ^category)
    |> Repo.all()
  end

  @doc """
  Gets products by brand.
  """
  def get_products_by_brand(brand) do
    from(p in Product, where: ilike(p.brand, ^"%#{brand}%"))
    |> Repo.all()
  end

  @doc """
  Creates or finds existing product from AI detection.
  """
  def create_or_find_from_detection(brand, part_name, detected_info \\ %{}) do
    # First try to find existing product
    existing = find_existing_product(brand, part_name, detected_info)

    case existing do
      nil ->
        # Create new product from detection
        product_attrs = Product.create_from_detection(brand, part_name, detected_info)
        create_product(product_attrs)

      product ->
        {:ok, product}
    end
  end

  @doc """
  Gets compatible products for a specific vehicle.
  """
  def get_compatible_products(vehicle) do
    list_products()
    |> Enum.filter(&Product.compatible_with_vehicle?(&1, vehicle))
  end

  @doc """
  Gets recommended replacement products for damaged parts.
  """
  def get_replacement_recommendations(damaged_product, vehicle) do
    # Find products in same category that are compatible
    from(p in Product,
      where: p.category == ^damaged_product.category and p.id != ^damaged_product.id,
      order_by: [desc: :price_cents]
    )
    |> Repo.all()
    |> Enum.filter(&Product.compatible_with_vehicle?(&1, vehicle))
    |> Enum.take(5)
  end

  @doc """
  Generates corporate product analytics for market intelligence.
  """
  def generate_product_analytics do
    products = list_products()

    %{
      total_products: length(products),
      category_distribution: analyze_category_distribution(products),
      brand_analysis: analyze_brand_distribution(products),
      price_analysis: analyze_price_ranges(products),
      availability_status: analyze_availability(products),
      market_intelligence: generate_market_intelligence(products)
    }
  end

  defp find_existing_product(brand, part_name, detected_info) do
    # Try exact match first
    exact_match = from(p in Product,
      where: ilike(p.name, ^part_name) and ilike(p.brand, ^brand)
    ) |> Repo.one()

    if exact_match do
      exact_match
    else
      # Try partial match with part number if available
      case Map.get(detected_info, :part_number) do
        nil -> nil
        part_number ->
          from(p in Product, where: p.part_number == ^part_number)
          |> Repo.one()
      end
    end
  end

  defp analyze_category_distribution(products) do
    products
    |> Enum.group_by(& &1.category)
    |> Enum.map(fn {category, category_products} ->
      {category, %{
        count: length(category_products),
        avg_price_cents: calculate_avg_price(category_products),
        availability_rate: calculate_availability_rate(category_products)
      }}
    end)
    |> Enum.into(%{})
  end

  defp analyze_brand_distribution(products) do
    products
    |> Enum.reject(&is_nil(&1.brand))
    |> Enum.group_by(& &1.brand)
    |> Enum.map(fn {brand, brand_products} ->
      {brand, %{
        product_count: length(brand_products),
        categories: brand_products |> Enum.map(& &1.category) |> Enum.uniq(),
        avg_price_cents: calculate_avg_price(brand_products),
        premium_indicator: calculate_avg_price(brand_products) > 10000
      }}
    end)
    |> Enum.into(%{})
  end

  defp analyze_price_ranges(products) do
    priced_products = Enum.reject(products, &is_nil(&1.price_cents))

    if Enum.empty?(priced_products) do
      %{min: 0, max: 0, avg: 0, median: 0}
    else
      prices = Enum.map(priced_products, & &1.price_cents) |> Enum.sort()

      %{
        min: List.first(prices),
        max: List.last(prices),
        avg: Enum.sum(prices) / length(prices),
        median: Enum.at(prices, div(length(prices), 2))
      }
    end
  end

  defp analyze_availability(products) do
    products
    |> Enum.group_by(& &1.availability)
    |> Enum.map(fn {status, status_products} -> {status, length(status_products)} end)
    |> Enum.into(%{})
  end

  defp generate_market_intelligence(products) do
    total_products = length(products)
    priced_products = Enum.reject(products, &is_nil(&1.price_cents))

    %{
      market_coverage: %{
        total_products: total_products,
        priced_products: length(priced_products),
        pricing_coverage: length(priced_products) / max(total_products, 1)
      },
      premium_vs_budget: segment_by_price_tier(priced_products),
      category_maturity: analyze_category_maturity(products),
      inventory_health: calculate_inventory_health(products)
    }
  end

  defp calculate_avg_price(products) do
    priced = Enum.reject(products, &is_nil(&1.price_cents))
    if Enum.empty?(priced), do: 0, else: Enum.sum(Enum.map(priced, & &1.price_cents)) / length(priced)
  end

  defp calculate_availability_rate(products) do
    available = Enum.count(products, &(&1.availability == "available"))
    available / max(length(products), 1)
  end

  defp segment_by_price_tier(products) do
    total = length(products)

    segments = products
      |> Enum.group_by(fn product ->
        cond do
          product.price_cents > 50000 -> "premium"
          product.price_cents > 15000 -> "standard"
          true -> "budget"
        end
      end)

    %{
      premium: %{count: length(Map.get(segments, "premium", [])), percentage: length(Map.get(segments, "premium", [])) / max(total, 1) * 100},
      standard: %{count: length(Map.get(segments, "standard", [])), percentage: length(Map.get(segments, "standard", [])) / max(total, 1) * 100},
      budget: %{count: length(Map.get(segments, "budget", [])), percentage: length(Map.get(segments, "budget", [])) / max(total, 1) * 100}
    }
  end

  defp analyze_category_maturity(products) do
    categories = products |> Enum.group_by(& &1.category)

    Enum.map(categories, fn {category, category_products} ->
      product_count = length(category_products)
      brand_diversity = category_products |> Enum.map(& &1.brand) |> Enum.reject(&is_nil/1) |> Enum.uniq() |> length()

      maturity_score = cond do
        product_count > 50 && brand_diversity > 10 -> "mature"
        product_count > 20 && brand_diversity > 5 -> "developing"
        product_count > 5 -> "emerging"
        true -> "nascent"
      end

      {category, %{
        product_count: product_count,
        brand_diversity: brand_diversity,
        maturity_score: maturity_score
      }}
    end)
    |> Enum.into(%{})
  end

  defp calculate_inventory_health(products) do
    total = length(products)
    available = Enum.count(products, &(&1.availability == "available"))
    discontinued = Enum.count(products, &(&1.availability == "discontinued"))
    back_ordered = Enum.count(products, &(&1.availability == "back_ordered"))

    %{
      availability_rate: available / max(total, 1),
      discontinued_rate: discontinued / max(total, 1),
      supply_chain_issues: back_ordered / max(total, 1),
      overall_health: cond do
        available / max(total, 1) > 0.9 -> "excellent"
        available / max(total, 1) > 0.7 -> "good"
        available / max(total, 1) > 0.5 -> "fair"
        true -> "poor"
      end
    }
  end
end