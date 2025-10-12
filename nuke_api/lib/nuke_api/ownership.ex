defmodule NukeApi.Ownership do
  @moduledoc """
  The Ownership context - handles vehicle ownership verification and permissions.

  This module consolidates all ownership-related functionality:
  - Legal ownership verification through documents
  - Contributor access management
  - Unified ownership status determination
  - Permission checks for vehicle operations
  """

  import Ecto.Query, warn: false
  alias NukeApi.Repo

  alias NukeApi.Ownership.{OwnershipVerification, VehicleContributor}
  alias NukeApi.Vehicles.Vehicle

  @doc """
  Determines the comprehensive ownership status for a user and vehicle.
  Returns a tuple with the ownership level and details.
  """
  def get_ownership_status(vehicle_id, user_id) when not is_nil(user_id) do
    with {:ok, vehicle} <- get_vehicle(vehicle_id) do
      # Check database uploader (who uploaded/imported the vehicle - NOT ownership)
      is_uploader = vehicle.uploaded_by == user_id

      # Check legal ownership verification
      legal_verification = get_approved_ownership_verification(vehicle_id, user_id)
      is_legal_owner = not is_nil(legal_verification)

      # Check contributor access
      contributor = get_active_contributor(vehicle_id, user_id)

      status = determine_ownership_level(is_uploader, is_legal_owner, contributor)

      {:ok, %{
        status: status,
        is_uploader: is_uploader,  # Changed: now tracks uploader, not owner
        is_legal_owner: is_legal_owner,
        contributor_role: contributor && contributor.role,
        has_contributor_access: not is_nil(contributor),
        verification: legal_verification,
        contributor: contributor
      }}
    end
  end

  def get_ownership_status(_vehicle_id, nil), do: {:ok, %{status: :no_access}}

  @doc """
  Checks if a user has permission to perform a specific action on a vehicle.
  """
  def has_permission?(vehicle_id, user_id, action) do
    case get_ownership_status(vehicle_id, user_id) do
      {:ok, ownership} -> check_action_permission(ownership, action)
      {:error, _} -> false
    end
  end

  @doc """
  Submit ownership verification documents.
  """
  def submit_ownership_verification(attrs) do
    attrs = Map.put(attrs, :submitted_at, DateTime.utc_now())

    %OwnershipVerification{}
    |> OwnershipVerification.changeset(attrs)
    |> Repo.insert()
  end

  @doc """
  Review and approve/reject ownership verification.
  """
  def review_ownership_verification(verification_id, reviewer_id, decision, notes \\ nil) do
    verification = Repo.get!(OwnershipVerification, verification_id)

    attrs = %{
      status: decision,
      human_reviewer_id: reviewer_id,
      human_reviewed_at: DateTime.utc_now(),
      human_review_notes: notes
    }

    verification
    |> OwnershipVerification.changeset(attrs)
    |> Repo.update()
  end

  @doc """
  Add a contributor to a vehicle.
  """
  def add_contributor(attrs) do
    %VehicleContributor{}
    |> VehicleContributor.changeset(attrs)
    |> Repo.insert()
  end

  @doc """
  Remove or deactivate a contributor.
  """
  def remove_contributor(vehicle_id, user_id, role) do
    contributor = get_contributor(vehicle_id, user_id, role)

    if contributor do
      contributor
      |> VehicleContributor.changeset(%{status: "inactive"})
      |> Repo.update()
    else
      {:error, :not_found}
    end
  end

  @doc """
  Get all ownership verifications for a vehicle.
  """
  def list_ownership_verifications(vehicle_id) do
    OwnershipVerification
    |> where([v], v.vehicle_id == ^vehicle_id)
    |> order_by([v], desc: v.inserted_at)
    |> Repo.all()
  end

  @doc """
  Get all ownership verifications for a specific vehicle.
  Alias for list_ownership_verifications to match controller expectations.
  """
  def list_vehicle_ownership_verifications(vehicle_id) do
    list_ownership_verifications(vehicle_id)
  end

  @doc """
  Create a new ownership verification.
  """
  def create_ownership_verification(attrs \\ %{}) do
    %OwnershipVerification{}
    |> OwnershipVerification.changeset(attrs)
    |> Repo.insert()
  end

  @doc """
  Get a single ownership verification by ID.
  """
  def get_ownership_verification(id), do: Repo.get(OwnershipVerification, id)

  @doc """
  Update an ownership verification.
  """
  def update_ownership_verification(%OwnershipVerification{} = verification, attrs) do
    verification
    |> OwnershipVerification.changeset(attrs)
    |> Repo.update()
  end

  @doc """
  Get all contributors for a vehicle.
  """
  def list_contributors(vehicle_id) do
    VehicleContributor
    |> where([c], c.vehicle_id == ^vehicle_id)
    |> where([c], c.status == "active")
    |> preload([:user])
    |> order_by([c], c.inserted_at)
    |> Repo.all()
  end

  # Private functions

  defp get_vehicle(vehicle_id) do
    case Repo.get(Vehicle, vehicle_id) do
      nil -> {:error, :not_found}
      vehicle -> {:ok, vehicle}
    end
  end

  defp get_approved_ownership_verification(vehicle_id, user_id) do
    OwnershipVerification
    |> where([v], v.vehicle_id == ^vehicle_id and v.user_id == ^user_id and v.status == "approved")
    |> limit(1)
    |> Repo.one()
  end

  defp get_active_contributor(vehicle_id, user_id) do
    VehicleContributor
    |> where([c], c.vehicle_id == ^vehicle_id and c.user_id == ^user_id and c.status == "active")
    |> limit(1)
    |> Repo.one()
  end

  defp get_contributor(vehicle_id, user_id, role) do
    VehicleContributor
    |> where([c], c.vehicle_id == ^vehicle_id and c.user_id == ^user_id and c.role == ^role)
    |> Repo.one()
  end

  defp determine_ownership_level(is_uploader, is_legal_owner, contributor) do
    cond do
      is_legal_owner -> :legal_owner
      contributor && contributor.role == "owner" -> :contributor_owner
      contributor && contributor.role == "previous_owner" -> :previous_owner
      contributor && contributor.role == "restorer" -> :restorer
      contributor -> :contributor
      is_uploader -> :uploader  # New: uploader has basic access but is NOT an owner
      true -> :viewer
    end
  end

  defp check_action_permission(ownership, action) do
    case {ownership.status, action} do
      # Legal owners can do everything
      {:legal_owner, _} -> true

      # Contributor owners have edit access
      {:contributor_owner, :view} -> true
      {:contributor_owner, :edit} -> true
      {:contributor_owner, :delete} -> false

      # Previous owners have limited edit access
      {:previous_owner, :view} -> true
      {:previous_owner, :edit} -> true
      {:previous_owner, :delete} -> false

      # Restorers have specialized edit access
      {:restorer, :view} -> true
      {:restorer, :edit} -> true
      {:restorer, :delete} -> false

      # General contributors have limited edit access
      {:contributor, :view} -> true
      {:contributor, :edit} -> true
      {:contributor, :delete} -> false

      # Uploaders have basic edit access but CANNOT delete or transfer
      {:uploader, :view} -> true
      {:uploader, :edit} -> true
      {:uploader, :delete} -> false  # Critical: uploaders cannot delete
      {:uploader, :transfer} -> false # Critical: uploaders cannot transfer ownership

      # Viewers can only view
      {:viewer, :view} -> true
      {:viewer, _} -> false

      # No access
      {:no_access, _} -> false

      # Default deny
      _ -> false
    end
  end
end