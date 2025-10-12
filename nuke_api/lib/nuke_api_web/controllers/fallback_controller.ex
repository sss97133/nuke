defmodule NukeApiWeb.FallbackController do
  @moduledoc """
  Translates controller action results into valid `Plug.Conn` responses.
  
  Provides centralized error handling for the API endpoints in the Nuke platform.
  """
  
  use NukeApiWeb, :controller

  # This clause handles errors returned by Ecto's insert/update/delete.
  def call(conn, {:error, %Ecto.Changeset{} = changeset}) do
    conn
    |> put_status(:unprocessable_entity)
    |> put_view(json: NukeApiWeb.ErrorJSON)
    |> render(:error, changeset: changeset)
  end

  # This clause is an example of how to handle resources that cannot be found.
  def call(conn, {:error, :not_found}) do
    conn
    |> put_status(:not_found)
    |> put_view(json: NukeApiWeb.ErrorJSON)
    |> render(:error, message: "Resource not found")
  end
  
  # This clause handles unauthorized access
  def call(conn, {:error, :unauthorized}) do
    conn
    |> put_status(:unauthorized)
    |> put_view(json: NukeApiWeb.ErrorJSON)
    |> render(:error, message: "Authentication required")
  end
  
  # This clause handles forbidden access
  def call(conn, {:error, :forbidden}) do
    conn
    |> put_status(:forbidden)
    |> put_view(json: NukeApiWeb.ErrorJSON)
    |> render(:error, message: "You do not have permission to access this resource")
  end
  
  # Handle other types of errors
  def call(conn, {:error, status, message}) when is_atom(status) do
    conn
    |> put_status(status)
    |> put_view(json: NukeApiWeb.ErrorJSON)
    |> render(:error, message: message)
  end
end
