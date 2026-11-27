#!/usr/bin/env python3
"""Private, recoverable worktree snapshots. Never publishes source or completes a product requirement."""
import argparse
import base64
import getpass
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import plistlib
import re
import shutil
import stat
import subprocess
import tarfile
import tempfile
import time


def run(args, cwd=None, env=None, data=None):
    result = subprocess.run(args, cwd=cwd, env=env, input=data, capture_output=True, timeout=180)
    if result.returncode:
        raise ValueError(result.stderr.decode(errors='replace')[:1500] or 'Command failed')
    return result.stdout


def git(repo, *args, env=None, data=None):
    settings = dict(os.environ, GIT_OPTIONAL_LOCKS='0')
    if env:
        settings.update(env)
    return run(['git', '-C', str(repo), *args], env=settings, data=data)


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def write_json(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=True) + '\n')
    temporary.chmod(0o600)
    temporary.replace(path)


def read_json(path):
    return json.loads(Path(path).read_text())


def relative(value):
    p = PurePosixPath(value)
    if p.is_absolute() or not p.parts or '..' in p.parts or '.git' in p.parts:
        raise ValueError('Unsafe archive path')
    return p


def local_path(root, rel):
    parts = relative(rel).parts
    for i in range(1, len(parts)):
        if (root.joinpath(*parts[:i])).is_symlink():
            raise ValueError('Refuse to follow a symlink parent: ' + rel)
    return root.joinpath(*parts)


def file_record(root, rel):
    p = local_path(root, rel)
    if p.is_symlink():
        return {'path': rel, 'kind': 'link', 'target': os.readlink(p)}
    if not p.exists():
        return {'path': rel, 'kind': 'missing'}
    s = p.stat()
    if stat.S_ISREG(s.st_mode):
        return {'path': rel, 'kind': 'file', 'bytes': s.st_size, 'sha256': sha(p),
                'mode': stat.S_IMODE(s.st_mode)}
    if stat.S_ISDIR(s.st_mode):
        return {'path': rel, 'kind': 'directory', 'mode': stat.S_IMODE(s.st_mode)}
    raise ValueError('Special file needs separate preservation: ' + rel)


def changes(workspace):
    raw = git(workspace, 'status', '--porcelain=v1', '-z', '--untracked-files=all')
    entries, paths, i = raw.split(b'\0'), set(), 0
    while i < len(entries):
        item = entries[i]
        i += 1
        if not item:
            continue
        paths.add(os.fsdecode(item[3:]))
        if b'R' in item[:2] or b'C' in item[:2]:
            paths.add(os.fsdecode(entries[i]))
            i += 1
    return raw, sorted(paths)


def generated(rel):
    parts = PurePosixPath(rel).parts
    return ('node_modules' in parts or '__pycache__' in parts or
            rel.rstrip('/') in {'nuke_frontend/.tsbuild', 'nuke_frontend/dist', 'dist'})


def ignored_records(workspace):
    names = git(workspace, 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z')
    paths = set()
    for value in names.split(b'\0'):
        if not value:
            continue
        rel = os.fsdecode(value).rstrip('/')
        p = local_path(workspace, rel)
        if not p.is_symlink() and generated(rel):
            continue
        paths.add(rel)
        if p.is_dir() and not p.is_symlink():
            for base, dirs, files in os.walk(p, followlinks=False):
                for name in list(dirs):
                    child = Path(base) / name
                    sub = str(child.relative_to(workspace))
                    if child.is_symlink():
                        paths.add(sub)
                        dirs.remove(name)
                    elif generated(sub):
                        dirs.remove(name)
                    else:
                        paths.add(sub)
                paths.update(str((Path(base) / name).relative_to(workspace)) for name in files)
    return [file_record(workspace, rel) for rel in sorted(paths, key=lambda x: (x.count('/'), x))]


def common_dir(repo):
    return Path(os.fsdecode(git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir')).strip()).resolve()


def registered(repo):
    rows = []
    for block in git(repo, 'worktree', 'list', '--porcelain', '-z').split(b'\0\0'):
        fields = {}
        for field in block.split(b'\0'):
            if field:
                key, _, value = os.fsdecode(field).partition(' ')
                fields[key] = value
        if fields:
            rows.append(fields)
    return rows


def private_env(workspace, directory, index_name):
    objects = directory / 'objects'
    objects.mkdir(exist_ok=True)
    return {'GIT_OBJECT_DIRECTORY': str(objects),
            'GIT_ALTERNATE_OBJECT_DIRECTORIES': str(common_dir(workspace) / 'objects'),
            'GIT_INDEX_FILE': str(directory / index_name),
            'GIT_AUTHOR_NAME': 'Workspace Recovery', 'GIT_AUTHOR_EMAIL': 'recovery@localhost',
            'GIT_COMMITTER_NAME': 'Workspace Recovery', 'GIT_COMMITTER_EMAIL': 'recovery@localhost'}


def index_tree(workspace, directory, name='staged.index'):
    if git(workspace, 'ls-files', '--unmerged', '-z'):
        raise ValueError('Unmerged index needs an explicit conflict-preservation path; leave checkout intact')
    source = Path(os.fsdecode(git(workspace, 'rev-parse', '--path-format=absolute', '--git-path', 'index')).strip())
    env = private_env(workspace, directory, name)
    shutil.copy2(source, env['GIT_INDEX_FILE'])
    return git(workspace, 'write-tree', env=env).decode().strip(), env


def index_flags(workspace):
    result = {'assume_unchanged': [], 'skip_worktree': []}
    for item in git(workspace, 'ls-files', '-v', '-z').split(b'\0'):
        if not item:
            continue
        path = os.fsdecode(item[2:])
        if item[:1].islower():
            result['assume_unchanged'].append(path)
        if item[:1].upper() == b'S':
            result['skip_worktree'].append(path)
    return result


def reject_special_git_state(workspace):
    staged = git(workspace, 'ls-files', '--stage', '-z')
    if any(x.startswith(b'160000 ') for x in staged.split(b'\0')):
        raise ValueError('Submodule payload needs separate preservation; leave checkout intact')
    names = git(workspace, 'ls-files', '-z')
    attrs = git(workspace, 'check-attr', '--stdin', '-z', 'filter', data=names).split(b'\0')
    if any(attrs[i] not in (b'unspecified', b'unset') for i in range(2, len(attrs), 3)):
        raise ValueError('Git filter payload needs separate preservation; leave checkout intact')


def snapshot(repo, workspace, record):
    if Path(workspace).is_symlink():
        raise ValueError('Snapshot the real checkout, not an alias')
    repo, workspace, record = Path(repo).resolve(), Path(workspace).resolve(), Path(record).resolve()
    if record.is_relative_to(workspace) or record.is_relative_to(repo) or record.exists():
        raise ValueError('Snapshot must be a new path outside the source workspace')
    if common_dir(repo) != common_dir(workspace):
        raise ValueError('Workspace belongs to another repository')
    repo = Path(registered(repo)[0]['worktree']).resolve()
    reject_special_git_state(workspace)
    head = git(workspace, 'rev-parse', 'HEAD').decode().strip()
    branch = git(workspace, 'symbolic-ref', '-q', 'HEAD').decode().strip() if git(workspace, 'rev-parse', '--abbrev-ref', 'HEAD').strip() != b'HEAD' else None
    base = git(repo, 'rev-parse', 'origin/main').decode().strip()
    status_before, changed = changes(workspace)
    flags = index_flags(workspace)
    changed = sorted(set(changed).union(*flags.values()))
    files = [file_record(workspace, rel) for rel in changed]
    if any(x['kind'] == 'directory' for x in files):
        raise ValueError('Embedded repository or directory change needs separate preservation')
    primary = workspace == repo
    # The primary checkout is never removable. Its potentially large local data
    # remains in place; only code/staging state is checkpointed here.
    locals_before = [] if primary else ignored_records(workspace)
    record.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.TemporaryDirectory(prefix='.snapshot-', dir=record.parent) as temp:
        staging = Path(temp)
        exclude_path = Path(os.fsdecode(git(workspace, 'rev-parse', '--path-format=absolute', '--git-path', 'info/exclude')).strip())
        exclude_bytes = exclude_path.read_bytes() if exclude_path.exists() else b''
        (staging / 'git-info-exclude').write_bytes(exclude_bytes)
        staged_tree, staged_env = index_tree(workspace, staging)
        working_env = private_env(workspace, staging, 'working.index')
        git(workspace, 'read-tree', staged_tree, env=working_env)
        updates = []
        for item in files:
            rel = item['path']
            if item['kind'] == 'missing':
                updates.append(b'0 ' + b'0' * 40 + b'\t' + os.fsencode(rel) + b'\0')
                continue
            p = local_path(workspace, rel)
            body = os.fsencode(item['target']) if item['kind'] == 'link' else p.read_bytes()
            oid = git(workspace, 'hash-object', '-w', '--stdin', env=working_env, data=body).strip()
            mode = b'120000' if item['kind'] == 'link' else (b'100755' if item['mode'] & 0o111 else b'100644')
            updates.append(mode + b' ' + oid + b'\t' + os.fsencode(rel) + b'\0')
        if updates:
            git(workspace, 'update-index', '-z', '--index-info', env=working_env, data=b''.join(updates))
        tree = git(workspace, 'write-tree', env=working_env).decode().strip()
        commits = {}
        for name, value in [('working', tree), ('index', staged_tree)]:
            message = f'Private recovery snapshot ({name}); unreviewed and not published\nSource: {workspace}\nOriginal HEAD: {head}\n'
            commits[name] = git(workspace, 'commit-tree', value, '-p', head, env=working_env, data=message.encode()).decode().strip()
        bare = staging / 'private.git'
        run(['git', 'init', '--bare', '--quiet', str(bare)])
        for name, commit in commits.items():
            git(bare, 'update-ref', 'refs/heads/' + name, commit, env=working_env)
        bundle = staging / 'source.bundle'
        git(bare, 'bundle', 'create', str(bundle), 'refs/heads/working', 'refs/heads/index', '^' + base, env=working_env)
        with tarfile.open(staging / 'local.tar.gz', 'w:gz', dereference=False) as tar:
            for item in locals_before:
                tar.add(local_path(workspace, item['path']), arcname=item['path'], recursive=False)
        end_tree, _ = index_tree(workspace, staging, 'final.index')
        if (head != git(workspace, 'rev-parse', 'HEAD').decode().strip() or
                status_before != changes(workspace)[0] or end_tree != staged_tree or
                files != [file_record(workspace, rel) for rel in changed] or
                flags != index_flags(workspace) or
                locals_before != ([] if primary else ignored_records(workspace)) or
                exclude_bytes != (exclude_path.read_bytes() if exclude_path.exists() else b'')):
            raise ValueError('Source changed during snapshot; leave checkout intact')
        metadata = {'schema_version': 1, 'created_at': time.time(), 'repo': str(repo), 'workspace': str(workspace),
                    'head': head, 'branch': branch, 'base': base, 'working_commit': commits['working'],
                    'index_commit': commits['index'], 'status_b64': base64.b64encode(status_before).decode(),
                    'index_flags': flags,
                    'working_files': files, 'local_files': locals_before,
                    'local_data_policy': 'retained_in_primary_checkout' if primary else 'archived_non_cache_files',
                    'bundle_sha256': sha(bundle), 'local_sha256': sha(staging / 'local.tar.gz'),
                    'git_exclude_sha256': sha(staging / 'git-info-exclude'),
                    'publication': 'private recovery only; no feature acceptance or remote push', 'verified': False}
        output = staging / 'output'
        output.mkdir(mode=0o700)
        for name in ['source.bundle', 'local.tar.gz', 'git-info-exclude']:
            shutil.move(str(staging / name), output / name)
            (output / name).chmod(0o600)
        write_json(output / 'record.json', metadata)
        output.rename(record)
    return metadata


def validate_archives(record):
    record = Path(record)
    data = read_json(record / 'record.json')
    if sha(record / 'source.bundle') != data['bundle_sha256'] or sha(record / 'local.tar.gz') != data['local_sha256']:
        raise ValueError('Archive checksum mismatch')
    if sha(record / 'git-info-exclude') != data['git_exclude_sha256']:
        raise ValueError('Saved Git ignore checksum mismatch')
    return data


def restore(repo, record, target):
    repo, record, target = Path(repo).resolve(), Path(record).resolve(), Path(target).absolute()
    data = validate_archives(record)
    if target.exists() or target.is_symlink():
        raise ValueError('Restore destination exists; leave it untouched')
    git(repo, 'bundle', 'verify', str(record / 'source.bundle'))
    prefix = 'refs/recovery/' + hashlib.sha256(str(record).encode()).hexdigest()[:16]
    git(repo, 'fetch', '--no-tags', str(record / 'source.bundle'),
        f'refs/heads/working:{prefix}/working', f'refs/heads/index:{prefix}/index')
    git(repo, '-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--detach', str(target), data['head'])
    git(target, 'read-tree', '--reset', '-u', data['working_commit'])
    git(target, 'read-tree', data['index_commit'])
    for item in data['working_files']:
        if item['kind'] == 'file':
            p = local_path(target, item['path'])
            p.write_bytes(git(repo, 'cat-file', 'blob', data['working_commit'] + ':' + item['path']))
            p.chmod(item['mode'])
    directories = []
    with tarfile.open(record / 'local.tar.gz', 'r:gz') as tar:
        for member in tar:
            p = local_path(target, member.name)
            if member.isdir():
                p.mkdir(parents=True, exist_ok=True)
                directories.append((p, member.mode))
            elif member.issym():
                p.parent.mkdir(parents=True, exist_ok=True)
                p.symlink_to(member.linkname)
            elif member.islnk():
                source = local_path(target, member.linkname)
                if not source.is_file() or source.is_symlink():
                    raise ValueError('Invalid archive hard link')
                p.parent.mkdir(parents=True, exist_ok=True)
                os.link(source, p)
            elif member.isfile():
                p.parent.mkdir(parents=True, exist_ok=True)
                with tar.extractfile(member) as stream:
                    p.write_bytes(stream.read())
                p.chmod(member.mode)
            else:
                raise ValueError('Unsafe archive member')
    for p, mode in reversed(directories):
        p.chmod(mode)
    for key, option in [('assume_unchanged', '--assume-unchanged'), ('skip_worktree', '--skip-worktree')]:
        names = data['index_flags'][key]
        if names:
            git(target, 'update-index', option, '-z', '--stdin', data=b''.join(os.fsencode(x) + b'\0' for x in names))
    actual_status = changes(target)[0]
    if git(target, 'rev-parse', 'HEAD').decode().strip() != data['head'] or actual_status != base64.b64decode(data['status_b64']):
        write_json(record / 'restore-status-diagnostic.json', {
            'expected_status_b64': data['status_b64'], 'actual_status_b64': base64.b64encode(actual_status).decode(),
            'target': str(target), 'saved_ignore_policy': str(record / 'git-info-exclude')})
        raise ValueError('Restored Git view differs; inspect saved ignore policy and restore-status-diagnostic.json')
    for item in data['working_files'] + data['local_files']:
        if file_record(target, item['path']) != item:
            raise ValueError('Restored content differs: ' + item['path'])
    if index_flags(target) != data['index_flags']:
        raise ValueError('Restored index flags differ')
    return data


def verify(record):
    record = Path(record).resolve()
    data = validate_archives(record)
    with tempfile.TemporaryDirectory(prefix='.restore-proof-', dir=record.parent) as temp:
        parent = Path(temp) / 'repo'
        run(['git', 'init', '--quiet', str(parent)])
        (parent / '.git/objects/info/alternates').write_text(str(common_dir(data['repo']) / 'objects') + '\n')
        # Repository-local exclusions are not part of Git commits. Reproduce them
        # only in the private proof repository; never overwrite the live repo policy.
        shutil.copy2(record / 'git-info-exclude', parent / '.git/info/exclude')
        git(parent, 'update-ref', 'refs/heads/base', data['base'])
        git(parent, 'symbolic-ref', 'HEAD', 'refs/heads/base')
        target = Path(temp) / 'restored'
        restore(parent, record, target)
    data.update(verified=True, verified_at=time.time())
    write_json(record / 'record.json', data)
    return data


def references(workspace, protected):
    workspace = str(Path(workspace).resolve())
    if workspace in {str(Path(p).resolve()) for p in protected}:
        return ['explicitly protected task']
    found = []
    result = subprocess.run(['lsof', '-nP', '-u', getpass.getuser(), '-F', 'n'], capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise ValueError('Cannot verify process references')
    if any(line == 'n' + workspace or line.startswith('n' + workspace + '/') for line in result.stdout.splitlines()):
        found.append('open file or current directory')
    commands = run(['ps', '-axo', 'command=']).decode(errors='replace')
    if workspace in commands:
        found.append('running command')
    for p in (Path.home() / 'Library/LaunchAgents').glob('*.plist'):
        try:
            body = json.dumps(plistlib.loads(p.read_bytes()), default=str)
        except Exception:
            body = p.read_text(errors='replace')
        if workspace in body:
            found.append('scheduled agent: ' + p.name)
    cron = subprocess.run(['crontab', '-l'], capture_output=True, text=True, timeout=15)
    if cron.returncode == 0 and workspace in cron.stdout:
        found.append('user crontab')
    for p in (Path.home() / '.codex/automations').glob('*/automation.toml'):
        if workspace in p.read_text():
            found.append('Codex automation: ' + p.parent.name)
    return found


def unchanged(data, record, workspace):
    repo = Path(data['repo'])
    if common_dir(repo) != common_dir(workspace):
        raise ValueError('Repository identity changed')
    with tempfile.TemporaryDirectory(prefix='.source-proof-', dir=record.parent) as temp:
        tree, _ = index_tree(workspace, Path(temp))
        expected = git(repo, 'rev-parse', data['head']).decode().strip()
        if (git(workspace, 'rev-parse', 'HEAD').decode().strip() != expected or
                changes(workspace)[0] != base64.b64decode(data['status_b64']) or
                index_flags(workspace) != data['index_flags'] or
                any(file_record(workspace, item['path']) != item for item in data['working_files']) or
                ignored_records(workspace) != data['local_files']):
            raise ValueError('Source changed after snapshot; keep checkout')
        # The saved index commit may live only in the bundle; compare its tree in a private proof repo.
        proof = Path(temp) / 'repo'
        run(['git', 'init', '--bare', '--quiet', str(proof)])
        (proof / 'objects/info/alternates').write_text(str(common_dir(repo) / 'objects') + '\n')
        git(proof, 'fetch', '--quiet', str(record / 'source.bundle'), 'refs/heads/index:refs/heads/index')
        if tree != git(proof, 'rev-parse', 'refs/heads/index^{tree}').decode().strip():
            raise ValueError('Staging state changed after snapshot; keep checkout')


def retire(record, protected):
    record = Path(record).resolve()
    data = validate_archives(record)
    repo, workspace = Path(data['repo']), Path(data['workspace'])
    registry = registered(repo)
    member = next((r for r in registry if Path(r['worktree']).resolve() == workspace), None)
    if (workspace == Path(registry[0]['worktree']).resolve() or workspace.is_symlink() or
            not member or 'locked' in member or 'prunable' in member):
        raise ValueError('Only registered unlocked linked checkouts can be retired; never the primary checkout')
    if not data.get('verified'):
        raise ValueError('A successful restore verification is required')
    quarantine = record / '.retiring'
    if quarantine.exists():
        if workspace.exists():
            raise ValueError('Both original and pending paths exist; inspect without overwriting either')
        git(repo, 'worktree', 'move', str(quarantine), str(workspace))
        data.pop('retirement_pending', None)
        write_json(record / 'record.json', data)
    if workspace.stat().st_dev != record.stat().st_dev:
        raise ValueError('Retirement requires an atomic move on the same filesystem')
    refs = references(workspace, protected)
    if refs:
        raise ValueError('Referenced checkout: ' + ', '.join(refs))
    unchanged(data, record, workspace)
    # Moving first prevents a new writer at the old path from losing edits to a
    # forced removal. Check the moved state and open handles again before unlinking.
    data['retirement_pending'] = {'original': str(workspace), 'preserved_path': str(quarantine)}
    write_json(record / 'record.json', data)
    git(repo, 'worktree', 'move', str(workspace), str(quarantine))
    try:
        unchanged(data, record, quarantine)
        refs = references(quarantine, [])
        if refs:
            raise ValueError('Moved checkout acquired a reference: ' + ', '.join(refs))
        unchanged(data, record, quarantine)
        git(repo, 'worktree', 'remove', '--force', str(quarantine))
    except BaseException:
        if quarantine.exists() and not workspace.exists():
            git(repo, 'worktree', 'move', str(quarantine), str(workspace))
            data.pop('retirement_pending', None)
            write_json(record / 'record.json', data)
        raise
    if quarantine.exists():
        raise ValueError('Checkout removal did not complete')
    data.pop('retirement_pending', None)
    data.update(retired=True, retired_at=time.time())
    write_json(record / 'record.json', data)
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('snapshot')
    p.add_argument('--repo', type=Path, required=True)
    p.add_argument('--workspace', type=Path, required=True)
    p.add_argument('--record', type=Path, required=True)
    for command in ['verify', 'retire']:
        p = sub.add_parser(command)
        p.add_argument('--record', type=Path, required=True)
        if command == 'retire':
            p.add_argument('--protected', type=Path, required=True)
    p = sub.add_parser('restore')
    p.add_argument('--repo', type=Path, required=True)
    p.add_argument('--record', type=Path, required=True)
    p.add_argument('--to', type=Path, required=True)
    args = parser.parse_args()
    if args.command == 'snapshot':
        value = snapshot(args.repo, args.workspace, args.record)
    elif args.command == 'verify':
        value = verify(args.record)
    elif args.command == 'retire':
        value = retire(args.record, read_json(args.protected)['paths'])
    else:
        value = restore(args.repo, args.record, args.to)
    print(json.dumps({key: value.get(key) for key in ['workspace', 'head', 'working_commit', 'verified', 'retired']}))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError, KeyError) as error:
        raise SystemExit('closeout: ' + str(error))
