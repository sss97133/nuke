defmodule NukeApiWeb.Plugs.AuthPlug do
  @moduledoc """
  Authentication plug for Supabase JWT tokens.
  
  This plug verifies the JWT token from the Authorization header
  and adds the user claims to the connection for downstream use.
  """
  
  import Plug.Conn
  require Logger
  alias NukeApi.Supabase.Client, as: SupabaseClient

  def init(opts), do: opts

  def call(conn, _opts) do
    with ["Bearer " <> token] <- get_req_header(conn, "authorization"),
         {:ok, claims} <- SupabaseClient.verify_token(token) do

      # If token is valid, assign user data to the connection
      conn
      |> assign(:current_user_id, claims["sub"])
      |> assign(:user_claims, claims)
      |> assign(:authenticated, true)
    else
      _ ->
        # If no token or invalid token, mark as not authenticated
        # but allow request to continue (endpoints can enforce auth if needed)
        conn
        |> assign(:authenticated, false)
        |> assign(:current_user_id, nil)
    end
  end
end
