#!/usr/bin/env python3
"""Parse NHTSA DecodeVINValuesBatch response and emit SQL UPDATE statements.
Batch response uses flat keys like DisplacementL, EngineCylinders, etc."""
import json, sys

data = json.load(sys.stdin)
results = data.get('Results', [])
count = 0

for r in results:
    vin = (r.get('VIN') or '').strip()
    if not vin:
        continue

    error_code = str(r.get('ErrorCode', '0')).strip()
    # Skip fatal decode errors (but allow 0=clean, 1=minor, 6=incomplete, 7=not registered)
    if error_code not in ('0', '1', '6', '7', ''):
        continue

    disp = (r.get('DisplacementL') or '').strip()
    cyls = (r.get('EngineCylinders') or '').strip()
    config = (r.get('EngineConfiguration') or '').strip()
    fuel = (r.get('FuelTypePrimary') or '').strip()
    trans = (r.get('TransmissionStyle') or '').strip()
    speeds = (r.get('TransmissionSpeeds') or '').strip()
    drive = (r.get('DriveType') or '').strip()
    body = (r.get('BodyClass') or '').strip()
    doors = (r.get('Doors') or '').strip()

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

    if not engine_size:
        continue

    transmission = ''
    if trans and speeds:
        transmission = f"{speeds}-speed {trans.lower()}"
    elif trans:
        transmission = trans.lower()

    body_norm = body
    for pat, repl in [('Sport Utility', 'SUV'), ('Pickup', 'Truck'), ('Sedan', 'Sedan'),
                       ('Coupe', 'Coupe'), ('Convertible', 'Convertible'),
                       ('Wagon', 'Wagon'), ('Van', 'Van'), ('Hatchback', 'Hatchback')]:
        if pat in body:
            body_norm = repl
            break

    def esc(s):
        return s.replace("'", "''")

    sets = [f"engine_size = COALESCE(engine_size, '{esc(engine_size)}')"]
    if transmission:
        sets.append(f"transmission = COALESCE(transmission, '{esc(transmission)}')")
    if drive:
        sets.append(f"drivetrain = COALESCE(drivetrain, '{esc(drive)}')")
    if fuel and fuel != 'Not Applicable':
        sets.append(f"fuel_type = COALESCE(fuel_type, '{esc(fuel.lower())}')")
    if body_norm and body_norm != 'Not Applicable':
        sets.append(f"body_style = COALESCE(body_style, '{esc(body_norm)}')")
    if doors and doors.isdigit():
        sets.append(f"doors = COALESCE(doors, {doors})")

    print(f"UPDATE vehicles SET {', '.join(sets)} WHERE vin = '{esc(vin)}' AND engine_size IS NULL;")
    count += 1

print(f"-- {count} VINs decoded", file=sys.stderr)
