#!/usr/bin/env python3
"""Recovery selects exactly one tracked file despite later historical filenames."""
from pathlib import Path
import subprocess
import tempfile

selector = Path(__file__).resolve().parent / 'ci/select-dispatch-migration.sh'
with tempfile.TemporaryDirectory(prefix='nuke-migration-recovery-') as directory:
    root = Path(directory)
    subprocess.run(['git', 'init', '-q', directory], check=True)
    migrations = root / 'supabase/migrations'
    migrations.mkdir(parents=True)
    target = '20261008001520_requested_recovery.sql'
    later = '20261008003000_already_deployed.sql'
    untracked = '20261008004000_unreviewed.sql'
    for name in [target, later, untracked]:
        (migrations / name).write_text('-- disposable fixture\n')
    subprocess.run(['git', '-C', directory, 'add', f'supabase/migrations/{target}',
                    f'supabase/migrations/{later}'], check=True)
    result = subprocess.run(['bash', str(selector), target, directory], capture_output=True, text=True)
    assert result.returncode == 0 and result.stdout == f'supabase/migrations/{target}\n', result
    for invalid in ['', untracked, '20261008005000_missing.sql', '../outside.sql',
                    '/tmp/outside.sql', target + ',' + later, target + '\n' + later,
                    target + ';echo bad', '20261008001520_requested_recovery.SQL']:
        result = subprocess.run(['bash', str(selector), invalid, directory], capture_output=True, text=True)
        assert result.returncode != 0 and not result.stdout, (invalid, result)
print('PASS exact tracked migration, later-file exclusion, untracked/missing/path/list/injection refusals')
