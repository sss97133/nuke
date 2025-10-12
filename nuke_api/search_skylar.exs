alias NukeApi.Repo
import Ecto.Query

# Search for profiles with skylar
profiles = from(p in "profiles",
  where: ilike(p.full_name, "%skylar%") or ilike(p.email, "%skylar%"),
  select: %{id: p.id, full_name: p.full_name, email: p.email, created_at: p.created_at}
) |> Repo.all()
IO.puts("=== PROFILES MATCHING SKYLAR ===")
IO.inspect(profiles, pretty: true)

# Search ownership verifications for any user with skylar in name
ownerships = from(ov in "ownership_verifications",
  join: p in "profiles", on: ov.user_id == p.id,
  where: ilike(p.full_name, "%skylar%") or ilike(p.email, "%skylar%"),
  select: %{
    id: ov.id,
    vehicle_id: ov.vehicle_id,
    user_id: ov.user_id,
    verification_type: ov.verification_type,
    status: ov.status,
    profile_name: p.full_name,
    profile_email: p.email,
    created_at: ov.created_at
  }
) |> Repo.all()
IO.puts("=== OWNERSHIP VERIFICATIONS FOR SKYLAR ===")
IO.inspect(ownerships, pretty: true)

# Also check vehicle_contributors table
contribs = from(vc in "vehicle_contributors",
  join: p in "profiles", on: vc.user_id == p.id,
  where: ilike(p.full_name, "%skylar%") or ilike(p.email, "%skylar%"),
  select: %{
    id: vc.id,
    vehicle_id: vc.vehicle_id,
    user_id: vc.user_id,
    role: vc.role,
    status: vc.status,
    profile_name: p.full_name,
    profile_email: p.email,
    created_at: vc.created_at
  }
) |> Repo.all()
IO.puts("=== VEHICLE CONTRIBUTORS FOR SKYLAR ===")
IO.inspect(contribs, pretty: true)