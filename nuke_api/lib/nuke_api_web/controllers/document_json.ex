defmodule NukeApiWeb.DocumentJSON do
  @moduledoc """
  JSON view for Vehicle Documents in the Nuke platform's vehicle-centric architecture.

  Documents provide comprehensive record-keeping and verification for vehicles throughout their lifecycle.
  """

  alias NukeApi.Vehicles.Document

  @doc """
  Renders a list of vehicle documents.
  """
  def index(%{documents: documents}) do
    %{data: for(document <- documents, do: data(document))}
  end

  @doc """
  Renders a single vehicle document.
  """
  def show(%{document: document}) do
    %{data: data(document)}
  end

  @doc """
  Converts a document struct to a map of attributes.
  """
  def data(%Document{} = document) do
    %{
      id: document.id,
      vehicle_id: document.vehicle_id,
      document_type: document.document_type,
      title: document.title,
      description: document.description,
      document_date: document.document_date,
      file_url: document.file_url,
      file_name: document.file_name,
      file_type: document.file_type,
      file_size: document.file_size,
      privacy_level: document.privacy_level,
      contains_pii: document.contains_pii,
      pii_redacted_url: document.pii_redacted_url,
      extracted_data: document.extracted_data,
      vendor_name: document.vendor_name,
      amount: document.amount,
      currency: document.currency,
      parts_ordered: document.parts_ordered,
      service_performed: document.service_performed,
      timeline_event_created: document.timeline_event_created,
      timeline_event_id: document.timeline_event_id,
      uploaded_by: document.uploaded_by
    }
  end
end