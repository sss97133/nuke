defmodule NukeApi.Services do
  @moduledoc """
  Context for managing automotive services, technicians, and shops.

  Provides comprehensive service tracking, professional network analysis,
  and corporate B2B intelligence for parts/tool sales targeting.
  """

  import Ecto.Query, warn: false
  alias NukeApi.Repo
  alias NukeApi.Services.{Service, Technician, Shop}

  ## Services

  @doc """
  Returns the list of services.
  """
  def list_services do
    Repo.all(Service)
  end

  @doc """
  Gets a single service.
  """
  def get_service!(id), do: Repo.get!(Service, id)
  def get_service(id), do: Repo.get(Service, id)

  @doc """
  Creates a service.
  """
  def create_service(attrs \\ %{}) do
    %Service{}
    |> Service.changeset(attrs)
    |> Repo.insert()
  end

  @doc """
  Updates a service.
  """
  def update_service(%Service{} = service, attrs) do
    service
    |> Service.changeset(attrs)
    |> Repo.update()
  end

  @doc """
  Deletes a service.
  """
  def delete_service(%Service{} = service) do
    Repo.delete(service)
  end

  @doc """
  Gets services by category.
  """
  def get_services_by_category(category) do
    from(s in Service, where: s.category == ^category)
    |> Repo.all()
  end

  @doc """
  Creates or finds service from detected work patterns.
  """
  def create_or_find_from_detection(service_name, category, tools_detected \\ []) do
    existing = find_existing_service(service_name, category)

    case existing do
      nil ->
        service_attrs = Service.create_from_detection(service_name, category, tools_detected)
        create_service(service_attrs)

      service ->
        {:ok, service}
    end
  end

  ## Technicians

  @doc """
  Returns the list of technicians.
  """
  def list_technicians do
    Repo.all(Technician) |> Repo.preload([:shop])
  end

  @doc """
  Gets a single technician.
  """
  def get_technician!(id), do: Repo.get!(Technician, id) |> Repo.preload([:shop])
  def get_technician(id), do: Repo.get(Technician, id) |> Repo.preload([:shop])

  @doc """
  Creates a technician.
  """
  def create_technician(attrs \\ %{}) do
    %Technician{}
    |> Technician.changeset(attrs)
    |> Repo.insert()
  end

  @doc """
  Updates a technician.
  """
  def update_technician(%Technician{} = technician, attrs) do
    technician
    |> Technician.changeset(attrs)
    |> Repo.update()
  end

  @doc """
  Deletes a technician.
  """
  def delete_technician(%Technician{} = technician) do
    Repo.delete(technician)
  end

  @doc """
  Gets technicians by shop.
  """
  def get_technicians_by_shop(shop_id) do
    from(t in Technician, where: t.shop_id == ^shop_id and t.active == true)
    |> Repo.all()
    |> Repo.preload([:shop])
  end

  @doc """
  Finds qualified technicians for a specific service.
  """
  def find_qualified_technicians(service_category, required_skill_level \\ "basic") do
    list_technicians()
    |> Enum.filter(&Technician.qualified_for_service?(&1, service_category, required_skill_level))
  end

  ## Shops

  @doc """
  Returns the list of shops.
  """
  def list_shops do
    Repo.all(Shop) |> Repo.preload([:technicians])
  end

  @doc """
  Gets a single shop.
  """
  def get_shop!(id), do: Repo.get!(Shop, id) |> Repo.preload([:technicians])
  def get_shop(id), do: Repo.get(Shop, id) |> Repo.preload([:technicians])

  @doc """
  Creates a shop.
  """
  def create_shop(attrs \\ %{}) do
    %Shop{}
    |> Shop.changeset(attrs)
    |> Repo.insert()
  end

  @doc """
  Updates a shop.
  """
  def update_shop(%Shop{} = shop, attrs) do
    shop
    |> Shop.changeset(attrs)
    |> Repo.update()
  end

  @doc """
  Deletes a shop.
  """
  def delete_shop(%Shop{} = shop) do
    Repo.delete(shop)
  end

  @doc """
  Gets shops by business type.
  """
  def get_shops_by_type(business_type) do
    from(s in Shop, where: s.business_type == ^business_type and s.active == true)
    |> Repo.all()
    |> Repo.preload([:technicians])
  end

  @doc """
  Finds shops capable of specific services.
  """
  def find_capable_shops(required_service, required_equipment \\ []) do
    list_shops()
    |> Enum.filter(&Shop.capable_of_service?(&1, required_service, required_equipment))
  end

  ## Analytics and Intelligence

  @doc """
  Generates comprehensive service industry analytics for corporate targeting.
  """
  def generate_industry_analytics do
    services = list_services()
    technicians = list_technicians()
    shops = list_shops()

    %{
      service_analysis: Service.generate_market_analysis(services),
      technician_intelligence: generate_technician_intelligence(technicians),
      shop_intelligence: generate_shop_intelligence(shops),
      network_analysis: analyze_service_network(technicians, shops),
      market_opportunities: identify_market_opportunities(services, technicians, shops)
    }
  end

  @doc """
  Generates technician network intelligence for corporate B2B targeting.
  """
  def generate_technician_intelligence(technicians) do
    total_techs = length(technicians)

    %{
      total_technicians: total_techs,
      certification_distribution: analyze_certification_distribution(technicians),
      specialization_analysis: analyze_specialization_patterns(technicians),
      experience_levels: analyze_experience_distribution(technicians),
      rate_analysis: analyze_rate_distribution(technicians),
      shop_affiliation: analyze_shop_affiliation(technicians),
      corporate_targeting_scores: generate_technician_targeting_scores(technicians)
    }
  end

  @doc """
  Generates shop network intelligence for B2B market analysis.
  """
  def generate_shop_intelligence(shops) do
    total_shops = length(shops)

    %{
      total_shops: total_shops,
      business_type_distribution: analyze_business_type_distribution(shops),
      service_capability_matrix: analyze_service_capabilities(shops),
      equipment_penetration: analyze_equipment_penetration(shops),
      market_segmentation: analyze_shop_market_segments(shops),
      purchasing_power_analysis: analyze_purchasing_power(shops),
      growth_indicators: analyze_shop_growth_indicators(shops)
    }
  end

  @doc """
  Analyzes service network connections and professional relationships.
  """
  def analyze_service_network(technicians, shops) do
    shop_tech_matrix = shops
      |> Enum.map(fn shop ->
        tech_count = length(shop.technicians)
        avg_experience = if tech_count > 0 do
          shop.technicians
          |> Enum.map(&(&1.experience_years || 0))
          |> Enum.sum()
          |> div(tech_count)
        else
          0
        end

        %{
          shop_id: shop.id,
          shop_name: shop.name,
          business_type: shop.business_type,
          technician_count: tech_count,
          avg_technician_experience: avg_experience,
          service_capacity: estimate_shop_capacity(shop)
        }
      end)

    %{
      network_density: calculate_network_density(technicians, shops),
      capacity_distribution: shop_tech_matrix,
      specialization_clusters: identify_specialization_clusters(technicians),
      service_coverage_gaps: identify_service_gaps(shops)
    }
  end

  @doc """
  Identifies market opportunities for corporate products/services.
  """
  def identify_market_opportunities(services, technicians, shops) do
    %{
      high_value_targets: identify_high_value_targets(technicians, shops),
      service_expansion_opportunities: identify_expansion_opportunities(services, shops),
      equipment_upgrade_candidates: identify_equipment_upgrade_candidates(shops),
      training_opportunities: identify_training_opportunities(technicians),
      market_penetration_strategies: generate_penetration_strategies(shops)
    }
  end

  ## Private Helper Functions

  defp find_existing_service(name, category) do
    from(s in Service, where: ilike(s.name, ^"%#{name}%") and s.category == ^category)
    |> Repo.one()
  end

  defp analyze_certification_distribution(technicians) do
    technicians
    |> Enum.group_by(& &1.certification_level)
    |> Enum.map(fn {cert, cert_techs} -> {cert, length(cert_techs)} end)
    |> Enum.into(%{})
  end

  defp analyze_specialization_patterns(technicians) do
    all_specializations = technicians
      |> Enum.flat_map(&(&1.specializations || []))
      |> Enum.frequencies()

    %{
      most_common_specializations: all_specializations |> Enum.sort_by(&elem(&1, 1), :desc) |> Enum.take(10),
      specialization_diversity: analyze_specialization_diversity(technicians),
      niche_specialists: identify_niche_specialists(technicians)
    }
  end

  defp analyze_experience_distribution(technicians) do
    experiences = technicians |> Enum.map(&(&1.experience_years || 0))

    %{
      entry_level: Enum.count(experiences, &(&1 < 3)),
      intermediate: Enum.count(experiences, &(&1 >= 3 and &1 < 8)),
      experienced: Enum.count(experiences, &(&1 >= 8 and &1 < 15)),
      expert: Enum.count(experiences, &(&1 >= 15)),
      avg_experience: if(Enum.empty?(experiences), do: 0, else: Enum.sum(experiences) / length(experiences))
    }
  end

  defp analyze_rate_distribution(technicians) do
    rates = technicians |> Enum.map(&(&1.hourly_rate_cents || 0)) |> Enum.reject(&(&1 == 0))

    if Enum.empty?(rates) do
      %{avg: 0, median: 0, min: 0, max: 0}
    else
      sorted_rates = Enum.sort(rates)
      %{
        avg: Enum.sum(rates) / length(rates),
        median: Enum.at(sorted_rates, div(length(rates), 2)),
        min: List.first(sorted_rates),
        max: List.last(sorted_rates),
        premium_rate_percentage: Enum.count(rates, &(&1 > 8000)) / length(rates) * 100
      }
    end
  end

  defp analyze_shop_affiliation(technicians) do
    affiliated = Enum.count(technicians, &(&1.shop_id != nil))
    independent = length(technicians) - affiliated

    %{
      affiliated: affiliated,
      independent: independent,
      affiliation_rate: affiliated / max(length(technicians), 1)
    }
  end

  defp generate_technician_targeting_scores(technicians) do
    technicians
    |> Enum.map(fn tech ->
      intelligence = Technician.generate_intelligence_report(tech)
      %{
        technician_id: tech.id,
        targeting_score: intelligence.corporate_targeting_score,
        tier: intelligence.certification_tier,
        market_value: intelligence.market_value
      }
    end)
    |> Enum.sort_by(& &1.targeting_score, :desc)
  end

  defp analyze_business_type_distribution(shops) do
    shops
    |> Enum.group_by(& &1.business_type)
    |> Enum.map(fn {type, type_shops} -> {type, length(type_shops)} end)
    |> Enum.into(%{})
  end

  defp analyze_service_capabilities(shops) do
    all_services = shops |> Enum.flat_map(&(&1.services_offered || []))
    service_frequencies = Enum.frequencies(all_services)

    %{
      service_coverage: service_frequencies,
      shops_per_service: service_frequencies |> Enum.map(fn {service, _} ->
        {service, Enum.count(shops, &(service in (&1.services_offered || [])))}
      end) |> Enum.into(%{}),
      service_gaps: identify_underserved_services(shops)
    }
  end

  defp analyze_equipment_penetration(shops) do
    all_equipment = shops |> Enum.flat_map(&(&1.equipment_available || []))
    equipment_frequencies = Enum.frequencies(all_equipment)

    %{
      equipment_penetration: equipment_frequencies,
      high_investment_shops: Enum.count(shops, &(length(&1.equipment_available || []) > 5)),
      equipment_upgrade_candidates: Enum.filter(shops, &(length(&1.equipment_available || []) < 3))
    }
  end

  defp analyze_shop_market_segments(shops) do
    shops
    |> Enum.group_by(&Shop.purchasing_power_tier/1)
    |> Enum.map(fn {tier, tier_shops} ->
      {tier, %{
        count: length(tier_shops),
        avg_business_score: tier_shops |> Enum.map(&Shop.calculate_business_score/1) |> Enum.sum() |> div(max(length(tier_shops), 1))
      }}
    end)
    |> Enum.into(%{})
  end

  defp analyze_purchasing_power(shops) do
    market_intelligence = shops |> Enum.map(&Shop.generate_market_intelligence/1)

    %{
      total_estimated_equipment_value: market_intelligence |> Enum.map(&(&1.equipment_investment.estimated_equipment_value)) |> Enum.sum(),
      high_value_targets: Enum.count(market_intelligence, &(&1.corporate_targeting_value >= 70)),
      growth_potential_shops: Enum.count(market_intelligence, &(&1.growth_indicators.expansion_potential == "high"))
    }
  end

  defp analyze_shop_growth_indicators(shops) do
    growth_analyses = shops |> Enum.map(&Shop.generate_market_intelligence/1) |> Enum.map(& &1.growth_indicators)

    %{
      high_growth_potential: Enum.count(growth_analyses, &(&1.expansion_potential == "high")),
      moderate_growth_potential: Enum.count(growth_analyses, &(&1.expansion_potential == "moderate")),
      limited_growth_potential: Enum.count(growth_analyses, &(&1.expansion_potential == "limited")),
      avg_growth_score: growth_analyses |> Enum.map(& &1.growth_score) |> Enum.sum() |> div(max(length(growth_analyses), 1))
    }
  end

  defp calculate_network_density(technicians, shops) do
    total_techs = length(technicians)
    affiliated_techs = Enum.count(technicians, &(&1.shop_id != nil))
    total_shops = length(shops)

    %{
      technician_shop_ratio: total_techs / max(total_shops, 1),
      affiliation_density: affiliated_techs / max(total_techs, 1),
      avg_techs_per_shop: affiliated_techs / max(total_shops, 1)
    }
  end

  defp estimate_shop_capacity(shop) do
    base_capacity = length(shop.services_offered || []) * 10
    tech_multiplier = length(shop.technicians) * 5
    equipment_multiplier = length(shop.equipment_available || []) * 2

    base_capacity + tech_multiplier + equipment_multiplier
  end

  defp identify_specialization_clusters(technicians) do
    technicians
    |> Enum.group_by(fn tech ->
      (tech.specializations || []) |> Enum.sort() |> Enum.take(3) |> Enum.join("_")
    end)
    |> Enum.filter(fn {_cluster, cluster_techs} -> length(cluster_techs) > 1 end)
    |> Enum.map(fn {cluster, cluster_techs} ->
      {cluster, %{count: length(cluster_techs), avg_experience: calculate_avg_experience(cluster_techs)}}
    end)
    |> Enum.into(%{})
  end

  defp identify_service_gaps(shops) do
    common_services = ["oil_change", "brake_service", "diagnostic", "electrical_repair", "engine_repair"]

    common_services
    |> Enum.map(fn service ->
      shops_offering = Enum.count(shops, &(service in (&1.services_offered || [])))
      coverage_rate = shops_offering / max(length(shops), 1)

      {service, %{shops_offering: shops_offering, coverage_rate: coverage_rate}}
    end)
    |> Enum.filter(fn {_service, data} -> data.coverage_rate < 0.5 end)
    |> Enum.into(%{})
  end

  defp analyze_specialization_diversity(technicians) do
    diversity_scores = technicians
      |> Enum.map(fn tech ->
        spec_count = length(tech.specializations || [])
        cond do
          spec_count >= 5 -> "high_diversity"
          spec_count >= 3 -> "moderate_diversity"
          spec_count >= 1 -> "focused"
          true -> "generalist"
        end
      end)
      |> Enum.frequencies()

    diversity_scores
  end

  defp identify_niche_specialists(technicians) do
    rare_specializations = ["fabrication", "restoration", "racing_shop", "diesel", "hybrid_electric"]

    technicians
    |> Enum.filter(fn tech ->
      Enum.any?(tech.specializations || [], &(&1 in rare_specializations))
    end)
    |> Enum.map(fn tech ->
      niche_specs = (tech.specializations || []) |> Enum.filter(&(&1 in rare_specializations))
      %{technician_id: tech.id, niche_specializations: niche_specs}
    end)
  end

  defp identify_high_value_targets(technicians, shops) do
    high_value_techs = technicians
      |> Enum.filter(fn tech ->
        intelligence = Technician.generate_intelligence_report(tech)
        intelligence.corporate_targeting_score >= 40
      end)

    high_value_shops = shops
      |> Enum.filter(fn shop ->
        intelligence = Shop.generate_market_intelligence(shop)
        intelligence.corporate_targeting_value >= 60
      end)

    %{
      technicians: length(high_value_techs),
      shops: length(high_value_shops),
      combined_market_value: calculate_combined_market_value(high_value_techs, high_value_shops)
    }
  end

  defp identify_expansion_opportunities(services, shops) do
    service_demand = Service.generate_market_analysis(services)
    underserved_services = identify_underserved_services(shops)

    %{
      high_demand_services: service_demand.category_distribution |> Enum.sort_by(&elem(&1, 1), :desc) |> Enum.take(5),
      underserved_markets: underserved_services,
      diy_to_professional_opportunities: service_demand.diy_feasible_count
    }
  end

  defp identify_equipment_upgrade_candidates(shops) do
    shops
    |> Enum.filter(fn shop ->
      equipment_count = length(shop.equipment_available || [])
      business_score = Shop.calculate_business_score(shop)

      # High business score but low equipment investment indicates upgrade opportunity
      business_score > 50 && equipment_count < 5
    end)
    |> Enum.map(fn shop ->
      %{
        shop_id: shop.id,
        current_equipment_count: length(shop.equipment_available || []),
        business_score: Shop.calculate_business_score(shop),
        upgrade_potential: "high"
      }
    end)
  end

  defp identify_training_opportunities(technicians) do
    technicians
    |> Enum.filter(fn tech ->
      experience = tech.experience_years || 0
      spec_count = length(tech.specializations || [])

      # Experienced techs with limited specializations are training candidates
      experience > 5 && spec_count < 3
    end)
    |> Enum.map(fn tech ->
      %{
        technician_id: tech.id,
        experience_years: tech.experience_years,
        current_specializations: tech.specializations || [],
        training_opportunity: "specialization_expansion"
      }
    end)
  end

  defp generate_penetration_strategies(shops) do
    segments = shops |> Enum.group_by(&Shop.purchasing_power_tier/1)

    Enum.map(segments, fn {tier, tier_shops} ->
      strategy = case tier do
        "enterprise" -> "premium_partnership_programs"
        "professional" -> "volume_discount_programs"
        "small_business" -> "financing_and_support_programs"
        "startup" -> "entry_level_tool_packages"
      end

      {tier, %{
        shop_count: length(tier_shops),
        recommended_strategy: strategy,
        avg_business_score: tier_shops |> Enum.map(&Shop.calculate_business_score/1) |> Enum.sum() |> div(max(length(tier_shops), 1))
      }}
    end)
    |> Enum.into(%{})
  end

  defp identify_underserved_services(shops) do
    all_services = ["oil_change", "brake_service", "transmission_service", "engine_repair",
                   "electrical_repair", "air_conditioning", "diagnostic", "bodywork"]

    all_services
    |> Enum.map(fn service ->
      coverage = Enum.count(shops, &(service in (&1.services_offered || [])))
      {service, coverage}
    end)
    |> Enum.filter(fn {_service, coverage} -> coverage < (length(shops) * 0.3) end)
    |> Enum.into(%{})
  end

  defp calculate_avg_experience(technicians) do
    experiences = technicians |> Enum.map(&(&1.experience_years || 0))
    if Enum.empty?(experiences), do: 0, else: Enum.sum(experiences) / length(experiences)
  end

  defp calculate_combined_market_value(technicians, shops) do
    tech_value = technicians
      |> Enum.map(fn tech ->
        intelligence = Technician.generate_intelligence_report(tech)
        intelligence.market_value.estimated_annual_revenue
      end)
      |> Enum.sum()

    shop_value = shops
      |> Enum.map(fn shop ->
        intelligence = Shop.generate_market_intelligence(shop)
        intelligence.equipment_investment.estimated_equipment_value
      end)
      |> Enum.sum()

    %{
      technician_revenue_potential: tech_value,
      shop_equipment_value: shop_value,
      total_market_value: tech_value + shop_value
    }
  end
end