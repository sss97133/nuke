"""PG17 concurrent projection attacks; synthetic database created and dropped locally.
Start a disposable PG17 server first, then python3 this file --port 56843.
Uses only local Unix sockets; never reads application credentials or production data.
"""
import argparse
import pathlib
import subprocess
import time
import uuid

args = argparse.ArgumentParser()
args.add_argument('--port', type=int, default=56843)
port = args.parse_args().port
psql = '/opt/homebrew/opt/postgresql@17/bin/psql'
fixture_path = pathlib.Path(__file__).resolve().with_name('test_atomic_image_witnesses.sql')
database = 'dm_image_witness_fixture_' + uuid.uuid4().hex
base = [psql, '-X', '-h', '/private/tmp', '-p', str(port), '-v', 'ON_ERROR_STOP=1', '-qAt']

def query(sql, db=database):
    return subprocess.run(base + ['-d', db, '-c', sql], check=True, capture_output=True, text=True).stdout.strip()

def owner(sql):
    proc = subprocess.Popen(base + ['-d', database], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True)
    proc.stdin.write('BEGIN;\n' + sql + "\nSELECT 'ready';\n")
    proc.stdin.flush()
    output = []
    while True:
        line = proc.stdout.readline().strip()
        if line == 'ready':
            return proc, output
        if not line:
            raise RuntimeError('Owner session failed: ' + proc.stderr.read())
        output.append(line)

def release(proc):
    proc.stdin.write('COMMIT;\n\\q\n')
    proc.stdin.flush()
    proc.stdin.close()
    proc.wait(timeout=10)
    assert proc.returncode == 0, proc.stderr.read()

def waiter(sql):
    return subprocess.Popen(base + ['-d', database, '-c', "SET application_name='witness_fixture_waiter'; " + sql],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

def assert_waiting(proc):
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        if query("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='witness_fixture_waiter' AND wait_event_type='Lock'") == '1':
            return
        if proc.poll() is not None:
            raise AssertionError('Concurrent transaction bypassed image lock: ' + str(proc.communicate()))
        time.sleep(.03)
    raise AssertionError('Expected concurrent transaction waiting on image row lock')

assert query('SHOW server_version_num', 'postgres').startswith('17'), 'Use disposable PG17'
query('CREATE DATABASE ' + database, 'postgres')
processes = []
try:
    fixture = fixture_path.read_text()
    # Reuse exact live-shaped synthetic schema and production migration. Commit
    # only inside this newly created local test database so two sessions can see it.
    setup = fixture.split('DO $$ DECLARE p jsonb; BEGIN', 1)[0]
    arrival = fixture.split('CREATE FUNCTION public.fixture_arrival', 1)[1].split('DO $$ DECLARE o uuid; w', 1)[0]
    setup += 'COMMIT;\nCREATE FUNCTION public.fixture_arrival' + arrival
    subprocess.run(base + ['-d', database], input=setup, text=True, check=True,
                   cwd=fixture_path.parent, capture_output=True)
    image = '44444444-4444-4444-4444-000000000001'
    vehicle = '11111111-1111-1111-1111-111111111111'
    other_vehicle = '22222222-2222-2222-2222-222222222222'
    holder, output = owner("SELECT public.fixture_arrival('{\"color\":\"locked\",\"image_id\":\"" + image + "\"}');")
    processes.append(holder)
    observation = output[0]
    blocked = waiter("UPDATE public.vehicle_images SET vehicle_id='" + other_vehicle + "' WHERE id='" + image + "';")
    processes.append(blocked)
    assert_waiting(blocked)
    release(holder)
    blocked.communicate(timeout=10)
    assert blocked.returncode == 0
    assert query("SELECT count(*) FROM public.observation_witnesses WHERE observation_id='" + observation + "'") == '1'
    assert query("SELECT count(*) FROM jsonb_array_elements(public.get_field_provenance('" + vehicle + "','color')->'image_observations') e WHERE e->>'observation_id'='" + observation + "'") == '0', 'Reassignment hides durable witness at read time'
    query("UPDATE public.vehicle_images SET vehicle_id='" + vehicle + "' WHERE id='" + image + "'")
    holder, _ = owner("UPDATE public.vehicle_images SET vehicle_id='" + other_vehicle + "' WHERE id='" + image + "';")
    processes.append(holder)
    blocked = waiter("SELECT public.fixture_arrival('{\"color\":\"mismatch-race\",\"image_id\":\"" + image + "\"}');")
    processes.append(blocked)
    assert_waiting(blocked)
    release(holder)
    _, error = blocked.communicate(timeout=10)
    assert blocked.returncode != 0 and 'observation_image_vehicle_mismatch' in error, error
    assert query("SELECT count(*) FROM public.vehicle_observations WHERE structured_data->>'color'='mismatch-race'") == '0'
    assert query("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'") == '0'
    print('PASS: projection holds image against reassignment through commit; reader hides later reassignment; opposing committed reassignment rejects arrival atomically')
finally:
    for proc in processes:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=10)
    query('DROP DATABASE ' + database + ' WITH (FORCE)', 'postgres')
