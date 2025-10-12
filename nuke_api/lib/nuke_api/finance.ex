defmodule NukeApi.Finance do
  @moduledoc """
  The Finance context for vehicle financial tracking.

  Provides comprehensive accounting features for vehicle ownership including:
  - Cost basis tracking (purchase price + improvements)
  - Expense categorization and tracking
  - Tax reporting and depreciation
  - Profit/loss calculations
  - Market valuations and appraisals
  """

  import Ecto.Query, warn: false
  alias NukeApi.Repo
  alias NukeApi.Finance.{Transaction, CostBasis, Valuation}

  # Transaction operations

  @doc """
  Returns the list of financial transactions for a vehicle.
  """
  def list_vehicle_transactions(vehicle_id, opts \\ []) do
    transaction_type = Keyword.get(opts, :transaction_type)
    category = Keyword.get(opts, :category)
    from_date = Keyword.get(opts, :from_date)
    to_date = Keyword.get(opts, :to_date)

    query = from t in Transaction,
      where: t.vehicle_id == ^vehicle_id,
      order_by: [desc: t.transaction_date, desc: t.inserted_at]

    query = if transaction_type, do: from(t in query, where: t.transaction_type == ^transaction_type), else: query
    query = if category, do: from(t in query, where: t.category == ^category), else: query
    query = if from_date, do: from(t in query, where: t.transaction_date >= ^from_date), else: query
    query = if to_date, do: from(t in query, where: t.transaction_date <= ^to_date), else: query

    Repo.all(query)
  end

  @doc """
  Gets a single transaction.
  """
  def get_transaction(id), do: Repo.get(Transaction, id)

  @doc """
  Creates a financial transaction.
  """
  def create_transaction(attrs \\ %{}) do
    %Transaction{}
    |> Transaction.changeset(attrs)
    |> Repo.insert()
    |> maybe_update_cost_basis(attrs)
  end

  @doc """
  Updates a financial transaction.
  """
  def update_transaction(%Transaction{} = transaction, attrs) do
    transaction
    |> Transaction.changeset(attrs)
    |> Repo.update()
    |> maybe_update_cost_basis(attrs)
  end

  @doc """
  Deletes a financial transaction.
  """
  def delete_transaction(%Transaction{} = transaction) do
    result = Repo.delete(transaction)
    # TODO: Recalculate cost basis after deletion
    result
  end

  # Cost Basis operations

  @doc """
  Gets or creates cost basis for a vehicle.
  """
  def get_or_create_cost_basis(vehicle_id) do
    case Repo.get_by(CostBasis, vehicle_id: vehicle_id) do
      nil -> %CostBasis{vehicle_id: vehicle_id}
      cost_basis -> cost_basis
    end
  end

  @doc """
  Updates cost basis for a vehicle.
  """
  def update_cost_basis(%CostBasis{} = cost_basis, attrs) do
    cost_basis
    |> CostBasis.changeset(attrs)
    |> Repo.insert_or_update()
  end

  @doc """
  Calculates total cost basis for a vehicle including all improvements.
  """
  def calculate_total_cost_basis(vehicle_id) do
    cost_basis = get_or_create_cost_basis(vehicle_id)
    transactions = list_vehicle_transactions(vehicle_id, transaction_type: "improvement")

    base_cost = Decimal.new(cost_basis.purchase_price || 0)
    |> Decimal.add(Decimal.new(cost_basis.title_fees || 0))
    |> Decimal.add(Decimal.new(cost_basis.registration_fees || 0))
    |> Decimal.add(Decimal.new(cost_basis.inspection_fees || 0))
    |> Decimal.add(Decimal.new(cost_basis.transportation_costs || 0))
    |> Decimal.add(Decimal.new(cost_basis.auction_fees || 0))
    |> Decimal.add(Decimal.new(cost_basis.other_acquisition_costs || 0))

    improvement_costs = transactions
    |> Enum.reduce(Decimal.new(0), fn transaction, acc ->
      Decimal.add(acc, Decimal.new(transaction.amount || 0))
    end)

    Decimal.add(base_cost, improvement_costs)
  end

  @doc """
  Calculates profit/loss for a vehicle sale.
  """
  def calculate_profit_loss(vehicle_id, sale_price) do
    total_basis = calculate_total_cost_basis(vehicle_id)
    sale_expenses = get_sale_expenses(vehicle_id)

    net_sale_price = Decimal.sub(Decimal.new(sale_price), sale_expenses)
    profit_loss = Decimal.sub(net_sale_price, total_basis)

    %{
      total_basis: total_basis,
      sale_price: Decimal.new(sale_price),
      sale_expenses: sale_expenses,
      net_sale_price: net_sale_price,
      profit_loss: profit_loss,
      profit_loss_percentage: Decimal.div(profit_loss, total_basis) |> Decimal.mult(100)
    }
  end

  # Valuation operations

  @doc """
  Returns valuations for a vehicle.
  """
  def list_vehicle_valuations(vehicle_id) do
    from(v in Valuation,
      where: v.vehicle_id == ^vehicle_id,
      order_by: [desc: v.valuation_date]
    )
    |> Repo.all()
  end

  @doc """
  Creates a vehicle valuation.
  """
  def create_valuation(attrs \\ %{}) do
    %Valuation{}
    |> Valuation.changeset(attrs)
    |> Repo.insert()
  end

  # Reporting functions

  @doc """
  Generates expense report by category for a vehicle.
  """
  def expense_report_by_category(vehicle_id, year \\ nil) do
    query = from t in Transaction,
      where: t.vehicle_id == ^vehicle_id,
      select: {t.category, sum(t.amount)},
      group_by: t.category,
      order_by: [desc: sum(t.amount)]

    query = if year do
      from t in query,
        where: fragment("EXTRACT(year FROM ?)", t.transaction_date) == ^year
    else
      query
    end

    Repo.all(query)
    |> Enum.map(fn {category, total} ->
      %{category: category, total: Decimal.new(total || 0)}
    end)
  end

  @doc """
  Generates tax deductible expenses report.
  """
  def tax_deductible_expenses_report(vehicle_id, year) do
    from(t in Transaction,
      where: t.vehicle_id == ^vehicle_id and
             t.business_expense == true and
             fragment("EXTRACT(year FROM ?)", t.transaction_date) == ^year,
      order_by: [asc: t.transaction_date]
    )
    |> Repo.all()
  end

  # Private helper functions

  defp maybe_update_cost_basis({:ok, transaction}, _attrs) do
    # Update cost basis totals when certain transaction types are created/updated
    case transaction.transaction_type do
      "improvement" -> recalculate_cost_basis(transaction.vehicle_id)
      "purchase" -> recalculate_cost_basis(transaction.vehicle_id)
      _ -> :ok
    end
    {:ok, transaction}
  end

  defp maybe_update_cost_basis(error, _attrs), do: error

  defp recalculate_cost_basis(vehicle_id) do
    # Recalculate and update cost basis totals
    improvements_total = from(t in Transaction,
      where: t.vehicle_id == ^vehicle_id and t.transaction_type == "improvement",
      select: sum(t.amount)
    ) |> Repo.one() || Decimal.new(0)

    maintenance_total = from(t in Transaction,
      where: t.vehicle_id == ^vehicle_id and t.transaction_type == "maintenance",
      select: sum(t.amount)
    ) |> Repo.one() || Decimal.new(0)

    cost_basis = get_or_create_cost_basis(vehicle_id)

    update_cost_basis(cost_basis, %{
      total_improvements: improvements_total,
      total_maintenance: maintenance_total,
      total_basis: calculate_total_cost_basis(vehicle_id)
    })
  end

  defp get_sale_expenses(vehicle_id) do
    from(t in Transaction,
      where: t.vehicle_id == ^vehicle_id and t.transaction_type == "sale_expense",
      select: sum(t.amount)
    )
    |> Repo.one()
    |> case do
      nil -> Decimal.new(0)
      amount -> Decimal.new(amount)
    end
  end
end