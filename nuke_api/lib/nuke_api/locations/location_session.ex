defmodule NukeApi.Locations.LocationSession do
  @moduledoc """
  Schema for individual work sessions at a location.

  Tracks what actually happens during each work session to build patterns
  about the location's usage and professional level.
  """

  use Ecto.Schema
  import Ecto.Changeset
  alias NukeApi.Locations.WorkLocation

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "location_sessions" do
    belongs_to :work_location, WorkLocation
    field :user_id, :binary_id
    field :vehicle_id, :binary_id

    # Session characteristics
    field :session_type, :string
    field :start_time, :utc_datetime
    field :end_time, :utc_datetime
    field :duration_minutes, :integer

    # Environmental conditions
    field :weather_condition, :string
    field :temperature, :integer
    field :lighting_quality, :string

    # Work performed
    field :tools_used, {:array, :string}, default: []
    field :parts_installed, {:array, :string}, default: []
    field :completion_status, :string

    # Quality indicators
    field :photo_count, :integer, default: 0
    field :tag_count, :integer, default: 0
    field :quality_score, :integer, default: 0

    timestamps(type: :utc_datetime)
  end

  @session_types ["diagnostic", "repair", "maintenance", "restoration", "fabrication", "detailing", "inspection"]
  @weather_conditions ["clear", "rain", "snow", "hot", "cold", "humid", "windy"]
  @lighting_qualities ["natural", "artificial", "poor", "excellent", "mixed"]
  @completion_statuses ["completed", "in_progress", "abandoned", "needs_parts", "needs_help"]

  @required_fields [:work_location_id, :user_id, :session_type]
  @optional_fields [:vehicle_id, :start_time, :end_time, :duration_minutes,
                   :weather_condition, :temperature, :lighting_quality,
                   :tools_used, :parts_installed, :completion_status,
                   :photo_count, :tag_count, :quality_score]

  def changeset(session, attrs) do
    session
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> validate_inclusion(:session_type, @session_types)
    |> validate_inclusion(:weather_condition, @weather_conditions)
    |> validate_inclusion(:lighting_quality, @lighting_qualities)
    |> validate_inclusion(:completion_status, @completion_statuses)
    |> validate_number(:duration_minutes, greater_than_or_equal_to: 0)
    |> validate_number(:temperature, greater_than_or_equal_to: -40, less_than_or_equal_to: 120)
    |> validate_number(:photo_count, greater_than_or_equal_to: 0)
    |> validate_number(:tag_count, greater_than_or_equal_to: 0)
    |> validate_number(:quality_score, greater_than_or_equal_to: 0, less_than_or_equal_to: 100)
    |> foreign_key_constraint(:work_location_id)
    |> maybe_calculate_duration()
  end

  defp maybe_calculate_duration(changeset) do
    start_time = get_field(changeset, :start_time)
    end_time = get_field(changeset, :end_time)

    case {start_time, end_time} do
      {%DateTime{} = start, %DateTime{} = finish} ->
        duration = DateTime.diff(finish, start, :minute)
        put_change(changeset, :duration_minutes, duration)
      _ ->
        changeset
    end
  end

  @doc """
  Calculates session quality based on documentation and completion.
  """
  def calculate_session_quality(session) do
    base_score = 40

    # Documentation quality
    photo_bonus = min(session.photo_count * 5, 30)
    tag_bonus = min(session.tag_count * 3, 20)

    # Completion bonus
    completion_bonus = case session.completion_status do
      "completed" -> 20
      "in_progress" -> 10
      "needs_parts" -> 5
      _ -> 0
    end

    # Tool usage complexity
    tool_bonus = min(length(session.tools_used || []) * 2, 10)

    total_score = base_score + photo_bonus + tag_bonus + completion_bonus + tool_bonus
    min(total_score, 100)
  end

  @doc """
  Analyzes session patterns to determine work context.
  """
  def analyze_work_context(sessions) when is_list(sessions) do
    if Enum.empty?(sessions) do
      %{context: "unknown", confidence: 0}
    else
      avg_duration = sessions
        |> Enum.map(& &1.duration_minutes || 0)
        |> Enum.sum()
        |> div(length(sessions))

      completion_rate = sessions
        |> Enum.count(&(&1.completion_status == "completed"))
        |> Kernel./(length(sessions))

      tool_diversity = sessions
        |> Enum.flat_map(&(&1.tools_used || []))
        |> Enum.uniq()
        |> length()

      context = cond do
        avg_duration >= 240 && completion_rate >= 0.8 && tool_diversity >= 10 -> "professional"
        avg_duration >= 120 && completion_rate >= 0.7 && tool_diversity >= 6 -> "experienced"
        avg_duration >= 60 && completion_rate >= 0.5 -> "hobbyist"
        true -> "casual"
      end

      confidence = calculate_pattern_confidence(sessions, avg_duration, completion_rate, tool_diversity)

      %{context: context, confidence: confidence, avg_duration: avg_duration}
    end
  end

  defp calculate_pattern_confidence(sessions, _avg_duration, _completion_rate, tool_diversity) do
    sample_size_factor = min(length(sessions) / 10, 1.0) # More sessions = higher confidence
    consistency_factor = calculate_consistency(sessions)

    base_confidence = 30

    confidence = base_confidence +
      round(sample_size_factor * 30) +
      round(consistency_factor * 25) +
      min(tool_diversity * 2, 15) # Tool diversity adds confidence

    min(confidence, 100)
  end

  defp calculate_consistency(sessions) do
    if length(sessions) < 2 do
      0.5
    else
      durations = Enum.map(sessions, &(&1.duration_minutes || 0))
      avg_duration = Enum.sum(durations) / length(durations)

      variance = durations
        |> Enum.map(&((&1 - avg_duration) ** 2))
        |> Enum.sum()
        |> Kernel./(length(durations))

      # Lower variance = higher consistency
      consistency = 1 / (1 + variance / 10000) # Normalize variance
      max(min(consistency, 1.0), 0.0)
    end
  end

  @doc """
  Groups sessions by time patterns to detect professional schedules.
  """
  def detect_schedule_patterns(sessions) do
    if length(sessions) < 3 do
      %{pattern: "insufficient_data", confidence: 0}
    else
      # Analyze by day of week
      day_distribution = sessions
        |> Enum.filter(&(&1.start_time))
        |> Enum.group_by(&Date.day_of_week(DateTime.to_date(&1.start_time)))
        |> Enum.map(fn {day, day_sessions} -> {day, length(day_sessions)} end)
        |> Enum.into(%{})

      # Analyze by time of day
      hour_distribution = sessions
        |> Enum.filter(&(&1.start_time))
        |> Enum.group_by(&(&1.start_time.hour))
        |> Enum.map(fn {hour, hour_sessions} -> {hour, length(hour_sessions)} end)
        |> Enum.into(%{})

      weekend_sessions = Map.get(day_distribution, 6, 0) + Map.get(day_distribution, 7, 0)
      weekday_sessions = Enum.sum(Enum.map([1, 2, 3, 4, 5], &Map.get(day_distribution, &1, 0)))

      business_hours = Enum.sum(Enum.map(8..17, &Map.get(hour_distribution, &1, 0)))
      evening_hours = Enum.sum(Enum.map(18..22, &Map.get(hour_distribution, &1, 0)))

      pattern = cond do
        weekday_sessions > weekend_sessions * 2 && business_hours > evening_hours ->
          "professional_schedule"
        weekend_sessions > weekday_sessions && evening_hours > business_hours ->
          "hobbyist_schedule"
        weekday_sessions > 0 && weekend_sessions > 0 ->
          "mixed_schedule"
        true ->
          "irregular_schedule"
      end

      confidence = calculate_schedule_confidence(sessions, day_distribution, hour_distribution)

      %{
        pattern: pattern,
        confidence: confidence,
        weekday_ratio: weekday_sessions / max(weekday_sessions + weekend_sessions, 1),
        business_hours_ratio: business_hours / max(length(sessions), 1)
      }
    end
  end

  defp calculate_schedule_confidence(sessions, day_dist, hour_dist) do
    # Higher confidence if there's a clear pattern
    day_variance = day_dist |> Map.values() |> calculate_variance()
    hour_variance = hour_dist |> Map.values() |> calculate_variance()

    # More sessions with clear patterns = higher confidence
    base_confidence = min(length(sessions) * 5, 50)

    # Lower variance = higher confidence (more predictable pattern)
    pattern_confidence = 50 - min(day_variance + hour_variance, 40)

    round(base_confidence + pattern_confidence)
  end

  defp calculate_variance(values) when is_list(values) and length(values) > 1 do
    mean = Enum.sum(values) / length(values)
    variance = values
      |> Enum.map(&((&1 - mean) ** 2))
      |> Enum.sum()
      |> Kernel./(length(values))

    min(variance, 20) # Cap variance for confidence calculation
  end
  defp calculate_variance(_), do: 0
end