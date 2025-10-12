defmodule NukeApi.Locations.LocationPattern do
  @moduledoc """
  Schema for detected behavioral patterns at work locations.

  Captures ML-detected patterns that help classify the professional level
  and work context of a location based on usage data.
  """

  use Ecto.Schema
  import Ecto.Changeset
  alias NukeApi.Locations.WorkLocation

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "location_patterns" do
    belongs_to :work_location, WorkLocation

    # Pattern identification
    field :pattern_type, :string
    field :pattern_name, :string
    field :confidence, :float

    # Pattern statistics
    field :frequency, :integer
    field :consistency, :float
    field :trend, :string

    # Pattern timeline
    field :first_detected, :utc_datetime
    field :last_confirmed, :utc_datetime
    field :sample_size, :integer

    # Pattern details (JSONB)
    field :pattern_data, :map, default: %{}

    timestamps(type: :utc_datetime)
  end

  @pattern_types [
    "tool_usage",
    "work_schedule",
    "quality_level",
    "completion_rate",
    "session_duration",
    "equipment_usage",
    "weather_preference",
    "work_type_specialization"
  ]

  @trends ["increasing", "stable", "decreasing", "seasonal"]

  @required_fields [:work_location_id, :pattern_type, :pattern_name, :confidence]
  @optional_fields [:frequency, :consistency, :trend, :first_detected,
                   :last_confirmed, :sample_size, :pattern_data]

  def changeset(pattern, attrs) do
    pattern
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> validate_inclusion(:pattern_type, @pattern_types)
    |> validate_inclusion(:trend, @trends)
    |> validate_number(:confidence, greater_than_or_equal_to: 0.0, less_than_or_equal_to: 1.0)
    |> validate_number(:consistency, greater_than_or_equal_to: 0.0, less_than_or_equal_to: 1.0)
    |> validate_number(:frequency, greater_than_or_equal_to: 0)
    |> validate_number(:sample_size, greater_than_or_equal_to: 1)
    |> foreign_key_constraint(:work_location_id)
  end

  @doc """
  Detects tool usage patterns from session data.
  """
  def detect_tool_patterns(sessions) do
    if Enum.empty?(sessions) do
      []
    else
      tool_frequencies = sessions
        |> Enum.flat_map(&(&1.tools_used || []))
        |> Enum.frequencies()

      total_sessions = length(sessions)

      tool_frequencies
      |> Enum.filter(fn {_tool, count} -> count / total_sessions >= 0.3 end) # Used in 30%+ of sessions
      |> Enum.map(fn {tool, count} ->
        %{
          pattern_type: "tool_usage",
          pattern_name: "frequent_#{String.downcase(tool)}_usage",
          confidence: min(count / total_sessions, 1.0),
          frequency: count,
          sample_size: total_sessions,
          pattern_data: %{
            tool_name: tool,
            usage_rate: count / total_sessions,
            specialization_indicator: count / total_sessions > 0.7
          }
        }
      end)
    end
  end

  @doc """
  Detects work schedule patterns.
  """
  def detect_schedule_patterns(sessions) do
    if length(sessions) < 5 do
      []
    else
      schedule_analysis = NukeApi.Locations.LocationSession.detect_schedule_patterns(sessions)

      patterns = []

      # Add main schedule pattern
      patterns = [
        %{
          pattern_type: "work_schedule",
          pattern_name: schedule_analysis.pattern,
          confidence: schedule_analysis.confidence / 100.0,
          frequency: length(sessions),
          sample_size: length(sessions),
          pattern_data: %{
            weekday_ratio: schedule_analysis.weekday_ratio,
            business_hours_ratio: schedule_analysis.business_hours_ratio
          }
        }
        | patterns
      ]

      # Add consistency pattern if high
      if schedule_analysis.confidence > 70 do
        patterns = [
          %{
            pattern_type: "work_schedule",
            pattern_name: "high_schedule_consistency",
            confidence: schedule_analysis.confidence / 100.0,
            frequency: length(sessions),
            sample_size: length(sessions),
            pattern_data: %{
              consistency_score: schedule_analysis.confidence
            }
          }
          | patterns
        ]
      end

      patterns
    end
  end

  @doc """
  Detects quality level patterns from session completion and documentation.
  """
  def detect_quality_patterns(sessions) do
    if Enum.empty?(sessions) do
      []
    else
      completion_rate = sessions
        |> Enum.count(&(&1.completion_status == "completed"))
        |> Kernel./(length(sessions))

      avg_photo_count = sessions
        |> Enum.map(& &1.photo_count || 0)
        |> Enum.sum()
        |> div(length(sessions))

      avg_tag_count = sessions
        |> Enum.map(& &1.tag_count || 0)
        |> Enum.sum()
        |> div(length(sessions))

      patterns = []

      # High completion rate pattern
      if completion_rate >= 0.8 do
        patterns = [
          %{
            pattern_type: "quality_level",
            pattern_name: "high_completion_rate",
            confidence: completion_rate,
            frequency: round(completion_rate * length(sessions)),
            sample_size: length(sessions),
            pattern_data: %{
              completion_rate: completion_rate,
              professional_indicator: completion_rate > 0.85
            }
          }
          | patterns
        ]
      end

      # High documentation pattern
      if avg_photo_count >= 5 or avg_tag_count >= 3 do
        patterns = [
          %{
            pattern_type: "quality_level",
            pattern_name: "thorough_documentation",
            confidence: min((avg_photo_count + avg_tag_count * 2) / 15, 1.0),
            frequency: length(sessions),
            sample_size: length(sessions),
            pattern_data: %{
              avg_photos: avg_photo_count,
              avg_tags: avg_tag_count,
              documentation_score: avg_photo_count + avg_tag_count * 2
            }
          }
          | patterns
        ]
      end

      patterns
    end
  end

  @doc """
  Detects equipment usage patterns that indicate professional vs personal use.
  """
  def detect_equipment_patterns(work_location) do
    patterns = []

    # Professional equipment pattern
    equipment_score = calculate_equipment_score(work_location)
    if equipment_score >= 60 do
      patterns = [
        %{
          pattern_type: "equipment_usage",
          pattern_name: "professional_equipment_level",
          confidence: equipment_score / 100.0,
          pattern_data: %{
            equipment_score: equipment_score,
            has_lift: work_location.has_lift,
            has_compressor: work_location.has_compressor,
            has_welding: work_location.has_welding,
            has_specialty_tools: work_location.has_specialty_tools,
            power_level: work_location.power_available
          }
        }
        | patterns
      ]
    end

    patterns
  end

  defp calculate_equipment_score(work_location) do
    score = 0
    score = if work_location.has_lift, do: score + 30, else: score
    score = if work_location.has_compressor, do: score + 20, else: score
    score = if work_location.has_welding, do: score + 20, else: score
    score = if work_location.has_specialty_tools, do: score + 15, else: score

    score = score + case work_location.power_available do
      "industrial_power" -> 15
      "220_available" -> 10
      "basic_110" -> 5
      _ -> 0
    end

    min(score, 100)
  end

  @doc """
  Analyzes all patterns for a work location and updates pattern records.
  """
  def analyze_and_update_patterns(work_location_id, sessions) do
    patterns = []

    # Detect all pattern types
    patterns = patterns ++ detect_tool_patterns(sessions)
    patterns = patterns ++ detect_schedule_patterns(sessions)
    patterns = patterns ++ detect_quality_patterns(sessions)

    # Add timestamps and location reference
    patterns = Enum.map(patterns, fn pattern ->
      pattern
      |> Map.put(:work_location_id, work_location_id)
      |> Map.put(:first_detected, DateTime.utc_now())
      |> Map.put(:last_confirmed, DateTime.utc_now())
    end)

    patterns
  end

  @doc """
  Calculates the overall professional score based on all patterns.
  """
  def calculate_professional_score(patterns) do
    if Enum.empty?(patterns) do
      0
    else
      pattern_scores = Enum.map(patterns, &pattern_to_score/1)
      weighted_average = pattern_scores
        |> Enum.map(fn {score, weight} -> score * weight end)
        |> Enum.sum()
        |> Kernel./(Enum.sum(Enum.map(pattern_scores, fn {_score, weight} -> weight end)))

      round(weighted_average)
    end
  end

  defp pattern_to_score(pattern) do
    base_score = pattern.confidence * 100

    # Weight different pattern types
    weight = case pattern.pattern_type do
      "tool_usage" -> 1.5 # Tool usage is a strong indicator
      "equipment_usage" -> 1.8 # Equipment is strongest indicator
      "work_schedule" -> 1.2 # Schedule patterns are meaningful
      "quality_level" -> 1.3 # Quality indicates professionalism
      _ -> 1.0
    end

    # Boost score for certain professional indicators
    professional_boost = case pattern.pattern_name do
      "professional_equipment_level" -> 10
      "high_completion_rate" -> 5
      "professional_schedule" -> 8
      "thorough_documentation" -> 6
      _ -> 0
    end

    final_score = min(base_score + professional_boost, 100)
    {final_score, weight}
  end
end