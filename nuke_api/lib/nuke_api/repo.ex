defmodule NukeApi.Repo do
  use Ecto.Repo,
    otp_app: :nuke_api,
    adapter: Ecto.Adapters.Postgres
end
