import Ecto.Query
alias NukeApi.Repo
alias NukeApi.Vehicles.Image

IO.puts("📊 Checking images database...")

# Simple count query to test connection
total_images = from(i in Image, select: count(i.id)) |> Repo.one()
IO.puts("Total images in database: #{total_images}")

if total_images > 0 do
  # Get a sample image to check structure
  sample_image = from(i in Image, limit: 1) |> Repo.one()
  IO.puts("Sample image fields available: #{inspect(Map.keys(sample_image))}")
  IO.puts("Sample image URL: #{sample_image.url}")
end