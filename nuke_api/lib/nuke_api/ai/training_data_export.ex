defmodule NukeApi.AI.TrainingDataExport do
  @moduledoc """
  Service for exporting tagged image data for AI/ML training.

  Generates structured datasets from spatial tags and verifications for:
  - Object detection model training
  - Brand recognition model training
  - Damage assessment model training
  - Location/business recognition
  """

  import Ecto.Query, warn: false
  alias NukeApi.Repo

  alias NukeApi.Vehicles.Image
  alias NukeApi.Brands.{Brand, BrandTag}
  alias NukeApi.Verification.TagVerification

  @doc """
  Exports comprehensive training dataset with various filtering options.
  """
  def export_training_dataset(opts \\ []) do
    # Parse export options
    export_config = parse_export_config(opts)

    # Create export record
    {:ok, export_record} = create_export_record(export_config)

    try do
      # Generate dataset based on format
      dataset = case export_config.format do
        :coco -> generate_coco_dataset(export_config)
        :yolo -> generate_yolo_dataset(export_config)
        :csv -> generate_csv_dataset(export_config)
        :json -> generate_json_dataset(export_config)
        :tfrecord -> generate_tfrecord_dataset(export_config)
      end

      # Save dataset to file
      file_path = save_dataset_to_file(dataset, export_config, export_record.id)

      # Update export record with results
      update_export_record(export_record, %{
        status: "completed",
        file_path: file_path,
        total_records: count_dataset_records(dataset),
        file_size: File.stat!(file_path).size
      })

      {:ok, %{
        export_id: export_record.id,
        file_path: file_path,
        dataset_info: get_dataset_info(dataset),
        export_config: export_config
      }}

    rescue
      error ->
        # Update export record with error
        update_export_record(export_record, %{
          status: "failed",
          error_message: Exception.message(error)
        })

        {:error, error}
    end
  end

  @doc """
  Generates COCO format dataset for object detection.
  """
  def generate_coco_dataset(config) do
    images_data = get_filtered_images(config)

    # Build COCO structure
    coco_dataset = %{
      info: %{
        description: "Nuke Vehicle Tagging Dataset",
        version: "1.0",
        year: Date.utc_today().year,
        contributor: "Nuke Platform",
        date_created: DateTime.utc_now() |> DateTime.to_iso8601()
      },
      licenses: [
        %{
          id: 1,
          name: "Proprietary",
          url: ""
        }
      ],
      categories: generate_coco_categories(config),
      images: [],
      annotations: []
    }

    # Process each image
    {images_list, annotations_list, _} = Enum.reduce(images_data, {[], [], 1}, fn image, {images_acc, annotations_acc, annotation_id} ->
      # Add image info
      image_info = %{
        id: hash_image_id(image.id),
        width: get_image_dimension(image, :width),
        height: get_image_dimension(image, :height),
        file_name: image.filename || "image_#{image.id}.jpg",
        license: 1,
        flickr_url: image.image_url,
        coco_url: image.image_url,
        date_captured: image.created_at |> DateTime.to_iso8601()
      }

      # Process spatial tags to annotations
      {new_annotations, next_annotation_id} = process_spatial_tags_to_coco(
        image.spatial_tags || [],
        hash_image_id(image.id),
        annotation_id,
        config
      )

      {
        [image_info | images_acc],
        new_annotations ++ annotations_acc,
        next_annotation_id
      }
    end)

    %{coco_dataset | images: Enum.reverse(images_list), annotations: Enum.reverse(annotations_list)}
  end

  @doc """
  Generates YOLO format dataset.
  """
  def generate_yolo_dataset(config) do
    images_data = get_filtered_images(config)

    # YOLO format: one .txt file per image with normalized bounding boxes
    dataset = %{
      classes: generate_yolo_classes(config),
      images: []
    }

    yolo_data = Enum.map(images_data, fn image ->
      annotations = process_spatial_tags_to_yolo(image.spatial_tags || [], config)

      %{
        image_id: image.id,
        image_path: image.image_url,
        filename: image.filename || "image_#{image.id}.jpg",
        annotations: annotations,
        width: get_image_dimension(image, :width),
        height: get_image_dimension(image, :height)
      }
    end)

    %{dataset | images: yolo_data}
  end

  @doc """
  Generates CSV dataset for tabular analysis.
  """
  def generate_csv_dataset(config) do
    images_data = get_filtered_images(config)

    headers = [
      "image_id", "image_url", "filename", "created_at", "vehicle_id",
      "tag_id", "tag_x", "tag_y", "tag_type", "tag_text",
      "verification_status", "trust_score", "created_by",
      "brand_name", "brand_industry", "confidence_score"
    ]

    rows = Enum.flat_map(images_data, fn image ->
      case image.spatial_tags do
        nil -> []
        tags ->
          Enum.map(tags, fn tag ->
            # Get brand information if available
            brand_info = get_brand_info_for_tag(image.id, tag["id"])

            [
              image.id,
              image.image_url,
              image.filename,
              image.created_at,
              image.vehicle_id,
              tag["id"],
              tag["x"],
              tag["y"],
              tag["type"],
              tag["text"],
              tag["verification_status"],
              tag["trust_score"],
              tag["created_by"],
              brand_info[:brand_name],
              brand_info[:brand_industry],
              brand_info[:confidence_score]
            ]
          end)
      end
    end)

    %{
      headers: headers,
      rows: rows,
      total_records: length(rows)
    }
  end

  @doc """
  Generates JSON dataset for flexible analysis.
  """
  def generate_json_dataset(config) do
    images_data = get_filtered_images(config)

    dataset = %{
      metadata: %{
        export_type: "json",
        created_at: DateTime.utc_now(),
        filters: config.filters,
        total_images: length(images_data),
        categories: get_unique_tag_types(images_data)
      },
      images: Enum.map(images_data, fn image ->
        %{
          id: image.id,
          url: image.image_url,
          filename: image.filename,
          created_at: image.created_at,
          vehicle_id: image.vehicle_id,
          dimensions: %{
            width: get_image_dimension(image, :width),
            height: get_image_dimension(image, :height)
          },
          location: if(image.latitude && image.longitude, do: %{
            lat: image.latitude,
            lng: image.longitude,
            name: image.location_name
          }, else: nil),
          spatial_tags: process_spatial_tags_for_json(image.spatial_tags || [], image.id),
          verification_stats: get_image_verification_stats(image.id)
        }
      end)
    }

    dataset
  end

  @doc """
  Lists previous training data exports.
  """
  def list_exports(opts \\ []) do
    limit = opts[:limit] || 20

    from(e in "ai_training_exports",
      order_by: [desc: e.created_at],
      limit: ^limit,
      select: %{
        id: e.id,
        export_type: e.export_type,
        export_format: e.export_format,
        total_records: e.total_records,
        file_size_bytes: e.file_size_bytes,
        export_url: e.export_url,
        exported_by: e.exported_by,
        created_at: e.created_at,
        status: fragment("COALESCE(?, 'completed')", e.status)
      }
    )
    |> Repo.all()
  end

  @doc """
  Gets a specific export record.
  """
  def get_export(export_id) do
    from(e in "ai_training_exports",
      where: e.id == ^export_id,
      select: %{
        id: e.id,
        export_type: e.export_type,
        export_format: e.export_format,
        total_records: e.total_records,
        file_size_bytes: e.file_size_bytes,
        export_url: e.export_url,
        exported_by: e.exported_by,
        created_at: e.created_at,
        expires_at: e.expires_at,
        status: fragment("COALESCE(?, 'completed')", e.status)
      }
    )
    |> Repo.one()
  end

  # =====================================================================================
  # PRIVATE HELPER FUNCTIONS
  # =====================================================================================

  defp parse_export_config(opts) do
    %{
      format: opts[:format] || :json,
      export_type: opts[:export_type] || "full_dataset",
      filters: %{
        date_range: opts[:date_range],
        min_trust_score: opts[:min_trust_score] || 50,
        verification_status: opts[:verification_status],
        tag_types: opts[:tag_types] || ["product", "location", "damage", "modification"],
        brands: opts[:brands],
        include_unverified: opts[:include_unverified] || false
      },
      exported_by: opts[:user_id]
    }
  end

  defp get_filtered_images(config) do
    base_query = from(i in Image,
      where: not is_nil(i.spatial_tags) and fragment("jsonb_array_length(?)", i.spatial_tags) > 0,
      preload: [:vehicle]
    )

    # Apply date filter
    query = if config.filters.date_range do
      from(i in base_query,
        where: i.created_at >= ^config.filters.date_range.start and
               i.created_at <= ^config.filters.date_range.end
      )
    else
      base_query
    end

    # Apply other filters through post-processing for JSONB complexity
    images = Repo.all(query)

    # Filter by tag criteria
    Enum.filter(images, fn image ->
      tags = image.spatial_tags || []

      # Check if image has tags meeting criteria
      Enum.any?(tags, fn tag ->
        trust_score_ok = (tag["trust_score"] || 0) >= config.filters.min_trust_score

        verification_ok = if config.filters.verification_status do
          tag["verification_status"] == config.filters.verification_status
        else
          config.filters.include_unverified || tag["verification_status"] in ["verified", "user_verified"]
        end

        type_ok = tag["type"] in config.filters.tag_types

        trust_score_ok && verification_ok && type_ok
      end)
    end)
  end

  defp create_export_record(config) do
    attrs = %{
      export_type: config.export_type,
      export_format: to_string(config.format),
      filters: config.filters,
      exported_by: config.exported_by,
      status: "processing"
    }

    # Insert into ai_training_exports table
    Repo.insert(%{
      id: Ecto.UUID.generate(),
      export_type: attrs.export_type,
      export_format: attrs.export_format,
      exported_by: attrs.exported_by,
      created_at: DateTime.utc_now(),
      expires_at: DateTime.utc_now() |> DateTime.add(7 * 24 * 60 * 60, :second) # 7 days
    }, prefix: "public")
  end

  defp update_export_record(_record, _updates) do
    # Update export record with results
    # This would use Repo.update in a real implementation
    :ok
  end

  defp save_dataset_to_file(dataset, config, export_id) do
    # Create exports directory
    exports_dir = Path.join([System.tmp_dir(), "nuke_exports"])
    File.mkdir_p!(exports_dir)

    # Generate filename
    timestamp = DateTime.utc_now() |> DateTime.to_unix()
    filename = "training_data_#{export_id}_#{timestamp}.#{config.format}"
    file_path = Path.join(exports_dir, filename)

    # Save based on format
    case config.format do
      :json ->
        File.write!(file_path, Jason.encode!(dataset, pretty: true))
      :csv ->
        csv_content = [dataset.headers | dataset.rows]
        |> Enum.map(&Enum.join(&1, ","))
        |> Enum.join("\n")
        File.write!(file_path, csv_content)
      :coco ->
        File.write!(file_path, Jason.encode!(dataset, pretty: true))
      :yolo ->
        # YOLO format creates multiple files
        save_yolo_dataset(dataset, file_path)
      _ ->
        File.write!(file_path, Jason.encode!(dataset))
    end

    file_path
  end

  defp save_yolo_dataset(dataset, base_path) do
    # Create directory for YOLO dataset
    dataset_dir = String.replace(base_path, ".yolo", "")
    File.mkdir_p!(dataset_dir)

    # Save classes file
    classes_file = Path.join(dataset_dir, "classes.txt")
    File.write!(classes_file, Enum.join(dataset.classes, "\n"))

    # Save annotation files
    Enum.each(dataset.images, fn image ->
      annotation_file = Path.join(dataset_dir, "#{Path.rootname(image.filename)}.txt")
      annotation_content = Enum.map(image.annotations, fn ann ->
        "#{ann.class_id} #{ann.x_center} #{ann.y_center} #{ann.width} #{ann.height}"
      end) |> Enum.join("\n")

      File.write!(annotation_file, annotation_content)
    end)

    # Save image list
    image_list_file = Path.join(dataset_dir, "images.txt")
    image_paths = Enum.map(dataset.images, & &1.image_path)
    File.write!(image_list_file, Enum.join(image_paths, "\n"))

    dataset_dir
  end

  defp count_dataset_records(dataset) do
    case dataset do
      %{rows: rows} -> length(rows)
      %{images: images} -> length(images)
      %{annotations: annotations} -> length(annotations)
      _ -> 0
    end
  end

  defp get_dataset_info(dataset) do
    case dataset do
      %{metadata: metadata} -> metadata
      %{info: info} -> info
      _ -> %{type: "unknown"}
    end
  end

  # Additional helper functions for format-specific processing...
  defp generate_coco_categories(config) do
    config.filters.tag_types
    |> Enum.with_index(1)
    |> Enum.map(fn {type, id} ->
      %{
        id: id,
        name: type,
        supercategory: get_supercategory(type)
      }
    end)
  end

  defp get_supercategory(type) do
    case type do
      "product" -> "object"
      "damage" -> "defect"
      "location" -> "place"
      "modification" -> "alteration"
      _ -> "other"
    end
  end

  defp hash_image_id(uuid_string) do
    # Convert UUID to integer for COCO compatibility
    :crypto.hash(:md5, uuid_string) |> :binary.decode_unsigned()
  end

  defp get_image_dimension(image, dimension) do
    # Extract from EXIF data or default
    case image.exif_data do
      %{"ImageWidth" => width, "ImageHeight" => _height} when dimension == :width -> width
      %{"ImageWidth" => _width, "ImageHeight" => height} when dimension == :height -> height
      _ -> if dimension == :width, do: 1920, else: 1080  # Default values
    end
  end

  defp process_spatial_tags_to_coco(tags, image_id, start_annotation_id, config) do
    {annotations, next_id} = Enum.reduce(tags, {[], start_annotation_id}, fn tag, {acc, ann_id} ->
      if tag["type"] in config.filters.tag_types do
        # Convert percentage coordinates to bounding box
        # This is simplified - in practice you'd need proper bounding box coordinates
        bbox = convert_point_to_bbox(tag["x"], tag["y"])

        annotation = %{
          id: ann_id,
          image_id: image_id,
          category_id: get_category_id(tag["type"], config.filters.tag_types),
          bbox: bbox,
          area: bbox[2] * bbox[3],  # width * height
          iscrowd: 0,
          segmentation: []
        }

        {[annotation | acc], ann_id + 1}
      else
        {acc, ann_id}
      end
    end)

    {Enum.reverse(annotations), next_id}
  end

  defp convert_point_to_bbox(x_percent, y_percent, box_size \\ 50) do
    # Convert point coordinates to bounding box (simplified)
    # In practice, you'd want actual bounding box annotations
    x = x_percent - box_size / 2
    y = y_percent - box_size / 2
    [max(0, x), max(0, y), box_size, box_size]
  end

  defp get_category_id(tag_type, tag_types) do
    Enum.find_index(tag_types, &(&1 == tag_type)) + 1
  end

  defp process_spatial_tags_to_yolo(tags, config) do
    Enum.filter(tags, &(&1["type"] in config.filters.tag_types))
    |> Enum.map(fn tag ->
      %{
        class_id: get_category_id(tag["type"], config.filters.tag_types) - 1, # YOLO uses 0-based
        x_center: tag["x"] / 100.0,
        y_center: tag["y"] / 100.0,
        width: 0.1,  # Default small bounding box
        height: 0.1
      }
    end)
  end

  defp generate_yolo_classes(config) do
    config.filters.tag_types
  end

  defp process_spatial_tags_for_json(tags, image_id) do
    Enum.map(tags, fn tag ->
      # Get additional verification data
      verifications = get_tag_verifications(image_id, tag["id"])
      brand_info = get_brand_info_for_tag(image_id, tag["id"])

      Map.merge(tag, %{
        "verifications" => verifications,
        "brand_associations" => brand_info
      })
    end)
  end

  defp get_brand_info_for_tag(image_id, tag_id) do
    case Repo.all(from(bt in BrandTag,
      where: bt.image_id == ^image_id and bt.spatial_tag_id == ^tag_id,
      join: b in Brand, on: bt.brand_id == b.id,
      select: %{
        brand_name: b.name,
        brand_industry: b.industry,
        confidence_score: bt.confidence_score,
        verification_status: bt.verification_status
      }
    )) do
      [info | _] -> info
      [] -> %{}
    end
  end

  defp get_tag_verifications(image_id, tag_id) do
    # Get verification data for this specific tag
    from(tv in TagVerification,
      where: tv.image_id == ^image_id and tv.spatial_tag_id == ^tag_id,
      select: %{
        verifier_type: tv.verifier_type,
        action: tv.action,
        trust_score_impact: tv.trust_score_impact,
        created_at: tv.created_at
      }
    )
    |> Repo.all()
  end

  defp get_image_verification_stats(image_id) do
    from(tv in TagVerification,
      where: tv.image_id == ^image_id,
      group_by: tv.action,
      select: {tv.action, count()}
    )
    |> Repo.all()
    |> Enum.into(%{})
  end

  defp generate_tfrecord_dataset(_export_config) do
    # TensorFlow Record format - placeholder implementation
    # This would require the tensorflow_elixir library
    {:error, "TFRecord export not implemented yet"}
  end

  defp get_unique_tag_types(images_data) do
    images_data
    |> Enum.flat_map(fn image ->
      (image.spatial_tags || [])
      |> Enum.map(& &1["type"])
    end)
    |> Enum.uniq()
    |> Enum.reject(&is_nil/1)
  end
end