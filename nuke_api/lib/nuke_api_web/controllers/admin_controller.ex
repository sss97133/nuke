defmodule NukeApiWeb.AdminController do
  use NukeApiWeb, :controller

  alias NukeApi.Vehicles.ImageTags
  alias NukeApi.Vehicles.ImageTag
  alias NukeApi.Repo
  import Ecto.Query

  @doc """
  Dashboard overview with key metrics
  """
  def dashboard(conn, _params) do
    stats = get_dashboard_stats()

    json(conn, %{
      status: "success",
      data: stats
    })
  end

  @doc """
  Get all pending tags for review
  """
  def pending_tags(conn, params) do
    page = Map.get(params, "page", "1") |> String.to_integer()
    per_page = Map.get(params, "per_page", "50") |> String.to_integer()

    offset = (page - 1) * per_page

    tags = from(t in ImageTag,
      where: t.verification_status == "pending",
      order_by: [desc: t.inserted_at],
      limit: ^per_page,
      offset: ^offset,
      preload: [:image]
    )
    |> Repo.all()

    total_count = from(t in ImageTag, where: t.verification_status == "pending")
    |> Repo.aggregate(:count, :id)

    json(conn, %{
      status: "success",
      data: %{
        tags: tags,
        pagination: %{
          page: page,
          per_page: per_page,
          total: total_count,
          total_pages: ceil(total_count / per_page)
        }
      }
    })
  end

  @doc """
  Bulk tag processing - verify, dispute, or assign to corporate clients
  """
  def bulk_process_tags(conn, %{"tag_ids" => tag_ids, "action" => action} = params) do
    case action do
      "verify" ->
        verifier_id = get_current_user_id(conn)
        verification_type = Map.get(params, "verification_type", "professional")

        results = Enum.map(tag_ids, fn tag_id ->
          case ImageTags.get_image_tag(tag_id) do
            nil -> {:error, "Tag not found"}
            tag ->
              case ImageTags.verify_tag(tag, verifier_id, verification_type) do
                {:ok, updated_tag} -> {:ok, updated_tag}
                {:error, changeset} -> {:error, changeset}
              end
          end
        end)

        success_count = Enum.count(results, &match?({:ok, _}, &1))

        json(conn, %{
          status: "success",
          data: %{
            processed: success_count,
            total: length(tag_ids),
            action: "verified"
          }
        })

      "dispute" ->
        disputer_id = get_current_user_id(conn)

        results = Enum.map(tag_ids, fn tag_id ->
          case ImageTags.get_image_tag(tag_id) do
            nil -> {:error, "Tag not found"}
            tag -> ImageTags.dispute_tag(tag, disputer_id)
          end
        end)

        success_count = Enum.count(results, &match?({:ok, _}, &1))

        json(conn, %{
          status: "success",
          data: %{
            processed: success_count,
            total: length(tag_ids),
            action: "disputed"
          }
        })

      "assign_corporate" ->
        corporate_client = Map.get(params, "corporate_client")

        results = Enum.map(tag_ids, fn tag_id ->
          case ImageTags.get_image_tag(tag_id) do
            nil -> {:error, "Tag not found"}
            tag ->
              metadata = Map.put(tag.metadata || %{}, "corporate_client", corporate_client)
              ImageTags.update_image_tag(tag, %{metadata: metadata})
          end
        end)

        success_count = Enum.count(results, &match?({:ok, _}, &1))

        json(conn, %{
          status: "success",
          data: %{
            processed: success_count,
            total: length(tag_ids),
            action: "assigned_to_corporate",
            corporate_client: corporate_client
          }
        })

      _ ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: "Invalid action. Must be 'verify', 'dispute', or 'assign_corporate'"})
    end
  end

  @doc """
  Tag analytics and insights
  """
  def tag_analytics(conn, params) do
    date_range = Map.get(params, "date_range", "30")
    days_ago = String.to_integer(date_range)
    start_date = DateTime.utc_now() |> DateTime.add(-days_ago, :day)

    analytics = %{
      total_tags: get_total_tags(start_date),
      verification_breakdown: get_verification_breakdown(start_date),
      tag_type_distribution: get_tag_type_distribution(start_date),
      trust_score_distribution: get_trust_score_distribution(start_date),
      top_tagged_images: get_top_tagged_images(start_date),
      verification_trends: get_verification_trends(start_date)
    }

    json(conn, %{
      status: "success",
      data: analytics
    })
  end

  @doc """
  Corporate client management
  """
  def corporate_clients(conn, _params) do
    clients = [
      %{
        id: "snap_on",
        name: "Snap-on Tools",
        status: "active",
        tag_types: ["tool", "product", "brand"],
        total_tags: get_corporate_tag_count("snap_on"),
        verified_tags: get_corporate_verified_count("snap_on")
      },
      %{
        id: "milwaukee",
        name: "Milwaukee Electric Tool",
        status: "active",
        tag_types: ["tool", "product", "brand"],
        total_tags: get_corporate_tag_count("milwaukee"),
        verified_tags: get_corporate_verified_count("milwaukee")
      },
      %{
        id: "dewalt",
        name: "DEWALT",
        status: "pending",
        tag_types: ["tool", "product", "brand"],
        total_tags: get_corporate_tag_count("dewalt"),
        verified_tags: get_corporate_verified_count("dewalt")
      }
    ]

    json(conn, %{
      status: "success",
      data: clients
    })
  end

  @doc """
  Export data in various formats
  """
  def export_data(conn, %{"format" => format, "filters" => filters}) do
    tags = get_filtered_tags(filters)

    case format do
      "csv" ->
        csv_data = generate_csv(tags)

        conn
        |> put_resp_content_type("text/csv")
        |> put_resp_header("content-disposition", "attachment; filename=\"tags_export.csv\"")
        |> send_resp(200, csv_data)

      "json" ->
        json_data = generate_json_export(tags)

        conn
        |> put_resp_content_type("application/json")
        |> put_resp_header("content-disposition", "attachment; filename=\"tags_export.json\"")
        |> json(json_data)

      "coco" ->
        coco_data = generate_coco_format(tags)

        conn
        |> put_resp_content_type("application/json")
        |> put_resp_header("content-disposition", "attachment; filename=\"coco_dataset.json\"")
        |> json(coco_data)

      _ ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: "Unsupported format. Use: csv, json, or coco"})
    end
  end

  # Private helper functions

  defp get_dashboard_stats do
    today_start = DateTime.utc_now() |> DateTime.to_date() |> DateTime.new!(~T[00:00:00])

    %{
      total_tags: Repo.aggregate(ImageTag, :count, :id),
      pending_tags: from(t in ImageTag, where: t.verification_status == "pending") |> Repo.aggregate(:count, :id),
      verified_tags: from(t in ImageTag, where: t.verification_status == "verified") |> Repo.aggregate(:count, :id),
      disputed_tags: from(t in ImageTag, where: t.verification_status == "disputed") |> Repo.aggregate(:count, :id),
      average_trust_score: from(t in ImageTag) |> Repo.aggregate(:avg, :trust_score),
      tags_today: from(t in ImageTag, where: t.inserted_at >= ^today_start) |> Repo.aggregate(:count, :id),
      corporate_assigned: get_corporate_assigned_count()
    }
  end

  defp get_total_tags(start_date) do
    from(t in ImageTag, where: t.inserted_at >= ^start_date)
    |> Repo.aggregate(:count, :id)
  end

  defp get_verification_breakdown(start_date) do
    from(t in ImageTag,
      where: t.inserted_at >= ^start_date,
      group_by: t.verification_status,
      select: {t.verification_status, count(t.id)}
    )
    |> Repo.all()
    |> Enum.into(%{})
  end

  defp get_tag_type_distribution(start_date) do
    from(t in ImageTag,
      where: t.inserted_at >= ^start_date,
      group_by: t.tag_type,
      select: {t.tag_type, count(t.id)}
    )
    |> Repo.all()
    |> Enum.into(%{})
  end

  defp get_trust_score_distribution(start_date) do
    from(t in ImageTag,
      where: t.inserted_at >= ^start_date,
      select: %{
        low: fragment("COUNT(CASE WHEN trust_score < 30 THEN 1 END)"),
        medium: fragment("COUNT(CASE WHEN trust_score >= 30 AND trust_score < 70 THEN 1 END)"),
        high: fragment("COUNT(CASE WHEN trust_score >= 70 THEN 1 END)")
      }
    )
    |> Repo.one()
  end

  defp get_top_tagged_images(start_date) do
    from(t in ImageTag,
      where: t.inserted_at >= ^start_date,
      group_by: t.image_id,
      select: {t.image_id, count(t.id)},
      order_by: [desc: count(t.id)],
      limit: 10
    )
    |> Repo.all()
  end

  defp get_verification_trends(start_date) do
    from(t in ImageTag,
      where: t.inserted_at >= ^start_date and t.verification_status == "verified",
      group_by: fragment("DATE(?)", t.inserted_at),
      select: {fragment("DATE(?)", t.inserted_at), count(t.id)},
      order_by: fragment("DATE(?)", t.inserted_at)
    )
    |> Repo.all()
  end

  defp get_corporate_assigned_count do
    from(t in ImageTag,
      where: fragment("metadata->>'corporate_client' IS NOT NULL")
    )
    |> Repo.aggregate(:count, :id)
  end

  defp get_corporate_tag_count(client_name) do
    from(t in ImageTag,
      where: fragment("metadata->>'corporate_client' = ?", ^client_name)
    )
    |> Repo.aggregate(:count, :id)
  end

  defp get_corporate_verified_count(client_name) do
    from(t in ImageTag,
      where: fragment("metadata->>'corporate_client' = ?", ^client_name) and t.verification_status == "verified"
    )
    |> Repo.aggregate(:count, :id)
  end

  defp get_filtered_tags(filters) do
    query = ImageTag

    query = if filters["verification_status"] do
      from(t in query, where: t.verification_status == ^filters["verification_status"])
    else
      query
    end

    query = if filters["tag_type"] do
      from(t in query, where: t.tag_type == ^filters["tag_type"])
    else
      query
    end

    query = if filters["min_trust_score"] do
      min_score = String.to_integer(filters["min_trust_score"])
      from(t in query, where: t.trust_score >= ^min_score)
    else
      query
    end

    from(t in query, preload: [:image])
    |> Repo.all()
  end

  defp generate_csv(tags) do
    headers = "id,image_id,tag_type,text,x_position,y_position,verification_status,trust_score,created_by,verified_by,inserted_at\n"

    rows = Enum.map(tags, fn tag ->
      "#{tag.id},#{tag.image_id},#{tag.tag_type},#{tag.text},#{tag.x_position},#{tag.y_position},#{tag.verification_status},#{tag.trust_score},#{tag.created_by},#{tag.verified_by},#{tag.inserted_at}"
    end)

    headers <> Enum.join(rows, "\n")
  end

  defp generate_json_export(tags) do
    %{
      export_timestamp: DateTime.utc_now(),
      total_tags: length(tags),
      tags: Enum.map(tags, fn tag ->
        %{
          id: tag.id,
          image_id: tag.image_id,
          tag_type: tag.tag_type,
          text: tag.text,
          coordinates: %{
            x: tag.x_position,
            y: tag.y_position
          },
          verification: %{
            status: tag.verification_status,
            trust_score: tag.trust_score,
            verified_by: tag.verified_by,
            verified_at: tag.verified_at
          },
          metadata: tag.metadata,
          timestamps: %{
            created_at: tag.inserted_at,
            updated_at: tag.updated_at
          }
        }
      end)
    }
  end

  defp generate_coco_format(tags) do
    # Group tags by image for COCO format
    images_with_tags = Enum.group_by(tags, & &1.image_id)

    images = Enum.map(images_with_tags, fn {image_id, _image_tags} ->
      %{
        id: image_id,
        width: 800,  # Default width, should be actual image width
        height: 600, # Default height, should be actual image height
        file_name: "#{image_id}.jpg"
      }
    end)

    annotations = tags
    |> Enum.with_index()
    |> Enum.map(fn {tag, index} ->
      %{
        id: index + 1,
        image_id: tag.image_id,
        category_id: get_category_id(tag.tag_type),
        bbox: [
          tag.x_position * 8,  # Convert percentage to pixel (assuming 800px width)
          tag.y_position * 6,  # Convert percentage to pixel (assuming 600px height)
          50,  # Default width
          50   # Default height
        ],
        area: 2500,
        iscrowd: 0,
        attributes: %{
          text: tag.text,
          trust_score: tag.trust_score,
          verification_status: tag.verification_status
        }
      }
    end)

    categories = [
      %{id: 1, name: "product", supercategory: "object"},
      %{id: 2, name: "damage", supercategory: "defect"},
      %{id: 3, name: "location", supercategory: "spatial"},
      %{id: 4, name: "modification", supercategory: "change"},
      %{id: 5, name: "brand", supercategory: "identification"},
      %{id: 6, name: "part", supercategory: "component"},
      %{id: 7, name: "tool", supercategory: "equipment"},
      %{id: 8, name: "fluid", supercategory: "substance"}
    ]

    %{
      info: %{
        description: "Corporate Data Harvesting - Tagged Vehicle Images",
        version: "1.0",
        year: DateTime.utc_now().year,
        contributor: "Nuke API System",
        date_created: DateTime.utc_now()
      },
      images: images,
      annotations: annotations,
      categories: categories
    }
  end

  defp get_category_id(tag_type) do
    case tag_type do
      "product" -> 1
      "damage" -> 2
      "location" -> 3
      "modification" -> 4
      "brand" -> 5
      "part" -> 6
      "tool" -> 7
      "fluid" -> 8
      _ -> 1
    end
  end

  defp get_current_user_id(conn) do
    # Extract user ID from JWT token
    case get_req_header(conn, "authorization") do
      ["Bearer " <> token] ->
        # This should extract the user ID from the JWT token
        # For now, return a placeholder
        "admin_user"
      _ ->
        "admin_user"
    end
  end
end