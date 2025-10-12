#!/usr/bin/env elixir

# Script to identify and remove duplicate images

import Ecto.Query
alias NukeApi.Repo
alias NukeApi.Vehicles.Image

IO.puts("🔍 Identifying duplicate images...")

# Find potential duplicates based on:
# 1. Same URL
# 2. Same file size
# 3. Same vehicle_id
# 4. Created within a short time window (indicating bulk upload glitch)

duplicates_by_url = from(i in Image,
  select: [i.url, count(i.id)],
  group_by: i.url,
  having: count(i.id) > 1
) |> Repo.all()

IO.puts("Found #{length(duplicates_by_url)} URLs with duplicates:")
Enum.each(duplicates_by_url, fn [url, count] ->
  IO.puts("  - #{url}: #{count} copies")
end)

# Get detailed duplicate groups
duplicate_groups = from(i in Image,
  select: {i.url, i.vehicle_id, count(i.id), fragment("array_agg(? ORDER BY ?)", i.id, i.inserted_at)},
  group_by: [i.url, i.vehicle_id],
  having: count(i.id) > 1
) |> Repo.all()

IO.puts("\n📋 Detailed duplicate analysis:")
Enum.each(duplicate_groups, fn {url, vehicle_id, count, ids} ->
  IO.puts("URL: #{url} | Vehicle: #{vehicle_id} | Count: #{count}")
  IO.puts("  IDs: #{inspect(ids)}")

  # Get the actual image records to see timestamps
  images = from(i in Image,
    where: i.id in ^ids,
    order_by: [asc: i.inserted_at]
  ) |> Repo.all()

  Enum.with_index(images, fn image, index ->
    IO.puts("  #{index + 1}. ID: #{image.id} | Created: #{image.inserted_at} | Size: #{image.file_size} | URL: #{image.url}")
  end)

  IO.puts("")
end)

# Ask for confirmation before deleting
IO.puts("🗑️  Ready to remove duplicates (keeping the oldest copy of each file).")
IO.puts("This will delete #{Enum.sum(Enum.map(duplicate_groups, fn {_, _, count, _} -> count - 1 end))} duplicate images.")
IO.write("Proceed? (y/n): ")

case IO.read(:line) |> String.trim() |> String.downcase() do
  "y" ->
    IO.puts("Removing duplicates...")

    {total_deleted, deleted_details} = Enum.reduce(duplicate_groups, {0, []}, fn {url, _vehicle_id, _count, ids}, {acc_count, acc_details} ->
      # Keep the first (oldest) image, delete the rest
      [keep_id | delete_ids] = ids

      deleted_images = from(i in Image, where: i.id in ^delete_ids) |> Repo.all()
      deleted_count = from(i in Image, where: i.id in ^delete_ids) |> Repo.delete_all() |> elem(0)

      IO.puts("Kept #{keep_id}, deleted #{deleted_count} duplicates of #{url}")

      {acc_count + deleted_count, acc_details ++ Enum.map(deleted_images, &(&1.id))}
    end)

    IO.puts("\n✅ Cleanup complete!")
    IO.puts("Total images deleted: #{total_deleted}")
    IO.puts("Deleted image IDs: #{inspect(deleted_details)}")

  _ ->
    IO.puts("❌ Cancelled. No changes made.")
end