defmodule NukeApiWeb.OwnershipVerificationJSON do
  @moduledoc """
  JSON view for Ownership Verifications in the Nuke platform.

  Ownership verifications provide secure document-based verification for vehicle ownership.
  """

  alias NukeApi.Ownership.OwnershipVerification

  @doc """
  Renders a list of ownership verifications.
  """
  def index(%{ownership_verifications: verifications}) do
    %{data: for(verification <- verifications, do: data(verification))}
  end

  @doc """
  Renders a single ownership verification.
  """
  def show(%{ownership_verification: verification}) do
    %{data: data(verification)}
  end

  @doc """
  Converts an ownership verification struct to a map of attributes.
  """
  def data(%OwnershipVerification{} = verification) do
    %{
      id: verification.id,
      user_id: verification.user_id,
      vehicle_id: verification.vehicle_id,
      status: verification.status,
      verification_type: verification.verification_type,
      title_document_url: verification.title_document_url,
      drivers_license_url: verification.drivers_license_url,
      face_scan_url: verification.face_scan_url,
      insurance_document_url: verification.insurance_document_url,
      extracted_data: verification.extracted_data,
      title_owner_name: verification.title_owner_name,
      license_holder_name: verification.license_holder_name,
      vehicle_vin_from_title: verification.vehicle_vin_from_title,
      ai_confidence_score: verification.ai_confidence_score,
      ai_processing_results: verification.ai_processing_results,
      name_match_score: verification.name_match_score,
      vin_match_confirmed: verification.vin_match_confirmed,
      document_authenticity_score: verification.document_authenticity_score,
      human_reviewer_id: verification.human_reviewer_id,
      human_review_notes: verification.human_review_notes,
      rejection_reason: verification.rejection_reason,
      requires_supervisor_review: verification.requires_supervisor_review,
      submitted_at: verification.submitted_at,
      ai_processed_at: verification.ai_processed_at,
      human_reviewed_at: verification.human_reviewed_at,
      approved_at: verification.approved_at,
      rejected_at: verification.rejected_at,
      expires_at: verification.expires_at
    }
  end
end