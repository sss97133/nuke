defmodule NukeApi.Skynalysis.Analysis do
  @moduledoc """
  Skynalysis Analysis Schema
  
  Represents a single AI analysis request and its results
  """
  
  use Ecto.Schema
  import Ecto.Changeset
  
  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  
  schema "skynalysis_analyses" do
    field :analysis_type, :string
    field :status, :string, default: "pending"
    field :input_parameters, :map, default: %{}
    field :input_images, {:array, :map}, default: []
    field :raw_response, :map
    field :analysis_summary, :string
    field :confidence_score, :decimal
    field :key_findings, {:array, :string}, default: []
    field :recommendations, {:array, :string}, default: []
    field :processing_time_ms, :integer
    field :cost_cents, :integer
    field :error_message, :string
    field :started_at, :utc_datetime
    field :completed_at, :utc_datetime
    
    belongs_to :vehicle, NukeApi.Vehicles.Vehicle
    belongs_to :ai_processor, NukeApi.Skynalysis.AIProcessor
    belongs_to :user, NukeApi.Accounts.User
    
    timestamps(type: :utc_datetime)
  end
  
  @doc false
  def changeset(analysis, attrs) do
    analysis
    |> cast(attrs, [
      :analysis_type, :status, :input_parameters, :input_images,
      :raw_response, :analysis_summary, :confidence_score,
      :key_findings, :recommendations, :processing_time_ms,
      :cost_cents, :error_message, :started_at, :completed_at,
      :vehicle_id, :ai_processor_id, :user_id
    ])
    |> validate_required([:analysis_type, :status, :vehicle_id, :ai_processor_id, :user_id])
    |> validate_inclusion(:status, ["pending", "processing", "completed", "failed"])
    |> validate_inclusion(:analysis_type, [
      "complete_analysis", "condition_assessment", "damage_detection", 
      "market_value", "authenticity_check", "timeline_analysis"
    ])
    |> foreign_key_constraint(:vehicle_id)
    |> foreign_key_constraint(:ai_processor_id)
    |> foreign_key_constraint(:user_id)
  end
end
