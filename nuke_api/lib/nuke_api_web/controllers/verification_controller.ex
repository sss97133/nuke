defmodule NukeApiWeb.VerificationController do
  use NukeApiWeb, :controller

  alias NukeApi.Verification

  action_fallback NukeApiWeb.FallbackController

  @doc """
  Creates a verification for a spatial tag.
  """
  def create_verification(conn, %{"image_id" => image_id, "spatial_tag_id" => spatial_tag_id} = params) do
    action = params["action"] || "verify"

    with true <- conn.assigns.authenticated,
         verifier_opts <- extract_verifier_options(params),
         {:ok, verification} <- Verification.verify_spatial_tag(
           image_id,
           spatial_tag_id,
           conn.assigns.current_user_id,
           action,
           verifier_opts
         ) do

      conn
      |> put_status(:created)
      |> json(%{
        data: verification,
        message: "Verification recorded successfully"
      })
    else
      false ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: "Authentication required"})

      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: format_errors(changeset)})
    end
  end

  @doc """
  Lists verifications for a spatial tag.
  """
  def list_verifications(conn, %{"image_id" => image_id, "spatial_tag_id" => spatial_tag_id}) do
    verifications = Verification.list_tag_verifications(image_id, spatial_tag_id)
    stats = Verification.get_tag_verification_stats(image_id, spatial_tag_id)

    conn
    |> json(%{
      data: verifications,
      stats: stats,
      count: length(verifications)
    })
  end

  @doc """
  Gets verification summary for dashboard.
  """
  def verification_summary(conn, params) do
    date_range = case {params["start_date"], params["end_date"]} do
      {start_str, end_str} when is_binary(start_str) and is_binary(end_str) ->
        with {:ok, start_date} <- Date.from_iso8601(start_str),
             {:ok, end_date} <- Date.from_iso8601(end_str) do
          %{start: start_date, end: end_date}
        else
          _ -> nil
        end
      _ -> nil
    end

    summary = Verification.get_verification_summary(date_range)

    conn
    |> json(%{
      data: summary,
      date_range: date_range
    })
  end

  @doc """
  Creates or updates user expertise.
  """
  def manage_expertise(conn, %{"expertise" => expertise_params}) do
    with true <- conn.assigns.authenticated,
         expertise_params <- Map.put(expertise_params, "user_id", conn.assigns.current_user_id),
         {:ok, expertise} <- Verification.create_user_expertise(expertise_params) do

      conn
      |> put_status(:created)
      |> json(%{data: expertise})
    else
      false ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: "Authentication required"})

      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: format_errors(changeset)})
    end
  end

  @doc """
  Lists user expertise records.
  """
  def list_user_expertise(conn, %{"user_id" => user_id}) do
    expertise_records = Verification.list_user_expertise(user_id)

    conn
    |> json(%{
      data: expertise_records,
      count: length(expertise_records)
    })
  end

  @doc """
  Gets current user's expertise records.
  """
  def my_expertise(conn, _params) do
    with true <- conn.assigns.authenticated do
      expertise_records = Verification.list_user_expertise(conn.assigns.current_user_id)

      conn
      |> json(%{
        data: expertise_records,
        count: length(expertise_records)
      })
    else
      false ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: "Authentication required"})
    end
  end

  @doc """
  Gets top experts for a given expertise type.
  """
  def top_experts(conn, %{"expertise_type" => expertise_type} = params) do
    limit = case params["limit"] do
      nil -> 10
      limit_str -> String.to_integer(limit_str)
    end

    experts = Verification.get_top_experts(expertise_type, limit)

    conn
    |> json(%{
      data: experts,
      expertise_type: expertise_type,
      count: length(experts)
    })
  end

  # =====================================================================================
  # PRIVATE HELPER FUNCTIONS
  # =====================================================================================

  defp extract_verifier_options(params) do
    opts = []

    # Professional credentials
    opts = if params["professional_title"] do
      Keyword.merge(opts, [
        title: params["professional_title"],
        credentials: params["professional_credentials"] || [],
        organization: params["organization"]
      ])
    else
      opts
    end

    # Brand representative
    opts = if params["brand_id"] do
      Keyword.merge(opts, [
        brand_id: params["brand_id"],
        brand_name: params["brand_name"],
        role: params["representative_role"],
        brand_representative: true
      ])
    else
      opts
    end

    # Additional verification data
    opts = if params["verification_data"] do
      Keyword.put(opts, :data, params["verification_data"])
    else
      opts
    end

    opts
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {key, value}, acc ->
        String.replace(acc, "%{#{key}}", to_string(value))
      end)
    end)
  end
end