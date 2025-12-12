defmodule NukeApi.WorkOrders do
  @moduledoc """
  Work Orders context.

  For the mailbox-first workflow we primarily create "draft" work orders from user messages.
  """

  import Ecto.Query, warn: false
  alias NukeApi.Repo

  alias NukeApi.WorkOrders.WorkOrder

  def get_work_order(id), do: Repo.get(WorkOrder, id)

  def create_draft_work_order(attrs) do
    %WorkOrder{}
    |> WorkOrder.changeset(Map.put(attrs, "status", Map.get(attrs, "status", "draft")))
    |> Repo.insert()
  end
end


