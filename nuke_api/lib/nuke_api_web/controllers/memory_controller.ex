defmodule NukeApiWeb.MemoryController do
  use NukeApiWeb, :controller
  import Ecto.Query, warn: false

  alias NukeApi.Memory.WorkMemory
  alias NukeApi.Repo

  def create(conn, %{"vehicle_id" => vehicle_id} = params) do
    attrs = %{
      vehicle_id: vehicle_id,
      memory_text: params["memory_text"],
      confidence_level: params["confidence_level"] || "pretty_sure",
      has_photos: params["has_photos"] || false,
      has_receipts: params["has_receipts"] || false
    }

    case WorkMemory.create_memory(vehicle_id, attrs.memory_text, Map.drop(attrs, [:vehicle_id, :memory_text])) do
      %Ecto.Changeset{valid?: true} = changeset ->
        case Repo.insert(changeset) do
          {:ok, memory} ->
            conn
            |> put_status(:created)
            |> json(memory)

          {:error, changeset} ->
            conn
            |> put_status(:unprocessable_entity)
            |> json(%{errors: format_errors(changeset)})
        end

      changeset ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: format_errors(changeset)})
    end
  end

  def index(conn, %{"vehicle_id" => vehicle_id}) do
    memories =
      WorkMemory
      |> where([m], m.vehicle_id == ^vehicle_id)
      |> order_by([m], desc: m.inserted_at)
      |> Repo.all()

    json(conn, memories)
  end

  def show(conn, %{"id" => id}) do
    case Repo.get(WorkMemory, id) do
      nil ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Memory not found"})

      memory ->
        json(conn, memory)
    end
  end

  def update(conn, %{"id" => id} = params) do
    case Repo.get(WorkMemory, id) do
      nil ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Memory not found"})

      memory ->
        case WorkMemory.changeset(memory, params) do
          %Ecto.Changeset{valid?: true} = changeset ->
            case Repo.update(changeset) do
              {:ok, updated_memory} ->
                json(conn, updated_memory)

              {:error, changeset} ->
                conn
                |> put_status(:unprocessable_entity)
                |> json(%{errors: format_errors(changeset)})
            end

          changeset ->
            conn
            |> put_status(:unprocessable_entity)
            |> json(%{errors: format_errors(changeset)})
        end
    end
  end

  def delete(conn, %{"id" => id}) do
    case Repo.get(WorkMemory, id) do
      nil ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Memory not found"})

      memory ->
        case Repo.delete(memory) do
          {:ok, _memory} ->
            send_resp(conn, :no_content, "")

          {:error, changeset} ->
            conn
            |> put_status(:unprocessable_entity)
            |> json(%{errors: format_errors(changeset)})
        end
    end
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {key, value}, acc ->
        String.replace(acc, "%{#{key}}", to_string(value))
      end)
    end)
  end
end