defmodule NukeApi.EctoTypes.JsonbStringArray do
  @moduledoc """
  Ecto type for a Postgres jsonb column that stores an array of strings.

  Supabase schema uses JSONB for `mailbox_messages.read_by` with a default of `[]`.
  Ecto's built-in `:map` expects objects, not arrays, so we use a custom type.
  """

  @behaviour Ecto.Type

  @impl true
  def type, do: :map

  @impl true
  def cast(nil), do: {:ok, []}

  def cast(list) when is_list(list) do
    {:ok,
     list
     |> Enum.map(&to_string/1)
     |> Enum.reject(&(&1 == ""))}
  end

  def cast(_), do: :error

  @impl true
  def load(nil), do: {:ok, []}
  def load(list) when is_list(list), do: cast(list)
  def load(_), do: :error

  @impl true
  def dump(nil), do: {:ok, []}
  def dump(list) when is_list(list), do: cast(list)
  def dump(_), do: :error
end


