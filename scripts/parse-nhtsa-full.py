#!/usr/bin/env python3
"""Parse NHTSA DecodeVINValuesBatch response and emit SQL UPDATE statements.
Unlike parse-nhtsa-batch.py, this extracts ALL fields including trim,
and doesn't skip VINs where engine data is missing."""
import json, sys

data = json.load(sys.stdin)
results = data.get('Results', [])
count = 0
skipped = 0

for r in results:
    vin = (r.get('VIN') or '').strip()
    if not vin:
        continue

    error_code = str(r.get('ErrorCode', '0')).strip()
    # Skip fatal decode errors (but allow 0=clean, 1=minor, 6=incomplete, 7=not registered)
    if error_code not in ('0', '1', '6', '7', ''):
        skipped += 1
        continue

    # Extract all available fields
    make = (r.get('Make') or '').strip()
    model = (r.get('Model') or '').strip()
    trim = (r.get('Trim') or '').strip()
    series = (r.get('Series') or '').strip()
    year = (r.get('ModelYear') or '').strip()

    disp = (r.get('DisplacementL') or '').strip()
    cyls = (r.get('EngineCylinders') or '').strip()
    config = (r.get('EngineConfiguration') or '').strip()
    fuel = (r.get('FuelTypePrimary') or '').strip()
    trans = (r.get('TransmissionStyle') or '').strip()
    speeds = (r.get('TransmissionSpeeds') or '').strip()
    drive = (r.get('DriveType') or '').strip()
    body = (r.get('BodyClass') or '').strip()
    doors = (r.get('Doors') or '').strip()
    manufacturer = (r.get('Manufacturer') or '').strip()
    plant_city = (r.get('PlantCity') or '').strip()
    plant_country = (r.get('PlantCountry') or '').strip()

    # Build engine_size string
    config_map = {
        'V-Shaped': 'V', 'In-Line': 'I', 'Flat': 'Flat-',
        'Horizontally Opposed': 'Flat-', 'W-Shaped': 'W', 'Rotary': 'Rotary'
    }
    cs = config_map.get(config, '')

    engine_size = ''
    if disp and cyls and cs:
        engine_size = f"{float(disp):.1f}L {cs}{cyls}"
    elif disp and cyls:
        engine_size = f"{float(disp):.1f}L {cyls}-cyl"
    elif disp:
        engine_size = f"{float(disp):.1f}L"

    # Build transmission string
    transmission = ''
    if trans and speeds:
        transmission = f"{speeds}-speed {trans.lower()}"
    elif trans:
        transmission = trans.lower()

    # Normalize body style
    body_norm = ''
    if body:
        body_norm = body
        for pat, repl in [('Sport Utility', 'SUV'), ('Pickup', 'Truck'), ('Sedan', 'Sedan'),
                           ('Coupe', 'Coupe'), ('Convertible', 'Convertible'),
                           ('Wagon', 'Wagon'), ('Van', 'Van'), ('Hatchback', 'Hatchback'),
                           ('Roadster', 'Roadster'), ('Cab Chassis', 'Cab Chassis')]:
            if pat in body:
                body_norm = repl
                break

    def esc(s):
        return s.replace("'", "''")

    def clean(s):
        """Remove 'Not Applicable' and other junk values."""
        if not s or s in ('Not Applicable', 'N/A', 'null', 'None'):
            return ''
        return s.strip()

    trim = clean(trim)
    series = clean(series)
    engine_size = clean(engine_size)
    transmission = clean(transmission)
    drive = clean(drive)
    fuel = clean(fuel)
    body_norm = clean(body_norm)
    make = clean(make)
    model = clean(model)

    # Build SET clauses — COALESCE means we only fill empty fields
    sets = []
    if trim:
        sets.append(f"trim = COALESCE(NULLIF(trim, ''), '{esc(trim)}')")
    if series:
        sets.append(f"series = COALESCE(NULLIF(series, ''), '{esc(series)}')")
    if engine_size:
        sets.append(f"engine_size = COALESCE(NULLIF(engine_size, ''), '{esc(engine_size)}')")
    if transmission:
        sets.append(f"transmission = COALESCE(NULLIF(transmission, ''), '{esc(transmission)}')")
    if drive:
        sets.append(f"drivetrain = COALESCE(NULLIF(drivetrain, ''), '{esc(drive)}')")
    if fuel:
        sets.append(f"fuel_type = COALESCE(NULLIF(fuel_type, ''), '{esc(fuel.lower())}')")
    if body_norm:
        sets.append(f"body_style = COALESCE(NULLIF(body_style, ''), '{esc(body_norm)}')")
    if doors and doors.isdigit():
        sets.append(f"doors = COALESCE(doors, {doors})")

    if not sets:
        skipped += 1
        continue

    print(f"UPDATE vehicles SET {', '.join(sets)} WHERE vin = '{esc(vin)}';")
    count += 1

print(f"-- {count} VINs decoded, {skipped} skipped", file=sys.stderr)
