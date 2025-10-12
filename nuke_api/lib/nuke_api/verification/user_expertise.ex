defmodule NukeApi.Verification.UserExpertise do
  @moduledoc """
  Schema for UserExpertise - tracks user expertise for weighted verification.

  Users can have expertise in different areas (automotive, tools, etc.) which
  affects the weight of their verifications in the trust scoring system.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "user_expertise" do
    field :user_id, :binary_id
    field :expertise_type, :string
    field :expertise_level, :string, default: "novice"

    # Credentials
    field :certifications, {:array, :string}, default: []
    field :years_experience, :integer, default: 0
    field :specializations, {:array, :string}, default: []

    # Performance metrics
    field :verification_count, :integer, default: 0
    field :accuracy_score, :decimal, default: Decimal.new("0.00")
    field :trust_rating, :integer, default: 0

    # Professional information
    field :business_name, :string
    field :business_license, :string
    field :insurance_info, :string

    field :verified_at, :utc_datetime
    field :verified_by, :binary_id

    timestamps()
  end

  @required_fields ~w(user_id expertise_type)a
  @optional_fields ~w(
    expertise_level certifications years_experience specializations
    verification_count accuracy_score trust_rating business_name
    business_license insurance_info verified_at verified_by
  )a

  @expertise_types [
    "automotive", "tools", "parts", "damage_assessment", "restoration",
    "welding", "electrical", "bodywork", "engine", "transmission"
  ]

  @expertise_levels [
    "novice", "intermediate", "expert", "professional"
  ]

  @doc """
  Creates a changeset for user expertise.
  """
  def changeset(expertise, attrs) do
    expertise
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> validate_inclusion(:expertise_type, @expertise_types)
    |> validate_inclusion(:expertise_level, @expertise_levels)
    |> validate_number(:years_experience, greater_than_or_equal_to: 0)
    |> validate_number(:verification_count, greater_than_or_equal_to: 0)
    |> validate_number(:trust_rating, greater_than_or_equal_to: 0, less_than_or_equal_to: 100)
    |> unique_constraint([:user_id, :expertise_type])
  end

  @doc """
  Updates verification metrics after a user performs a verification.
  """
  def update_verification_metrics(expertise, verification_was_accurate) do
    new_count = expertise.verification_count + 1

    # Calculate new accuracy score
    current_accuracy = Decimal.to_float(expertise.accuracy_score)
    accuracy_adjustment = if verification_was_accurate, do: 1.0, else: 0.0
    new_accuracy = (current_accuracy * expertise.verification_count + accuracy_adjustment) / new_count

    # Calculate new trust rating based on accuracy and experience
    new_trust_rating = calculate_trust_rating(new_accuracy, expertise.years_experience, new_count)

    change(expertise, %{
      verification_count: new_count,
      accuracy_score: Decimal.from_float(new_accuracy),
      trust_rating: new_trust_rating
    })
  end

  @doc """
  Gets the trust weight multiplier for a user based on their expertise.
  """
  def get_trust_weight_multiplier(_user_id, expertise_type) do
    # This would typically be called from the verification system
    # Base implementation - can be enhanced with actual database lookup
    case expertise_type do
      "professional" -> 2.0
      "expert" -> 1.5
      "intermediate" -> 1.0
      "novice" -> 0.5
      _ -> 1.0
    end
  end

  # Private helper to calculate trust rating
  defp calculate_trust_rating(accuracy_percentage, years_experience, verification_count) do
    # Base score from accuracy (0-50 points)
    accuracy_points = accuracy_percentage * 50

    # Experience points (0-30 points, capped at 10 years)
    experience_points = min(30, years_experience * 3)

    # Activity points (0-20 points, based on verification count)
    activity_points = min(20, verification_count * 0.5)

    # Combine and round
    total = accuracy_points + experience_points + activity_points
    min(100, round(total))
  end
end