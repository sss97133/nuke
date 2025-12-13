defmodule NukeApiWeb.MailboxController do
  use NukeApiWeb, :controller

  alias NukeApi.Mailbox
  alias NukeApi.Mailbox.{VehicleMailbox, MailboxMessage, MailboxAccessKey}
  alias NukeApi.Parts.ContextPack
  alias NukeApi.Parts.QuoteAssembler
  alias NukeApi.Parts.QuoteAssemblyAgent
  alias NukeApi.WorkOrders
  alias NukeApi.Vehicles

  # Get vehicle mailbox with user's access level
  def show_vehicle_mailbox(conn, %{"vehicle_id" => vehicle_id}) do
    user_id = get_user_id(conn)

    case Mailbox.get_vehicle_mailbox_with_access(vehicle_id, user_id) do
      {:ok, mailbox} ->
        json(conn, %{
          status: "success",
          data: %{
            mailbox: mailbox,
            access_level: mailbox.user_access_level,
            message_count: mailbox.unread_count
          }
        })

      {:error, :not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{status: "error", message: "Vehicle mailbox not found"})

      {:error, :unauthorized} ->
        conn
        |> put_status(:forbidden)
        |> json(%{status: "error", message: "Access denied to this mailbox"})
    end
  end

  # Get messages for a vehicle mailbox
  def get_messages(conn, %{"vehicle_id" => vehicle_id} = params) do
    user_id = get_user_id(conn)
    page = Map.get(params, "page", 1) |> String.to_integer()
    limit = Map.get(params, "limit", 20) |> String.to_integer()
    message_type = Map.get(params, "type")

    case Mailbox.get_mailbox_messages(vehicle_id, user_id, page, limit, message_type) do
      {:ok, messages} ->
        json(conn, %{
          status: "success",
          data: messages,
          pagination: %{
            page: page,
            limit: limit,
            total_count: length(messages)
          }
        })

      {:error, :unauthorized} ->
        conn
        |> put_status(:forbidden)
        |> json(%{status: "error", message: "Access denied to this mailbox"})
    end
  end

  # Send message to vehicle mailbox
  def create_message(conn, %{"vehicle_id" => vehicle_id} = params) do
    user_id = get_user_id(conn)

    message_params = %{
      "vehicle_id" => vehicle_id,
      "sender_id" => user_id,
      "sender_type" => "user",
      "message_type" => Map.get(params, "message_type", "system_alert"),
      "title" => Map.get(params, "title"),
      "content" => Map.get(params, "content"),
      "priority" => Map.get(params, "priority", "medium"),
      "metadata" => Map.get(params, "metadata", %{})
    }

    case Mailbox.create_message(message_params, user_id) do
      {:ok, message} ->
        # Trigger real-time notifications to all mailbox subscribers
        broadcast_message_created(vehicle_id, message)

        json(conn, %{
          status: "success",
          data: message,
          message: "Message sent successfully"
        })

      {:error, :unauthorized} ->
        conn
        |> put_status(:forbidden)
        |> json(%{status: "error", message: "Access denied to send messages"})

      {:error, changeset} ->
        conn
        |> put_status(:bad_request)
        |> json(%{
          status: "error",
          message: "Invalid message data",
          errors: format_changeset_errors(changeset)
        })
    end
  end

  # Draft a structured work order from mailbox input (MVP agent seam).
  #
  # POST /api/vehicles/:vehicle_id/mailbox/work-orders/draft
  #
  # Body:
  # {
  #   "title": "Undercarriage patch work",
  #   "description": "Details...",
  #   "urgency": "normal",
  #   "organization_id": null,
  #   "images": [],
  #   "source_message_ids": [],
  #   "funds_committed": { "amount_cents": 150000, "currency": "USD" }
  # }
  def draft_work_order(conn, %{"vehicle_id" => vehicle_id} = params) do
    user_id = get_user_id(conn)

    title = String.trim(to_string(Map.get(params, "title", "")))
    description = String.trim(to_string(Map.get(params, "description", "")))
    urgency = Map.get(params, "urgency", "normal")
    organization_id = Map.get(params, "organization_id")
    images = Map.get(params, "images", [])
    source_message_ids = Map.get(params, "source_message_ids", [])
    funds = Map.get(params, "funds_committed")
    create_request_message = Map.get(params, "create_request_message", true)
    deliverables = WorkOrders.normalize_deliverables(Map.get(params, "deliverables", []))

    if title == "" or description == "" do
      conn
      |> put_status(:bad_request)
      |> json(%{status: "error", message: "title and description required"})
    else
      user_msg =
        if create_request_message do
          message_params = %{
            "vehicle_id" => vehicle_id,
            "sender_id" => user_id,
            "sender_type" => "user",
            "message_type" => "work_request",
            "title" => title,
            "content" => description,
            "priority" => "medium",
            "metadata" => %{"source" => "work_order_draft"}
          }

          case Mailbox.create_message(message_params, user_id) do
            {:ok, m} -> m
            _ -> nil
          end
        else
          nil
        end

      with {:ok, mailbox} <- Mailbox.get_vehicle_mailbox_with_access(vehicle_id, user_id),
           {:ok, work_order} <-
             WorkOrders.create_draft_work_order(%{
               "organization_id" => organization_id,
               "customer_id" => user_id,
               "vehicle_id" => vehicle_id,
               "title" => title,
               "description" => description,
               "urgency" => urgency,
               "images" => images,
               "request_source" => "mailbox",
               "status" => "draft",
               "metadata" => %{
                 "mailbox_id" => mailbox.id,
                 "source_message_ids" => List.wrap(source_message_ids),
                 "user_message_id" => if(user_msg, do: user_msg.id, else: nil),
                 "deliverables" => deliverables
               }
             }),
           {:ok, wo_msg} <-
             Mailbox.create_message(
               %{
                 "vehicle_id" => vehicle_id,
                 "sender_id" => user_id,
                 "sender_type" => "system",
                 "message_type" => "work_order",
                 "title" => "Work order draft",
                 "content" => title,
                 "priority" => "medium",
                 "metadata" => %{
                   "work_order_id" => work_order.id,
                   "draft" => true,
                   "source_message_ids" => List.wrap(source_message_ids),
                   "user_message_id" => if(user_msg, do: user_msg.id, else: nil),
                   "deliverables" => deliverables
                 }
               },
               user_id
             ) do
        # 2) Optional funds committed credibility signal
        funds_msg =
          case funds do
            %{"amount_cents" => amount_cents} ->
              currency = Map.get(funds, "currency", "USD")
              amount = to_int(amount_cents)

              if amount > 0 do
                case Mailbox.create_message(
                       %{
                         "vehicle_id" => vehicle_id,
                         "sender_id" => user_id,
                         "sender_type" => "user",
                         "message_type" => "funds_committed",
                         "title" => "Funds committed",
                         "content" => "#{div(amount, 100)} #{currency} committed",
                         "priority" => "high",
                         "metadata" => %{
                           "amount_cents" => amount,
                           "currency" => currency,
                           "work_order_id" => work_order.id
                         }
                       },
                       user_id
                     ) do
                  {:ok, m} -> m
                  _ -> nil
                end
              else
                nil
              end

            _ ->
              nil
          end

        json(conn, %{
          status: "success",
          data: %{
            work_order: work_order,
            mailbox_messages: Enum.filter([user_msg, wo_msg, funds_msg], & &1)
          }
        })
      else
        {:error, :unauthorized} ->
          conn
          |> put_status(:forbidden)
          |> json(%{status: "error", message: "Access denied"})

        {:error, changeset} ->
          conn
          |> put_status(:bad_request)
          |> json(%{status: "error", message: "Invalid work order data", errors: format_changeset_errors(changeset)})

        other ->
          conn
          |> put_status(:internal_server_error)
          |> json(%{status: "error", message: "Failed to draft work order", detail: inspect(other)})
      end
    end
  end

  # Publish a work order (make it available). This is the point where we write to timeline.
  def publish_work_order(conn, %{"vehicle_id" => vehicle_id, "work_order_id" => work_order_id} = params) do
    user_id = get_user_id(conn)
    visibility = Map.get(params, "visibility", "invited")

    with {:ok, mailbox} <- Mailbox.get_vehicle_mailbox_with_access(vehicle_id, user_id),
         %{} = wo <- WorkOrders.get_work_order(work_order_id),
         true <- wo.customer_id == user_id,
         {:ok, work_order} <- WorkOrders.publish_work_order(work_order_id, user_id, visibility),
         {:ok, msg} <-
           Mailbox.create_message(
             %{
               "vehicle_id" => vehicle_id,
               "sender_id" => user_id,
               "sender_type" => "system",
               "message_type" => "status_update",
               "title" => "Work order published",
               "content" => work_order.title,
               "priority" => "high",
               "metadata" => %{
                 "mailbox_id" => mailbox.id,
                 "work_order_id" => work_order.id,
                 "status" => work_order.status,
                 "visibility" => work_order.visibility
               }
             },
             user_id
           ) do
      _ =
        Vehicles.create_timeline_event(%{
          "vehicle_id" => vehicle_id,
          "event_type" => "service",
          "event_date" => DateTime.utc_now(),
          "source" => "mailbox",
          "title" => "Work order published",
          "description" => work_order.title,
          "creator_id" => user_id,
          "metadata" => %{
            "work_order_id" => work_order.id,
            "mailbox_message_id" => msg.id
          }
        })

      json(conn, %{status: "success", data: %{work_order: work_order, mailbox_message: msg}})
    else
      false ->
        conn |> put_status(:forbidden) |> json(%{status: "error", message: "Only the work order owner can publish"})

      nil ->
        conn |> put_status(:not_found) |> json(%{status: "error", message: "Work order not found"})

      {:error, :unauthorized} ->
        conn |> put_status(:forbidden) |> json(%{status: "error", message: "Access denied"})

      {:error, reason} ->
        conn |> put_status(:bad_request) |> json(%{status: "error", message: "Failed to publish", detail: inspect(reason)})

      other ->
        conn |> put_status(:internal_server_error) |> json(%{status: "error", message: "Server error", detail: inspect(other)})
    end
  end

  # Add proof artifacts for a work order (tech or owner).
  def add_work_order_proof(conn, %{"vehicle_id" => vehicle_id, "work_order_id" => work_order_id} = params) do
    user_id = get_user_id(conn)

    proof_type = Map.get(params, "proof_type") || Map.get(params, "proofType") || "other"
    urls = Map.get(params, "urls") || []
    notes = Map.get(params, "notes")

    with {:ok, _mailbox} <- Mailbox.get_vehicle_mailbox_with_access(vehicle_id, user_id),
         %{} = wo <- WorkOrders.get_work_order(work_order_id),
         true <- wo.vehicle_id == vehicle_id,
         true <- user_can_provide_proof?(vehicle_id, work_order_id, user_id),
         {:ok, proof} <-
           WorkOrders.create_proof(%{
             work_order_id: work_order_id,
             vehicle_id: vehicle_id,
             uploaded_by: user_id,
             proof_type: proof_type,
             urls: List.wrap(urls),
             notes: notes,
             metadata: %{"source" => "mailbox"}
           }),
         {:ok, msg} <-
           Mailbox.create_message(
             %{
               "vehicle_id" => vehicle_id,
               "sender_id" => user_id,
               "sender_type" => "user",
               "message_type" => "status_update",
               "title" => "Proof uploaded",
               "content" => "#{proof_type}",
               "priority" => "medium",
               "metadata" => %{
                 "work_order_id" => work_order_id,
                 "work_order_proof_id" => proof.id,
                 "proof_type" => proof_type,
                 "urls" => List.wrap(urls)
               }
             },
             user_id
           ) do
      _ =
        Vehicles.create_timeline_event(%{
          "vehicle_id" => vehicle_id,
          "event_type" => "service",
          "event_date" => DateTime.utc_now(),
          "source" => "mailbox",
          "title" => "Work proof uploaded",
          "description" => "#{proof_type}",
          "creator_id" => user_id,
          "metadata" => %{
            "work_order_id" => work_order_id,
            "work_order_proof_id" => proof.id,
            "mailbox_message_id" => msg.id
          }
        })

      json(conn, %{status: "success", data: %{proof: proof, mailbox_message: msg}})
    else
      false ->
        conn |> put_status(:forbidden) |> json(%{status: "error", message: "Not authorized"})

      nil ->
        conn |> put_status(:not_found) |> json(%{status: "error", message: "Work order not found"})

      {:error, changeset} ->
        conn |> put_status(:bad_request) |> json(%{status: "error", message: "Invalid proof", errors: format_changeset_errors(changeset)})

      {:error, :unauthorized} ->
        conn |> put_status(:forbidden) |> json(%{status: "error", message: "Access denied"})

      other ->
        conn |> put_status(:internal_server_error) |> json(%{status: "error", message: "Server error", detail: inspect(other)})
    end
  end

  # Mark a work order completed (owner only for now).
  def complete_work_order(conn, %{"vehicle_id" => vehicle_id, "work_order_id" => work_order_id}) do
    user_id = get_user_id(conn)

    with {:ok, _mailbox} <- Mailbox.get_vehicle_mailbox_with_access(vehicle_id, user_id),
         %{} = wo <- WorkOrders.get_work_order(work_order_id),
         :ok <- ensure_owner!(wo, user_id),
         :ok <- ensure_work_order_in_vehicle!(wo, vehicle_id),
         :ok <- ensure_work_order_ready_to_complete!(wo),
         :ok <- ensure_deliverables_complete!(work_order_id, wo),
         {:ok, _} <- WorkOrders.mark_work_order_completed!(work_order_id),
         {:ok, msg} <-
           Mailbox.create_message(
             %{
               "vehicle_id" => vehicle_id,
               "sender_id" => user_id,
               "sender_type" => "user",
               "message_type" => "work_completed",
               "title" => "Work completed",
               "content" => wo.title,
               "priority" => "high",
               "metadata" => %{
                 "work_order_id" => work_order_id
               }
             },
             user_id
           ) do
      _ =
        Vehicles.create_timeline_event(%{
          "vehicle_id" => vehicle_id,
          "event_type" => "service",
          "event_date" => DateTime.utc_now(),
          "source" => "mailbox",
          "title" => "Work completed",
          "description" => wo.title,
          "creator_id" => user_id,
          "metadata" => %{
            "work_order_id" => work_order_id,
            "mailbox_message_id" => msg.id
          }
        })

      # Auto-revoke technician proof access now that the work is finalized (best-effort).
      _ = WorkOrders.revoke_proof_access!(vehicle_id, work_order_id, user_id)

      json(conn, %{status: "success", data: %{mailbox_message: msg}})
    else
      {:error, :forbidden} ->
        conn |> put_status(:forbidden) |> json(%{status: "error", message: "Only the work order owner can complete"})

      {:error, :not_ready} ->
        conn |> put_status(:conflict) |> json(%{status: "error", message: "Work order is not ready to complete"})

      {:error, {:missing_deliverables, missing}} ->
        conn
        |> put_status(:conflict)
        |> json(%{status: "error", message: "Missing required deliverables", missing_deliverables: missing})

      nil ->
        conn |> put_status(:not_found) |> json(%{status: "error", message: "Work order not found"})

      {:error, :unauthorized} ->
        conn |> put_status(:forbidden) |> json(%{status: "error", message: "Access denied"})

      other ->
        conn |> put_status(:internal_server_error) |> json(%{status: "error", message: "Server error", detail: inspect(other)})
    end
  end

  # Technician requests completion (does NOT finalize the work order).
  # This creates a mailbox message to notify the owner, but does not emit a timeline event
  # and does not update work_orders.status.
  def request_work_order_completion(conn, %{"vehicle_id" => vehicle_id, "work_order_id" => work_order_id} = params) do
    user_id = get_user_id(conn)
    note = Map.get(params, "note") || Map.get(params, "notes")

    with {:ok, mailbox} <- Mailbox.get_vehicle_mailbox_with_access(vehicle_id, user_id),
         %{} = wo <- WorkOrders.get_work_order(work_order_id),
         :ok <- ensure_work_order_in_vehicle!(wo, vehicle_id),
         :ok <- ensure_work_order_ready_to_request_completion!(wo),
         true <- user_can_provide_proof?(vehicle_id, work_order_id, user_id),
         {:ok, msg} <-
           Mailbox.create_message(
             %{
               "vehicle_id" => vehicle_id,
               "sender_id" => user_id,
               "sender_type" => "user",
               "message_type" => "work_completed",
               "title" => "Completion requested",
               "content" => note || "Technician requested completion",
               "priority" => "high",
               "metadata" => %{
                 "mailbox_id" => mailbox.id,
                 "work_order_id" => work_order_id,
                 "completion_request" => true
               }
             },
             user_id
           ) do
      json(conn, %{status: "success", data: %{mailbox_message: msg}})
    else
      false ->
        conn |> put_status(:forbidden) |> json(%{status: "error", message: "Not authorized"})

      {:error, :not_ready} ->
        conn |> put_status(:conflict) |> json(%{status: "error", message: "Work order is not ready for completion request"})

      nil ->
        conn |> put_status(:not_found) |> json(%{status: "error", message: "Work order not found"})

      {:error, :unauthorized} ->
        conn |> put_status(:forbidden) |> json(%{status: "error", message: "Access denied"})

      other ->
        conn |> put_status(:internal_server_error) |> json(%{status: "error", message: "Server error", detail: inspect(other)})
    end
  end

  # List quotes for a work order (must have mailbox access to the vehicle)
  def list_work_order_quotes(conn, %{"vehicle_id" => vehicle_id, "work_order_id" => work_order_id}) do
    user_id = get_user_id(conn)

    with {:ok, _mailbox} <- Mailbox.get_vehicle_mailbox_with_access(vehicle_id, user_id) do
      quotes = WorkOrders.list_quotes_for_work_order(work_order_id)
      json(conn, %{status: "success", data: quotes})
    else
      {:error, :unauthorized} ->
        conn |> put_status(:forbidden) |> json(%{status: "error", message: "Access denied"})

      _ ->
        conn |> put_status(:not_found) |> json(%{status: "error", message: "Not found"})
    end
  end

  # Get work order details (for UI progress rendering)
  def get_work_order(conn, %{"vehicle_id" => vehicle_id, "work_order_id" => work_order_id}) do
    user_id = get_user_id(conn)

    with {:ok, _mailbox} <- Mailbox.get_vehicle_mailbox_with_access(vehicle_id, user_id),
         %{} = wo <- WorkOrders.get_work_order(work_order_id),
         true <- wo.vehicle_id == vehicle_id do
      json(conn, %{status: "success", data: wo})
    else
      false ->
        conn |> put_status(:forbidden) |> json(%{status: "error", message: "Not authorized"})

      nil ->
        conn |> put_status(:not_found) |> json(%{status: "error", message: "Work order not found"})

      {:error, :unauthorized} ->
        conn |> put_status(:forbidden) |> json(%{status: "error", message: "Access denied"})

      _ ->
        conn |> put_status(:not_found) |> json(%{status: "error", message: "Not found"})
    end
  end

  # Create a quote for a work order + mirror to mailbox as `quote`
  def create_work_order_quote(conn, %{"vehicle_id" => vehicle_id, "work_order_id" => work_order_id} = params) do
    user_id = get_user_id(conn)

    amount_cents = to_int(Map.get(params, "amount_cents") || Map.get(params, "amountCents"))
    currency = Map.get(params, "currency", "USD")
    notes = Map.get(params, "notes")

    if amount_cents <= 0 do
      conn |> put_status(:bad_request) |> json(%{status: "error", message: "amount_cents must be > 0"})
    else
      with {:ok, mailbox} <- Mailbox.get_vehicle_mailbox_with_access(vehicle_id, user_id),
           {:ok, quote} <-
             WorkOrders.create_quote(%{
               work_order_id: work_order_id,
               created_by: user_id,
               business_id: Map.get(params, "business_id"),
               amount_cents: amount_cents,
               currency: currency,
               estimated_hours: Map.get(params, "estimated_hours"),
               labor_cents: to_int(Map.get(params, "labor_cents")),
               parts_cents: to_int(Map.get(params, "parts_cents")),
               notes: notes,
               metadata: Map.get(params, "metadata", %{}),
               status: Map.get(params, "status", "sent")
             }),
           {:ok, quote_msg} <-
             Mailbox.create_message(
               %{
                 "vehicle_id" => vehicle_id,
                 "sender_id" => user_id,
                 "sender_type" => "user",
                 "message_type" => "quote",
                 "title" => "Quote received",
                 "content" => "#{div(amount_cents, 100)} #{currency} — #{notes || "Quote"}",
                 "priority" => "medium",
                 "metadata" => %{
                   "mailbox_id" => mailbox.id,
                   "work_order_id" => work_order_id,
                   "work_order_quote_id" => quote.id,
                   "amount_cents" => amount_cents,
                   "currency" => currency
                 }
               },
               user_id
             ) do
        json(conn, %{status: "success", data: %{quote: quote, mailbox_message: quote_msg}})
      else
        {:error, :unauthorized} ->
          conn |> put_status(:forbidden) |> json(%{status: "error", message: "Access denied"})

        {:error, changeset} ->
          conn |> put_status(:bad_request) |> json(%{status: "error", message: "Invalid quote", errors: format_changeset_errors(changeset)})

        other ->
          conn |> put_status(:internal_server_error) |> json(%{status: "error", message: "Failed to create quote", detail: inspect(other)})
      end
    end
  end

  # Assemble a "best quote" for a work order (system-assisted, replaces human browsing effort).
  #
  # POST /api/vehicles/:vehicle_id/mailbox/work-orders/:work_order_id/quotes/assemble
  #
  # Body:
  # {
  #   "part_queries": ["rear window seals", "seat mount hardware"]
  # }
  def assemble_work_order_quote(conn, %{"vehicle_id" => vehicle_id, "work_order_id" => work_order_id} = params) do
    user_id = get_user_id(conn)

    part_queries = Map.get(params, "part_queries") || Map.get(params, "partQueries") || []
    agent_cfg = Map.get(params, "agent") || %{}
    auto_research = Map.get(params, "auto_research", Map.get(params, "autoResearch", true))

    with {:ok, mailbox} <- Mailbox.get_vehicle_mailbox_with_access(vehicle_id, user_id),
         %{} = wo <- WorkOrders.get_work_order(work_order_id),
         true <- wo.vehicle_id == vehicle_id,
         true <- wo.customer_id == user_id,
         {:ok, {effective_queries, agent_output}} <-
           maybe_agent_part_queries(vehicle_id, work_order_id, part_queries, agent_cfg),
         {:ok, assembled} <-
           QuoteAssembler.assemble_best_parts(%{
             vehicle_id: vehicle_id,
             part_queries: effective_queries
           }) do
      parts_cents = to_int(get_in(assembled, [:totals, "parts_cents"]))
      missing_queries = Map.get(assembled, :missing, Map.get(assembled, "missing", [])) |> List.wrap()
      auto_research? = truthy?(auto_research)
      research_triggered? =
        if auto_research? and (parts_cents <= 0 or missing_queries != []) do
          maybe_trigger_research_async(vehicle_id, work_order_id, user_id, effective_queries, missing_queries)
          true
        else
          false
        end

      if parts_cents <= 0 do
        conn
        |> put_status(:conflict)
        |> json(%{
          status: "error",
          message: "No priced parts found for these queries",
          data:
            assembled
            |> Map.put(:agent, agent_output)
            |> Map.put(:research_triggered, research_triggered?)
        })
      else
        metadata =
          %{
            "origin" => "system_quote_assembler_v1",
            "vehicle_context" => assembled.vehicle_context,
            "line_items" => assembled.line_items,
            "missing" => assembled.missing,
            "based_on_parts_pricing_ids" => assembled.based_on_parts_pricing_ids,
            "agent" => agent_output,
            "research_triggered" => research_triggered?
          }

        with {:ok, quote} <-
               WorkOrders.create_quote(%{
                 work_order_id: work_order_id,
                 created_by: user_id,
                 amount_cents: parts_cents,
                 currency: "USD",
                 parts_cents: parts_cents,
                 notes: "System-assembled best parts offer",
                 metadata: metadata,
                 status: "draft"
               }),
             {:ok, quote_msg} <-
               Mailbox.create_message(
                 %{
                   "vehicle_id" => vehicle_id,
                   "sender_id" => user_id,
                   "sender_type" => "system",
                   "message_type" => "quote",
                   "title" => "Best quote assembled",
                   "content" => "#{div(parts_cents, 100)} USD — system-assembled best parts offer",
                   "priority" => "medium",
                   "metadata" => %{
                     "mailbox_id" => mailbox.id,
                     "work_order_id" => work_order_id,
                     "work_order_quote_id" => quote.id,
                     "amount_cents" => parts_cents,
                     "currency" => "USD",
                     "origin" => "system_quote_assembler_v1"
                   }
                 },
                 user_id
               ) do
          json(conn, %{
            status: "success",
            data: %{
              quote: quote,
              mailbox_message: quote_msg,
              assembled: assembled,
              research_triggered: research_triggered?
            }
          })
        else
          {:error, changeset} ->
            conn
            |> put_status(:bad_request)
            |> json(%{status: "error", message: "Invalid quote", errors: format_changeset_errors(changeset)})

          other ->
            conn
            |> put_status(:internal_server_error)
            |> json(%{status: "error", message: "Failed to assemble quote", detail: inspect(other)})
        end
      end
    else
      false ->
        conn |> put_status(:forbidden) |> json(%{status: "error", message: "Not authorized"})

      {:error, :vehicle_not_found} ->
        conn |> put_status(:not_found) |> json(%{status: "error", message: "Vehicle not found"})

      {:error, {:agent_not_configured, msg}} ->
        conn |> put_status(:bad_request) |> json(%{status: "error", message: msg})

      {:error, {:agent_failed, msg}} ->
        conn |> put_status(:bad_request) |> json(%{status: "error", message: msg})

      {:error, :unauthorized} ->
        conn |> put_status(:forbidden) |> json(%{status: "error", message: "Access denied"})

      other ->
        conn |> put_status(:internal_server_error) |> json(%{status: "error", message: "Server error", detail: inspect(other)})
    end
  end

  defp maybe_agent_part_queries(vehicle_id, work_order_id, part_queries, agent_cfg) do
    queries =
      part_queries
      |> List.wrap()
      |> Enum.map(&to_string/1)
      |> Enum.map(&String.trim/1)
      |> Enum.reject(&(&1 == ""))
      |> Enum.uniq()

    enabled =
      agent_cfg
      |> Map.get("enabled", Map.get(agent_cfg, :enabled, true))
      |> case do
        true -> true
        "true" -> true
        1 -> true
        _ -> false
      end

    if enabled and queries == [] do
      provider = Map.get(agent_cfg, "provider", "openai")
      model = Map.get(agent_cfg, "model")
      sources = Map.get(agent_cfg, "context_sources", ContextPack.default_sources())
      max_docs = Map.get(agent_cfg, "max_documents", 5)

      context_pack = ContextPack.build(vehicle_id, work_order_id, sources: sources, max_documents: max_docs)

      case QuoteAssemblyAgent.suggest_part_queries(%{
             provider: provider,
             model: model,
             context_pack: context_pack
           }) do
        {:ok, %{"part_queries" => suggested, "missing_constraints" => missing, "notes" => notes} = out} ->
          agent_meta =
            %{
              "enabled" => true,
              "provider" => provider,
              "model" => model,
              "context_sources" => sources,
              "missing_constraints" => missing,
              "notes" => notes
            }

          {:ok, {suggested, agent_meta}}

        {:error, :supabase_not_configured} ->
          {:error, {:agent_not_configured, "Supabase function caller not configured"}}

        {:error, _} ->
          {:error, {:agent_failed, "Agent failed to generate part queries"}}
      end
    else
      {:ok, {queries, %{"enabled" => enabled}}}
    end
  end

  defp truthy?(v) do
    case v do
      true -> true
      "true" -> true
      1 -> true
      "1" -> true
      _ -> false
    end
  end

  defp maybe_trigger_research_async(vehicle_id, work_order_id, user_id, effective_queries, missing_queries) do
    Task.start(fn ->
      try do
        cfg = NukeApi.Supabase.Client.config()
        supabase_url = cfg.url
        api_key = cfg.api_key

        if is_nil(supabase_url) or supabase_url == "" or is_nil(api_key) or api_key == "" do
          :noop
        else
          url = supabase_url <> "/functions/v1/research-agent"

          headers = [
            {"Authorization", "Bearer #{api_key}"},
            {"apikey", api_key},
            {"Content-Type", "application/json"}
          ]

          vehicle = Vehicles.get_vehicle(vehicle_id)

          vehicle_context =
            if vehicle do
              %{"year" => vehicle.year, "make" => vehicle.make, "model" => vehicle.model}
            else
              %{"vehicle_id" => vehicle_id}
            end

          searches =
            (missing_queries ++ effective_queries)
            |> Enum.map(&to_string/1)
            |> Enum.map(&String.trim/1)
            |> Enum.reject(&(&1 == ""))
            |> Enum.uniq()
            |> Enum.take(12)

          Enum.each(searches, fn q ->
            body =
              %{
                "search_type" => "part_number_lookup",
                "search_query" => q,
                "vehicle_context" => vehicle_context,
                "component_types" => [],
                "analysis_id" => nil,
                "gap_id" => nil,
                "user_id" => user_id,
                "work_order_id" => work_order_id,
                "origin" => "mailbox_quote_assemble"
              }
              |> Jason.encode!()

            _ = HTTPoison.post(url, body, headers, timeout: 60_000, recv_timeout: 60_000)
          end)

          # Emit a low-pressure status update into mailbox (best effort)
          _ =
            Mailbox.create_message(
              %{
                "vehicle_id" => vehicle_id,
                "sender_id" => user_id,
                "sender_type" => "system",
                "message_type" => "status_update",
                "title" => "Research started",
                "content" => "Looking up parts and pricing in the background. You can keep working; updates will appear here.",
                "priority" => "low",
                "metadata" => %{
                  "work_order_id" => work_order_id,
                  "origin" => "research-agent"
                }
              },
              user_id
            )
        end
      rescue
        _ -> :ok
      end
    end)

    :ok
  end

  # Accept a quote + mirror to mailbox as `acceptance`
  def accept_work_order_quote(conn, %{"vehicle_id" => vehicle_id, "work_order_id" => work_order_id, "quote_id" => quote_id}) do
    user_id = get_user_id(conn)

    with {:ok, mailbox} <- Mailbox.get_vehicle_mailbox_with_access(vehicle_id, user_id),
         %{} = wo <- WorkOrders.get_work_order(work_order_id),
         true <- wo.customer_id == user_id,
         {:ok, accepted_quote} <- WorkOrders.accept_quote!(work_order_id, quote_id),
         {:ok, _grant} <-
           maybe_grant_proof_access(vehicle_id, work_order_id, accepted_quote, user_id),
         {:ok, msg} <-
           Mailbox.create_message(
             %{
               "vehicle_id" => vehicle_id,
               "sender_id" => user_id,
               "sender_type" => "user",
               "message_type" => "acceptance",
               "title" => "Quote accepted",
               "content" => "Accepted quote #{accepted_quote.id}",
               "priority" => "high",
               "metadata" => %{
                 "mailbox_id" => mailbox.id,
                 "work_order_id" => work_order_id,
                 "work_order_quote_id" => accepted_quote.id
               }
             },
             user_id
           ) do
      # Timeline ingestion (best-effort)
      _ =
        Vehicles.create_timeline_event(%{
          "vehicle_id" => vehicle_id,
          "event_type" => "service",
          "event_date" => DateTime.utc_now(),
          "source" => "mailbox",
          "title" => "Quote accepted",
          "description" => "Quote accepted",
          "creator_id" => user_id,
          "metadata" => %{
            "work_order_id" => work_order_id,
            "work_order_quote_id" => accepted_quote.id,
            "mailbox_message_id" => msg.id
          }
        })
      json(conn, %{status: "success", data: %{quote: accepted_quote, mailbox_message: msg}})
    else
      false ->
        conn |> put_status(:forbidden) |> json(%{status: "error", message: "Only the work order owner can accept quotes"})

      nil ->
        conn |> put_status(:not_found) |> json(%{status: "error", message: "Work order not found"})

      {:error, :unauthorized} ->
        conn |> put_status(:forbidden) |> json(%{status: "error", message: "Access denied"})

      {:error, %Ecto.Changeset{} = changeset} ->
        conn |> put_status(:bad_request) |> json(%{status: "error", message: "Invalid update", errors: format_changeset_errors(changeset)})

      {:error, reason} ->
        conn |> put_status(:bad_request) |> json(%{status: "error", message: "Failed to accept quote", detail: inspect(reason)})

      other ->
        conn |> put_status(:internal_server_error) |> json(%{status: "error", message: "Server error", detail: inspect(other)})
    end
  end

  defp maybe_grant_proof_access(vehicle_id, work_order_id, accepted_quote, owner_user_id) do
    tech_user_id = Map.get(accepted_quote, :created_by)

    if is_binary(tech_user_id) do
      expires_at = DateTime.add(DateTime.utc_now(), 60 * 60 * 24 * 30, :second) # 30 days
      case WorkOrders.grant_proof_access!(vehicle_id, work_order_id, tech_user_id, owner_user_id, expires_at) do
        {:ok, _} -> {:ok, :granted}
        other -> other
      end
    else
      # Quote could be created by system/business; skip for now.
      {:ok, :skipped}
    end
  end

  # Mark message as read
  def mark_read(conn, %{"vehicle_id" => vehicle_id, "message_id" => message_id}) do
    user_id = get_user_id(conn)

    case Mailbox.mark_message_read(message_id, user_id, vehicle_id) do
      {:ok, message} ->
        json(conn, %{
          status: "success",
          data: message,
          message: "Message marked as read"
        })

      {:error, :not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{status: "error", message: "Message not found"})

      {:error, :unauthorized} ->
        conn
        |> put_status(:forbidden)
        |> json(%{status: "error", message: "Access denied"})
    end
  end

  # Resolve/close a message (for actionable notifications like duplicates)
  def resolve_message(conn, %{"vehicle_id" => vehicle_id, "message_id" => message_id} = params) do
    user_id = get_user_id(conn)
    resolution_data = Map.get(params, "resolution_data", %{})

    case Mailbox.resolve_message(message_id, user_id, vehicle_id, resolution_data) do
      {:ok, message} ->
        # Handle specific resolution actions based on message type
        handle_message_resolution(message, resolution_data, vehicle_id)

        json(conn, %{
          status: "success",
          data: message,
          message: "Message resolved successfully"
        })

      {:error, :not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{status: "error", message: "Message not found"})

      {:error, :unauthorized} ->
        conn
        |> put_status(:forbidden)
        |> json(%{status: "error", message: "Access denied"})
    end
  end

  # Grant access key to another user
  def grant_access(conn, %{"vehicle_id" => vehicle_id} = params) do
    granting_user_id = get_user_id(conn)

    access_params = %{
      "vehicle_id" => vehicle_id,
      "user_id" => Map.get(params, "user_id"),
      "org_id" => Map.get(params, "org_id"),
      "key_type" => Map.get(params, "key_type", "temporary"),
      "permission_level" => Map.get(params, "permission_level", "read_only"),
      "relationship_type" => Map.get(params, "relationship_type"),
      "expires_at" => Map.get(params, "expires_at"),
      "conditions" => Map.get(params, "conditions", %{}),
      "granted_by" => granting_user_id
    }

    case Mailbox.grant_access_key(access_params, granting_user_id) do
      {:ok, access_key} ->
        # Notify the recipient of new access
        notify_access_granted(access_key)

        json(conn, %{
          status: "success",
          data: access_key,
          message: "Access granted successfully"
        })

      {:error, :unauthorized} ->
        conn
        |> put_status(:forbidden)
        |> json(%{status: "error", message: "Only vehicle owner can grant access"})

      {:error, changeset} ->
        conn
        |> put_status(:bad_request)
        |> json(%{
          status: "error",
          message: "Invalid access parameters",
          errors: format_changeset_errors(changeset)
        })
    end
  end

  # Revoke access key
  def revoke_access(conn, %{"vehicle_id" => vehicle_id, "access_key_id" => access_key_id}) do
    revoking_user_id = get_user_id(conn)

    case Mailbox.revoke_access_key(access_key_id, revoking_user_id, vehicle_id) do
      {:ok, access_key} ->
        # Notify the user their access was revoked
        notify_access_revoked(access_key)

        json(conn, %{
          status: "success",
          message: "Access revoked successfully"
        })

      {:error, :not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{status: "error", message: "Access key not found"})

      {:error, :unauthorized} ->
        conn
        |> put_status(:forbidden)
        |> json(%{status: "error", message: "Unauthorized to revoke this access"})
    end
  end

  # List access keys for a vehicle (owner only)
  def list_access_keys(conn, %{"vehicle_id" => vehicle_id}) do
    user_id = get_user_id(conn)

    case Mailbox.list_vehicle_access_keys(vehicle_id, user_id) do
      {:ok, access_keys} ->
        json(conn, %{
          status: "success",
          data: access_keys
        })

      {:error, :unauthorized} ->
        conn
        |> put_status(:forbidden)
        |> json(%{status: "error", message: "Only vehicle owner can view access keys"})
    end
  end

  # Get duplicate detection details for a specific message
  def get_duplicate_details(conn, %{"vehicle_id" => vehicle_id, "message_id" => message_id}) do
    user_id = get_user_id(conn)

    case Mailbox.get_duplicate_detection_details(message_id, user_id, vehicle_id) do
      {:ok, details} ->
        json(conn, %{
          status: "success",
          data: details
        })

      {:error, :not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{status: "error", message: "Duplicate detection not found"})

      {:error, :unauthorized} ->
        conn
        |> put_status(:forbidden)
        |> json(%{status: "error", message: "Access denied"})
    end
  end

  # Confirm or reject duplicate detection
  def handle_duplicate_confirmation(conn, %{"vehicle_id" => vehicle_id, "message_id" => message_id} = params) do
    user_id = get_user_id(conn)
    action = Map.get(params, "action") # "confirm" or "reject"

    case Mailbox.handle_duplicate_confirmation(message_id, user_id, vehicle_id, action) do
      {:ok, result} ->
        json(conn, %{
          status: "success",
          data: result,
          message: "Duplicate #{action}ed successfully"
        })

      {:error, :not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{status: "error", message: "Duplicate detection not found"})

      {:error, :unauthorized} ->
        conn
        |> put_status(:forbidden)
        |> json(%{status: "error", message: "Access denied"})

      {:error, :invalid_action} ->
        conn
        |> put_status(:bad_request)
        |> json(%{status: "error", message: "Invalid action. Use 'confirm' or 'reject'"})
    end
  end

  # Private helper functions

  defp get_user_id(conn) do
    # Extract user ID from auth token/session
    # This should be set by the AuthPlug
    conn.assigns[:current_user_id] || get_session(conn, :user_id)
  end

  defp broadcast_message_created(vehicle_id, message) do
    # Broadcast to all users with access to this vehicle's mailbox
    NukeApiWeb.Endpoint.broadcast("mailbox:#{vehicle_id}", "message_created", %{
      message: message
    })
  end

  defp handle_message_resolution(message, resolution_data, vehicle_id) do
    case message.message_type do
      "duplicate_detected" ->
        # Handle duplicate detection resolution
        handle_duplicate_resolution(message, resolution_data, vehicle_id)

      "ownership_transfer" ->
        # Handle ownership transfer completion
        handle_ownership_transfer_resolution(message, resolution_data, vehicle_id)

      _ ->
        :ok
    end
  end

  defp handle_duplicate_resolution(message, resolution_data, vehicle_id) do
    duplicate_vehicle_id = get_in(message.metadata, ["duplicate_vehicle_id"])
    action = Map.get(resolution_data, "action")

    case action do
      "merge" ->
        # Trigger vehicle merge process
        Task.start(fn ->
          NukeApi.Vehicles.merge_duplicate_vehicles(vehicle_id, duplicate_vehicle_id)
        end)

      "ignore" ->
        # Mark as false positive
        NukeApi.Mailbox.mark_duplicate_as_false_positive(vehicle_id, duplicate_vehicle_id)

      _ ->
        :ok
    end
  end

  defp handle_ownership_transfer_resolution(message, resolution_data, vehicle_id) do
    new_owner_id = Map.get(resolution_data, "new_owner_id")

    if new_owner_id do
      Task.start(fn ->
        NukeApi.Vehicles.transfer_ownership(vehicle_id, new_owner_id)
      end)
    end
  end

  defp notify_access_granted(access_key) do
    if access_key.user_id do
      # Send notification to user about new access
      NukeApi.Notifications.send_access_granted_notification(access_key)
    end
  end

  defp notify_access_revoked(access_key) do
    if access_key.user_id do
      # Send notification to user about revoked access
      NukeApi.Notifications.send_access_revoked_notification(access_key)
    end
  end

  defp format_changeset_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {key, value}, acc ->
        String.replace(acc, "%{#{key}}", to_string(value))
      end)
    end)
  end

  defp to_int(v) when is_integer(v), do: v
  defp to_int(v) when is_binary(v) do
    case Integer.parse(v) do
      {n, _} -> n
      _ -> 0
    end
  end
  defp to_int(v) when is_float(v), do: trunc(v)
  defp to_int(_), do: 0

  defp user_can_provide_proof?(vehicle_id, work_order_id, user_id) do
    # Owner always can
    case WorkOrders.get_work_order(work_order_id) do
      %{} = wo when wo.customer_id == user_id ->
        true

      _ ->
        # Otherwise require an active vehicle_user_permissions row scoped to this work order (set at acceptance)
        try do
          vehicle_id_b = Ecto.UUID.dump!(to_string(vehicle_id))
          user_id_b = Ecto.UUID.dump!(to_string(user_id))
          res =
            NukeApi.Repo.query!(
              """
              select 1
              from public.vehicle_user_permissions vup
              where vup.vehicle_id = $1
                and vup.user_id = $2
                and coalesce(vup.is_active, true) = true
                and (vup.expires_at is null or vup.expires_at > now())
                and vup.context = $3
              limit 1
              """,
              [vehicle_id_b, user_id_b, "work_order:" <> to_string(work_order_id)]
            )

          res.num_rows > 0
        rescue
          _ -> false
        end
    end
  end

  defp ensure_owner!(%{customer_id: customer_id}, user_id) do
    if customer_id == user_id, do: :ok, else: {:error, :forbidden}
  end

  defp ensure_work_order_in_vehicle!(%{vehicle_id: wo_vehicle_id}, vehicle_id) do
    if wo_vehicle_id == vehicle_id, do: :ok, else: {:error, :forbidden}
  end

  defp ensure_work_order_ready_to_complete!(wo) do
    cond do
      wo.is_published != true -> {:error, :not_ready}
      wo.status not in ["approved", "scheduled", "in_progress", "pending"] -> {:error, :not_ready}
      true -> :ok
    end
  end

  defp ensure_work_order_ready_to_request_completion!(wo) do
    cond do
      wo.is_published != true -> {:error, :not_ready}
      wo.status in ["completed", "paid", "cancelled"] -> {:error, :not_ready}
      wo.status not in ["approved", "scheduled", "in_progress", "pending"] -> {:error, :not_ready}
      true -> :ok
    end
  end

  defp ensure_deliverables_complete!(work_order_id, wo) do
    required = WorkOrders.required_deliverables(wo)
    missing = WorkOrders.missing_deliverables(work_order_id, required)

    if missing == [] do
      :ok
    else
      {:error, {:missing_deliverables, missing}}
    end
  end
end