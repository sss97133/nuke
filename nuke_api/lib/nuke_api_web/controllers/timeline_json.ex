defmodule NukeApiWeb.TimelineJSON do
  @moduledoc """
  JSON view for Timeline events in the Nuke platform's vehicle-centric architecture.
  
  Timeline events represent the immutable record-keeping component of the vehicle digital identity.
  """
  
  alias NukeApi.Vehicles.Timeline

  @doc """
  Renders a list of timeline events.
  """
  def index(%{timeline_events: timeline_events}) do
    %{data: for(event <- timeline_events, do: data(event))}
  end

  @doc """
  Renders a single timeline event.
  """
  def show(%{timeline: timeline}) do
    %{data: data(timeline)}
  end

  @doc """
  Converts a timeline event struct to a map of attributes.
  """
  def data(%Timeline{} = timeline) do
    %{
      id: timeline.id,
      vehicle_id: timeline.vehicle_id,
      event_type: timeline.event_type,
      event_date: timeline.event_date,
      source: timeline.source,
      confidence_score: timeline.confidence_score,
      title: timeline.title,
      description: timeline.description,
      location: timeline.location,
      creator_id: timeline.creator_id,
      verified: timeline.verified,
      verifier_id: timeline.verifier_id,
      metadata: timeline.metadata,
      inserted_at: timeline.inserted_at,
      updated_at: timeline.updated_at
    }
  end
end
