defmodule NukeApiWeb.PurchaseAgreementController do
  use NukeApiWeb, :controller

  @moduledoc """
  Purchase Agreement API Controller

  Handles requests for creating, managing, and signing vehicle purchase agreements.
  Auto-fills seller data from vehicle ownership and user profiles.
  """

  def create(conn, params) do
    IO.inspect(params, label: "Purchase Agreement Creation Request")

    # Extract parameters
    vehicle_id = params["vehicle_id"]
    seller_user_id = params["seller_user_id"]
    vehicle_sales_price = params["vehicle_sales_price"]

    # Additional pricing parameters
    document_fee = params["document_fee"] || 0
    dealer_handling_fee = params["dealer_handling_fee"] || 0
    sales_tax_rate = params["sales_tax_rate"] || 0

    # Validate required parameters
    cond do
      is_nil(vehicle_id) or vehicle_id == "" ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: "Vehicle ID is required"})

      is_nil(seller_user_id) or seller_user_id == "" ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: "Seller user ID is required"})

      is_nil(vehicle_sales_price) or vehicle_sales_price == "" ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: "Vehicle sales price is required"})

      true ->
        case create_purchase_agreement(vehicle_id, seller_user_id, vehicle_sales_price, params) do
          {:ok, agreement} ->
            conn
            |> put_status(:created)
            |> json(%{
              success: true,
              agreement_id: agreement.id,
              message: "Purchase agreement created successfully",
              agreement: format_agreement_response(agreement)
            })

          {:error, reason} ->
            conn
            |> put_status(:unprocessable_entity)
            |> json(%{error: reason})
        end
    end
  end

  def show(conn, %{"id" => agreement_id}) do
    case get_purchase_agreement(agreement_id) do
      {:ok, agreement} ->
        conn
        |> put_status(:ok)
        |> json(%{
          success: true,
          agreement: format_agreement_response(agreement)
        })

      {:error, :not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Purchase agreement not found"})

      {:error, reason} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: reason})
    end
  end

  def update(conn, %{"id" => agreement_id} = params) do
    case update_purchase_agreement(agreement_id, params) do
      {:ok, agreement} ->
        conn
        |> put_status(:ok)
        |> json(%{
          success: true,
          message: "Purchase agreement updated successfully",
          agreement: format_agreement_response(agreement)
        })

      {:error, :not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Purchase agreement not found"})

      {:error, reason} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: reason})
    end
  end

  def add_buyer(conn, %{"id" => agreement_id} = params) do
    buyer_user_id = params["buyer_user_id"]
    buyer_info = params["buyer_info"] || %{}

    case add_buyer_to_agreement(agreement_id, buyer_user_id, buyer_info) do
      {:ok, agreement} ->
        conn
        |> put_status(:ok)
        |> json(%{
          success: true,
          message: "Buyer added to purchase agreement",
          agreement: format_agreement_response(agreement)
        })

      {:error, reason} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: reason})
    end
  end

  def generate_html(conn, %{"id" => agreement_id}) do
    case generate_agreement_html(agreement_id) do
      {:ok, html_content} ->
        conn
        |> put_status(:ok)
        |> json(%{
          success: true,
          html: html_content
        })

      {:error, reason} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: reason})
    end
  end

  def sign(conn, %{"id" => agreement_id} = params) do
    signer_role = params["signer_role"] # "buyer", "co_buyer", or "seller"
    signature_data = params["signature_data"]
    user_id = params["user_id"]

    case add_signature_to_agreement(agreement_id, signer_role, signature_data, user_id, conn) do
      {:ok, signature} ->
        conn
        |> put_status(:ok)
        |> json(%{
          success: true,
          message: "Signature added successfully",
          signature_id: signature.id
        })

      {:error, reason} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: reason})
    end
  end

  def generate_pdf(conn, %{"id" => agreement_id}) do
    case generate_agreement_pdf(agreement_id) do
      {:ok, pdf_path} ->
        conn
        |> put_resp_content_type("application/pdf")
        |> put_resp_header("content-disposition", "attachment; filename=\"purchase_agreement_#{agreement_id}.pdf\"")
        |> send_file(200, pdf_path)

      {:error, reason} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: reason})
    end
  end

  # Private helper functions
  defp create_purchase_agreement(vehicle_id, seller_user_id, vehicle_sales_price, params) do
    try do
      # Query Supabase to create purchase agreement
      query = """
      SELECT create_purchase_agreement_from_vehicle($1, $2, $3) as agreement_id
      """

      case NukeApi.Supabase.Client.query(query, [vehicle_id, seller_user_id, vehicle_sales_price]) do
        {:ok, %{"rows" => [[agreement_id]]}} ->
          # Update with additional parameters if provided
          update_params = %{
            "document_fee" => params["document_fee"],
            "dealer_handling_fee" => params["dealer_handling_fee"],
            "sales_tax_rate" => params["sales_tax_rate"],
            "warranty_declined" => params["warranty_declined"],
            "salesman_name" => params["salesman_name"]
          }
          |> Enum.filter(fn {_k, v} -> !is_nil(v) end)
          |> Map.new()

          if map_size(update_params) > 0 do
            update_purchase_agreement(agreement_id, update_params)
          else
            get_purchase_agreement(agreement_id)
          end

        {:error, reason} ->
          {:error, "Failed to create purchase agreement: #{reason}"}
      end
    rescue
      error ->
        {:error, "Database error: #{inspect(error)}"}
    end
  end

  defp get_purchase_agreement(agreement_id) do
    query = """
    SELECT pa.*, v.year, v.make, v.model, v.vin, v.color, v.mileage,
           p.full_name as seller_full_name, p.email as seller_email
    FROM purchase_agreements pa
    LEFT JOIN vehicles v ON pa.vehicle_id = v.id
    LEFT JOIN profiles p ON pa.seller_user_id = p.id
    WHERE pa.id = $1
    """

    case NukeApi.Supabase.Client.query(query, [agreement_id]) do
      {:ok, %{"rows" => [row]}} ->
        {:ok, format_database_row(row)}

      {:ok, %{"rows" => []}} ->
        {:error, :not_found}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp update_purchase_agreement(agreement_id, params) do
    # Build dynamic update query based on provided parameters
    {set_clauses, values, _} = build_update_clauses(params, 1)

    query = """
    UPDATE purchase_agreements
    SET #{Enum.join(set_clauses, ", ")}, updated_at = NOW()
    WHERE id = $#{length(values) + 1}
    """

    case NukeApi.Supabase.Client.query(query, values ++ [agreement_id]) do
      {:ok, _result} ->
        # Recalculate totals if pricing changed
        if has_pricing_changes?(params) do
          recalculate_totals(agreement_id)
        end
        get_purchase_agreement(agreement_id)

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp add_buyer_to_agreement(agreement_id, buyer_user_id, buyer_info) do
    # Build buyer info update
    buyer_fields = %{
      "buyer_user_id" => buyer_user_id,
      "buyer_name" => buyer_info["name"],
      "buyer_address" => buyer_info["address"],
      "buyer_city" => buyer_info["city"],
      "buyer_state" => buyer_info["state"],
      "buyer_zip" => buyer_info["zip"],
      "buyer_phone" => buyer_info["phone"],
      "buyer_cell" => buyer_info["cell"],
      "status" => "pending_signatures"
    }
    |> Enum.filter(fn {_k, v} -> !is_nil(v) end)
    |> Map.new()

    update_purchase_agreement(agreement_id, buyer_fields)
  end

  defp generate_agreement_html(agreement_id) do
    case get_purchase_agreement(agreement_id) do
      {:ok, agreement} ->
        html_template = File.read!(Path.join([:code.priv_dir(:nuke_api), "templates", "purchase_agreement.html"]))
        filled_html = fill_html_template(html_template, agreement)

        # Save the generated HTML to database
        update_query = "UPDATE purchase_agreements SET agreement_html = $1 WHERE id = $2"
        NukeApi.Supabase.Client.query(update_query, [filled_html, agreement_id])

        {:ok, filled_html}

      error ->
        error
    end
  end

  defp generate_agreement_pdf(agreement_id) do
    case generate_agreement_html(agreement_id) do
      {:ok, html_content} ->
        # Generate PDF using wkhtmltopdf or similar tool
        pdf_filename = "purchase_agreement_#{agreement_id}_#{System.system_time(:second)}.pdf"
        pdf_path = Path.join([System.tmp_dir(), pdf_filename])

        # Create temporary HTML file
        html_filename = "temp_agreement_#{agreement_id}.html"
        html_path = Path.join([System.tmp_dir(), html_filename])
        File.write!(html_path, html_content)

        # Generate PDF using wkhtmltopdf (assumes it's installed)
        case System.cmd("wkhtmltopdf", [
          "--page-size", "A4",
          "--orientation", "Portrait",
          "--margin-top", "0.5in",
          "--margin-bottom", "0.5in",
          "--margin-left", "0.5in",
          "--margin-right", "0.5in",
          html_path,
          pdf_path
        ]) do
          {_output, 0} ->
            # Clean up temp HTML file
            File.rm(html_path)

            # Update database with PDF path
            update_query = "UPDATE purchase_agreements SET pdf_file_path = $1 WHERE id = $2"
            NukeApi.Supabase.Client.query(update_query, [pdf_path, agreement_id])

            {:ok, pdf_path}

          {error, _code} ->
            # Clean up temp files
            File.rm(html_path)
            if File.exists?(pdf_path), do: File.rm(pdf_path)
            {:error, "PDF generation failed: #{error}"}
        end

      error ->
        error
    end
  end

  defp add_signature_to_agreement(agreement_id, signer_role, signature_data, user_id, conn) do
    # Extract client info for signature verification
    ip_address = get_client_ip(conn)
    user_agent = get_req_header(conn, "user-agent") |> List.first()

    # Insert signature record
    insert_query = """
    INSERT INTO purchase_agreement_signatures
    (agreement_id, signer_role, user_id, signature_data, ip_address, user_agent)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id
    """

    case NukeApi.Supabase.Client.query(insert_query, [
      agreement_id, signer_role, user_id,
      Jason.encode!(signature_data), ip_address, user_agent
    ]) do
      {:ok, %{"rows" => [[signature_id]]}} ->
        # Update the main agreement with signature data
        update_signature_field(agreement_id, signer_role, signature_data)
        check_agreement_completion(agreement_id)
        {:ok, %{id: signature_id}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  # Helper functions for building queries and formatting responses
  defp build_update_clauses(params, start_index) do
    params
    |> Enum.with_index(start_index)
    |> Enum.reduce({[], [], start_index}, fn {{key, value}, index}, {clauses, values, next_index} ->
      clause = "#{key} = $#{index}"
      {[clause | clauses], [value | values], next_index + 1}
    end)
  end

  defp has_pricing_changes?(params) do
    pricing_fields = ["vehicle_sales_price", "document_fee", "sales_tax_rate", "tradein_credit_value"]
    Enum.any?(pricing_fields, fn field -> Map.has_key?(params, field) end)
  end

  defp recalculate_totals(agreement_id) do
    query = "SELECT calculate_purchase_agreement_totals($1)"
    NukeApi.Supabase.Client.query(query, [agreement_id])
  end

  defp fill_html_template(template, agreement) do
    # Replace template placeholders with agreement data
    template
    |> String.replace("{{seller_name}}", agreement[:seller_name] || "")
    |> String.replace("{{seller_address}}", agreement[:seller_address] || "")
    |> String.replace("{{vehicle_year}}", to_string(agreement[:year] || ""))
    |> String.replace("{{vehicle_make}}", agreement[:make] || "")
    |> String.replace("{{vehicle_model}}", agreement[:model] || "")
    |> String.replace("{{vehicle_vin}}", agreement[:vin] || "")
    |> String.replace("{{vehicle_sales_price}}", format_currency(agreement[:vehicle_sales_price]))
    |> String.replace("{{total_gross_proceeds}}", format_currency(agreement[:total_gross_proceeds]))
    |> String.replace("{{balance_due}}", format_currency(agreement[:balance_due]))
    # Add more replacements as needed...
  end

  defp update_signature_field(agreement_id, "buyer", signature_data) do
    query = "UPDATE purchase_agreements SET buyer_signature_data = $1, buyer_signature_date = NOW() WHERE id = $2"
    NukeApi.Supabase.Client.query(query, [Jason.encode!(signature_data), agreement_id])
  end

  defp update_signature_field(agreement_id, "co_buyer", signature_data) do
    query = "UPDATE purchase_agreements SET co_buyer_signature_data = $1, co_buyer_signature_date = NOW() WHERE id = $2"
    NukeApi.Supabase.Client.query(query, [Jason.encode!(signature_data), agreement_id])
  end

  defp update_signature_field(agreement_id, "seller", signature_data) do
    query = "UPDATE purchase_agreements SET seller_signature_data = $1, seller_signature_date = NOW() WHERE id = $2"
    NukeApi.Supabase.Client.query(query, [Jason.encode!(signature_data), agreement_id])
  end

  defp check_agreement_completion(agreement_id) do
    # Check if all required signatures are present
    query = """
    UPDATE purchase_agreements
    SET status = 'completed'
    WHERE id = $1
      AND buyer_signature_data IS NOT NULL
      AND seller_signature_data IS NOT NULL
      AND status = 'pending_signatures'
    """
    NukeApi.Supabase.Client.query(query, [agreement_id])
  end

  defp format_agreement_response(agreement) do
    # Format the agreement data for API response
    agreement
    |> Map.put(:vehicle_info, %{
      year: agreement[:year],
      make: agreement[:make],
      model: agreement[:model],
      vin: agreement[:vin],
      color: agreement[:color],
      mileage: agreement[:mileage]
    })
    |> Map.put(:signature_status, %{
      buyer_signed: !is_nil(agreement[:buyer_signature_data]),
      co_buyer_signed: !is_nil(agreement[:co_buyer_signature_data]),
      seller_signed: !is_nil(agreement[:seller_signature_data])
    })
  end

  defp format_database_row(row) do
    # Convert database row to map with atom keys
    # This would need to be implemented based on the actual row structure
    # from your Supabase client
    row
  end

  defp format_currency(nil), do: "$0.00"
  defp format_currency(amount) when is_number(amount) do
    :erlang.float_to_binary(amount / 1.0, [{:decimals, 2}])
    |> then(&"$#{&1}")
  end
  defp format_currency(amount), do: "$#{amount}"

  defp get_client_ip(conn) do
    case Plug.Conn.get_req_header(conn, "x-forwarded-for") do
      [ip | _] -> ip
      [] -> to_string(conn.remote_ip)
    end
  end
end