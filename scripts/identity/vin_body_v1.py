# vin_body_v1: maps stored vPIC body_class (vin_vpic_decode, PR #2738) to vehicle category.
# Only VINs of 17 chars with valid check digit; decode make must match vehicle make, year within 1.
# Motorcycle class not applied (held-out 96/108: autocycles like Morgan/Vanderhall/Campagna).
import re
def norm(s): return re.sub(r'[^a-z]','',(s or '').lower())
ALIAS={'chevy':'chevrolet','vw':'volkswagen','mercedes':'mercedesbenz','mercedesbenz':'mercedesbenz','landrover':'landrover','harley':'harleydavidson','harleydavidson':'harleydavidson','alfa':'alfaromeo','rollsroyce':'rollsroyce'}
def cat(b):
  if b is None: return None
  if b.startswith('Motorcycle -') or re.match(r'Off-Road Vehicle - (Dirt Bike|Motocross|Enduro)',b): return 'motorcycle'
  if re.match(r'Off-Road Vehicle - (All-Terrain|Multipurpose)|Low Speed Vehicle',b): return 'cart_utility'
  if b=='Trailer': return 'trailer_rv'
  if b in ('Coupe','Convertible/Cabriolet','Sedan/Saloon','Hatchback/Liftback/Notchback','Roadster','Wagon','Limousine'): return 'car'
  if b in ('Pickup','Sport Utility Vehicle [SUV]/Multipurpose Vehicle [MPV]','Crossover Utility Vehicle [CUV]','Sport Utility Truck [SUT]','Van','Cargo Van','Minivan','Truck','Truck-Tractor','Step Van/Walk-in Van') or re.match(r'Incomplete - (Chassis Cab|Cutaway|Commercial Chassis)',b): return 'truck_utility'
  return None  # Incomplete, motor home chassis, school bus, streetcar: not mapped
def make_ok(dm,vm):
  a,b=norm(dm),norm(vm); a=ALIAS.get(a,a); b=ALIAS.get(b,b)
  return bool(a and b and (a.startswith(b[:5]) or b.startswith(a[:5])))
