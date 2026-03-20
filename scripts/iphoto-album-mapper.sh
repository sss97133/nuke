#!/bin/bash
# iphoto-album-mapper.sh — Maps all 72 iPhoto albums to vehicle IDs and runs intake
# Generated 2026-03-20. Run with: dotenvx run -- bash scripts/iphoto-album-mapper.sh
#
# This script calls iphoto-intake.mjs for each album with explicit --vehicle-id
# and --force to bypass name-mismatch guards (album names don't always match DB model names).

set -euo pipefail
cd /Users/skylar/nuke

INTAKE="node scripts/iphoto-intake.mjs"
DL="--download-missing"  # Download iCloud-only photos

run_album() {
  local album="$1"
  local vid="$2"
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "  Album: $album"
  echo "  Vehicle: $vid"
  echo "═══════════════════════════════════════════════════════════════"
  # Use --sync to download iCloud-only photos, --force to bypass name mismatch guards
  $INTAKE --sync --album "$album" --vehicle-id "$vid" --force || echo "  ⚠ FAILED: $album"
}

echo "Starting iPhoto album intake — $(date)"
echo "72 albums mapped to vehicle IDs"
echo ""

# ─── 1932 ────────────────────────────────────────────────────────────
run_album "1932 Ford Roadster" "21ee373f-765e-4e24-a69d-e59e2af4f467"

# ─── 1959 ────────────────────────────────────────────────────────────
run_album "1959 Chevrolet 3100 SWB" "319c8829-076a-4b01-9ec2-e9e9b204390e"

# ─── 1963 ────────────────────────────────────────────────────────────
run_album "1963 shovel head" "d45c3f01-3dd6-4120-9860-f4536138efb3"

# ─── 1964 ────────────────────────────────────────────────────────────
run_album "1964 Chevrolet C20 LWB" "b4ee2210-52ee-4d83-b307-87f1ee5c8b83"
run_album "1964 Jaguar convertible 4.2 xke" "16387b47-c684-4cc1-b5bd-b4064cc6277e"

# ─── 1965 ────────────────────────────────────────────────────────────
run_album "1965 Chevrolet corvette" "d29a8779-6815-42b9-a20f-c835742d6080"

# ─── 1966 ────────────────────────────────────────────────────────────
run_album "1966 Chevrolet C10 SWB" "48875fce-7b71-48f5-ac36-bcaf12f50fd0"
run_album "1966 Ford Mustang Cpe Blk" "83f6f033-a3c3-4cf4-a85e-a60d2c588838"
run_album "1966 ford mustang yellow" "8bde1dda-ebb4-480e-8942-e561feb36667"

# ─── 1967 ────────────────────────────────────────────────────────────
run_album "1967 Chevrolet C10 LWB" "0ec9d9c2-e577-4cdb-b381-0d3dd9967747"
run_album "1967 Chevrolet C10 SWB" "0ec2c1ef-de57-45a8-b594-ef534e26cf6f"
run_album "1967 Chevrolet c10 swb" "0ec2c1ef-de57-45a8-b594-ef534e26cf6f"
run_album "1967 GTO Pontiac" "cf566074-901c-47b4-8612-ca3a2ff8cfb1"
run_album "1967 Porsche 912" "ab3f91b3-1104-45e2-8dc7-8c241eb1516e"

# ─── 1968 ────────────────────────────────────────────────────────────
run_album "1968 C10 Chevrolet LWB" "ac070808-4cbd-4d03-9c39-2ec5b0f0708c"
run_album "1968 Chevrolet C10 LWB" "ac070808-4cbd-4d03-9c39-2ec5b0f0708c"
run_album "1968 Ford Mustang  FB blk" "5dbbb59a-1c93-428d-a4e9-27f5638020e5"
run_album "1968 Porsche 911" "b987278a-64ab-44ae-8342-37557b79f73e"

# ─── 1969 ────────────────────────────────────────────────────────────
run_album "1969 Chevrolet c10 lwb" "1fe01b00-b61b-47e3-b539-d3b81731c26b"

# ─── 1970 ────────────────────────────────────────────────────────────
run_album "1970 Mercedes 280SL" "acef5364-7430-480c-875b-ab1f38f2c53f"

# ─── 1971 ────────────────────────────────────────────────────────────
run_album "1971 Chevrolet C10 LWB 396" "e5c66393-dd38-446c-aedc-f7c190327fd8"
run_album "1971 Chevrolet C10 SWB 402" "2cb63055-b80e-4145-b4c7-7af72081fa0c"
run_album "1971 Ford Bronco 302" "95fbb5c3-568b-4ebd-b6dd-7f3adffd3e43"
run_album "1971 Ford Bronco Coyote" "c6189023-ab62-4ca8-9bb0-94511a30f037"
run_album "1971 K15 GMC Suburban" "f375f605-6700-4d08-9f65-45860c4466a6"

# ─── 1972 ────────────────────────────────────────────────────────────
run_album "1972 Chevrolet K10 LWB" "a8c62a6d-f6e1-42fb-808d-d8a73677dc71"
run_album "1972 GMC C30 longhorn" "8cb16949-6818-4b98-8bea-39633f6a33ba"
run_album "1972 K10 Chevrolet SWB" "e8a9c558-a930-4e55-9e5c-4a2711cab081"
run_album "1972 k5 blazer" "f5c6174d-d9d8-41d5-bda4-8e7590741d2f"

# ─── 1973 ────────────────────────────────────────────────────────────
run_album "1973 C30 Chevrolet LWB" "ca42fb87-2a18-4ca7-8ebc-39bcbdaef7a6"
run_album "1973 Chevrolet K20 LWB" "ef844607-46fc-40a5-a27b-ad245ffe5ef5"
run_album "1973 Dodge Charger" "f05462f9-4901-4e02-bbed-8d2670de4646"
run_album "1973 Dodge charger 360" "043c6d8b-c81e-420a-9d20-77cf3385fc2a"
run_album "1973 K20 Chevrolet LWB" "ef844607-46fc-40a5-a27b-ad245ffe5ef5"
run_album "1973 K5 GMC  jimmy" "50dd2f1a-01de-4f26-9729-c38a82b7c1bb"
run_album "1973 Pontiac Firebird" "2d99d294-55ae-4dfd-8444-d46d8e90d102"

# ─── 1974 ────────────────────────────────────────────────────────────
run_album "1974 K5 Chevrolet Blazer" "fc359eb0-796f-4c51-b47d-e79c248d1175"
run_album "1974 bronco 351 Windsor" "710dc2a3-ce4c-4189-a51b-a2d2d41480d6"

# ─── 1976 ────────────────────────────────────────────────────────────
run_album "1976 C20 Chevrolet LWB" "7c1f5fda-aab2-44fb-9b91-664a5dcdc0c0"

# ─── 1977 ────────────────────────────────────────────────────────────
run_album "1977 Chevrolet K10 SWB" "80e04dd6-983e-4c78-ba15-c0599e50ecd9"
run_album "1977 K5 Chevrolet Blazer" "e08bf694-970f-4cbe-8a74-8715158a0f2e"

# ─── 1978 ────────────────────────────────────────────────────────────
run_album "1978 Chevrolet K20 LWB Blue" "d5ec0923-fc83-4ed1-b094-6cfb14713e4c"
run_album "1978 K20 Chevrolet LWB" "d5ec0923-fc83-4ed1-b094-6cfb14713e4c"

# ─── 1979 ────────────────────────────────────────────────────────────
run_album "1979 Chevrolet Big10 Justin" "4470c7b9-bbbc-4627-b908-3fc0567a68e7"
run_album "1979 Chevrolet K10 SWB Brown" "afcfef94-895f-436b-b66c-acb2e2f46973"
run_album "1979 GMC K15 SWB White" "a621f67e-67c8-457a-bf2b-41c53efe9a73"
run_album "1979 gmc sierra k1500" "a621f67e-67c8-457a-bf2b-41c53efe9a73"

# ─── 1980 ────────────────────────────────────────────────────────────
run_album "1980 Chevrolet C10 LWB" "06d4eb9b-74af-49a8-af7c-75aeb5abfe27"
run_album "1980 Chevrolet K30 Crew Cab" "f6e64a4f-6f74-4234-8174-5a7f8dbdafab"

# ─── 1981 ────────────────────────────────────────────────────────────
run_album "1981 DMC Delorean" "86266ebb-1914-4097-8dd3-c92e1eed4f5a"

# ─── 1982 ────────────────────────────────────────────────────────────
run_album "1982 GMC K2500 LWB" "46502e12-881e-4181-92a4-f9278c9e37de"

# ─── 1983 ────────────────────────────────────────────────────────────
run_album "1983 GMC K2500 BLUE" "d6a01df2-dc78-4fe9-9559-2c4cf6124a7a"
run_album "1983 GMC K2500 LWB" "5a1deb95-4b67-4cc3-9575-23bb5b180693"

# ─── 1984 ────────────────────────────────────────────────────────────
run_album "1984 Chevrolet K10 SWB" "6442df03-9cac-43a8-b89e-e4fb4c08ee99"
run_album "1984 Chevrolet K20 LWB" "ae75685e-45dd-4834-95ad-ddcc06887b94"

# ─── 1985 ────────────────────────────────────────────────────────────
run_album "1985 Chevrolet K10 SWB" "a84273ab-4e0d-45c4-bdaa-5c9ad023079d"
run_album "1985 Chevrolet K10 SWB Brad" "2e60f268-c54b-4e5b-ac03-2ead0a85de38"
run_album "1985 Chevrolet K20 LWB" "a69aab8c-8a23-4835-b4a8-ce6c5f476379"
run_album "1985 Chevrolet k10 Suburban" "b5a0c58a-6915-499b-ba5d-63c42fb6a91f"

# ─── 1987 ────────────────────────────────────────────────────────────
run_album "1987 Chevrolet V3500 Dually" "b5a24e45-7171-4296-b13b-032e9f959eb8"
run_album "1987 GMC V15 LWB" "e0bcd7fe-ebf1-49ed-8756-1d6ba761d911"
run_album "1987 GMC V15 Suburban" "b1fd848d-c64d-4b3a-8d09-0bacfeef9561"
run_album "1987 Nissan maxima" "10020b70-4bc4-41bf-9095-e75d61c8c70c"

# ─── 1988 ────────────────────────────────────────────────────────────
run_album "1988 Chevrolet V3500" "c3819d9c-342e-4743-9500-e27a8f574818"
run_album "1988 GMC V15 Suburban" "031c94fe-16fe-44f3-817b-f60abd94bb86"
run_album "1988 GMC V3500" "c3819d9c-342e-4743-9500-e27a8f574818"

# ─── 1989 ────────────────────────────────────────────────────────────
run_album "1989 jimmy k5" "2789fa29-1823-467c-a84b-857f552c340f"

# ─── 1995 ────────────────────────────────────────────────────────────
run_album "1995 Chevrolet 2500 Suburban" "1db5daca-526e-42c6-99ae-7faee79b5bad"

# ─── 1997 ────────────────────────────────────────────────────────────
run_album "1997 Lexus LX450" "4ecc1fa5-c2c2-485b-bc57-144d6215d22a"

# ─── 2004 ────────────────────────────────────────────────────────────
run_album "2004 ford f350" "350bfdcb-370c-4013-8f3f-54b38113d4fb"

# ─── 2005 ────────────────────────────────────────────────────────────
run_album "2005 Ferrari 360 spider" "1511336a-daa0-48ef-bcb3-15720474e602"

# ─── 2025 ────────────────────────────────────────────────────────────
run_album "2025 ford expedition" "fd53be89-8586-43eb-ab9e-577be437db56"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  COMPLETE — $(date)"
echo "═══════════════════════════════════════════════════════════════"
