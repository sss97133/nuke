defmodule NukeApi.Skynalysis.AIProcessor do
  @moduledoc """
  Skynalysis AI Processor Schema
  
  Represents available AI processors for vehicle analysis
  """
  
  use Ecto.Schema
  import Ecto.Changeset
  
  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  
  schema "skynalysis_ai_processors" do
    field :name, :string
    field :display_name, :string
    field :description, :string
    field :provider, :string
    field :model_name, :string
    field :capabilities, {:array, :string}, default: []
    field :is_active, :boolean, default: true
    field :cost_per_image_cents, :integer
    field :max_images_per_request, :integer
    field :supported_formats, {:array, :string}, default: ["jpg", "jpeg", "png", "webp"]
    field :configuration, :map, default: %{}
    
    has_many :analyses, NukeApi.Skynalysis.Analysis
    
    timestamps(type: :utc_datetime)
  end
  
  @doc false
  def changeset(processor, attrs) do
    processor
    |> cast(attrs, [
      :name, :display_name, :description, :provider, :model_name,
      :capabilities, :is_active, :cost_per_image_cents,
      :max_images_per_request, :supported_formats, :configuration
    ])
    |> validate_required([:name, :display_name, :provider, :model_name])
    |> unique_constraint(:name)
    |> validate_inclusion(:provider, ["anthropic", "aws", "openai", "custom"])
  end
end
