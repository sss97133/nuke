#!/usr/bin/env python3
"""Hand single-contract jobs in .github/workflows/frontend-tests.yml to the db-contracts job.

A single-contract job is exactly a postgres:17 service, a checkout, `createdb <db>` and
`psql -X -v ON_ERROR_STOP=1 -d <db> -f supabase/sql/test_<x>.sql`. The db-contracts job
(scripts/ci/run-db-contracts.sh) runs every supabase/sql/test_*.sql that no workflow job names, so deleting such a
job is the whole conversion: its file runs in db-contracts from then on.

  convert-contract-job.py <branch> [--main origin/main]
      In a checkout of an open pull request's branch, without merging main into it: delete the single-contract jobs
      the branch adds and undo its edits to ones main has converted, leaving the branch's other changes.
  convert-contract-job.py --all [--job-from <ref>]
      Delete every single-contract job in the checkout's workflow, and add the db-contracts job from <ref> if the
      file has none (rebuilding a branch's workflow on a newer main).

Edits only .github/workflows/frontend-tests.yml, then prints what it converted and whether the file merges into
--main. Run it from main when the branch predates it:
  git show origin/main:scripts/ci/convert-contract-job.py | python3 - <branch>
"""
import argparse, json, os, re, subprocess, sys, tempfile
import yaml

WORKFLOW = '.github/workflows/frontend-tests.yml'
SKIP_LIST = 'scripts/ci/db-contracts-skip.txt'
SERVICE_ENV = {'PGHOST': 'localhost', 'PGUSER': 'postgres', 'PGPASSWORD': 'postgres'}


def git(*args, check=True):
    r = subprocess.run(['git', *args], capture_output=True, text=True)
    if check and r.returncode:
        sys.exit(f'git {" ".join(args)}: {r.stderr.strip()}')
    return r.stdout if r.returncode == 0 else None


def contract_file(job):
    """The supabase/sql/test_*.sql a single-contract job runs, or None for any other job."""
    if not isinstance(job, dict) or set(job) != {'runs-on', 'services', 'env', 'steps'}:
        return None
    services, steps = job['services'] or {}, job['steps'] or []
    if job['runs-on'] != 'ubuntu-latest' or set(services) != {'postgres'} or job['env'] != SERVICE_ENV:
        return None
    if (services['postgres'] or {}).get('image') != 'postgres:17' or len(steps) != 3:
        return None
    checkout, create, run = steps
    if set(checkout) - {'name', 'uses'} or not re.fullmatch(r'actions/checkout@v\d+', str(checkout.get('uses'))):
        return None
    if set(create) - {'name', 'run'} or set(run) - {'name', 'run'}:
        return None
    made = re.fullmatch(r'createdb ([A-Za-z0-9_]+)', str(create.get('run', '')).strip())
    ran = re.fullmatch(r'psql -X -v ON_ERROR_STOP=1 -d ([A-Za-z0-9_]+) -f (supabase/sql/test_[A-Za-z0-9_]+\.sql)',
                       str(run.get('run', '')).strip())
    return ran.group(2) if made and ran and made.group(1) == ran.group(1) else None


def blocks(text):
    """Each job's lines as [first, last] indexes, its trailing blank lines included."""
    lines = text.split('\n')
    spans, cur = {}, None
    for i in range(lines.index('jobs:') + 1, len(lines)):
        m = re.match(r'^  ([A-Za-z0-9_-]+):\s*$', lines[i])
        if m:
            cur = m.group(1); spans[cur] = [i, i]
        elif cur and (lines[i].startswith('   ') or not lines[i].strip()):
            spans[cur][1] = i
        elif cur and lines[i] and not lines[i].startswith(' '):
            cur = None
    return lines, spans


def block_text(text, name):
    lines, spans = blocks(text)
    a, b = spans[name]
    return '\n'.join(lines[a:b + 1]).rstrip('\n')


def replace_jobs(text, delete=(), restore=None, insert=None):
    """Delete jobs, swap jobs' blocks for other text ({name: block}), and insert a block right after `jobs:`."""
    lines, spans = blocks(text)
    restore = restore or {}
    out, skip_to = [], -1
    for i, line in enumerate(lines):
        if i <= skip_to:
            continue
        if insert and line == 'jobs:':
            out += [line] + insert.split('\n') + ['']
            continue
        name = next((n for n, (a, _) in spans.items() if a == i), None)
        if name in delete or name in restore:
            skip_to = spans[name][1]
            if name in restore:
                out += restore[name].split('\n') + ['']
            continue
        out.append(line)
    while out and not out[-1].strip():
        out.pop()
    return '\n'.join(out) + '\n'


def guard_accepts(path, database, seen=None):
    """Whether every current_database() check in a contract (and the files it includes) accepts `database`."""
    seen = seen or set()
    if path in seen or not os.path.isfile(path):
        return True, ''
    seen.add(path)
    sql = open(path).read()
    # The contracts' guards read `IF current_database() NOT LIKE '<pattern>'`, `<> '<name>'` or
    # `NOT IN ('<name>', ...)` THEN RAISE.
    for op, literal in re.findall(r"current_database\(\)\s*(NOT\s+LIKE|<>|!=)\s*'([^']*)'", sql, re.I):
        if op.upper().startswith('NOT'):
            pattern = '^' + re.escape(literal).replace('%', '.*').replace('_', '.') + '$'
            if not re.match(pattern, database):
                return False, f"{path} requires current_database() LIKE '{literal}'"
        elif literal != database:
            return False, f"{path} requires the database '{literal}'"
    for names in re.findall(r"current_database\(\)\s*NOT\s+IN\s*\(([^)]*)\)", sql, re.I):
        if database not in re.findall(r"'([^']*)'", names):
            return False, f"{path} requires current_database() IN ({names.strip()})"
    for cmd, inc in re.findall(r'^\s*\\(include_relative|include|ir|i)\s+(\S+)', sql, re.M):
        relative = cmd in ('ir', 'include_relative')  # \ir is relative to the file, \i to the repo root
        ok, why = guard_accepts(os.path.normpath(os.path.join(os.path.dirname(path), inc) if relative else inc),
                                database, seen)
        if not ok:
            return ok, why
    return True, ''


def merge_conflicts(ours, base, theirs):
    with tempfile.TemporaryDirectory() as d:
        paths = []
        for label, text in (('main', ours), ('base', base), ('branch', theirs)):
            paths.append(os.path.join(d, label)); open(paths[-1], 'w').write(text)
        r = subprocess.run(['git', 'merge-file', '-p', '-q', *paths], capture_output=True, text=True)
        return r.returncode, r.stdout


def merge_report(main_ref, main_text, main_jobs, text):
    """Whether `text` merges into main_ref cleanly with every job intact, and a sentence saying so."""
    base = git('merge-base', 'HEAD', main_ref).strip()
    conflicts, merged = merge_conflicts(main_text, git('show', f'{base}:{WORKFLOW}'), text)
    if conflicts:
        return False, f'conflicts with {main_ref} in {conflicts} place(s), in changes other than single-contract jobs'
    merged_jobs = yaml.safe_load(merged)['jobs']
    bad = [n for n, j in merged_jobs.items() if not (j or {}).get('steps') or (contract_file(j) and n not in main_jobs)]
    if bad or 'db-contracts' not in merged_jobs:
        return False, f'merges into {main_ref}, but check the merged jobs {bad or "(no db-contracts)"}'
    return True, f'merges into {main_ref} cleanly ({len(merged_jobs)} jobs, db-contracts among them)'


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('branch', nargs='?', help='the checked-out pull request branch')
    ap.add_argument('--all', action='store_true', help='convert every single-contract job in the workflow')
    ap.add_argument('--main', default='origin/main', help='the branch the pull request merges into')
    ap.add_argument('--job-from', help='with --all: a ref whose workflow has the db-contracts job to add')
    args = ap.parse_args()
    if bool(args.branch) == args.all:
        ap.error('give a branch, or --all')
    os.chdir(git('rev-parse', '--show-toplevel').strip())
    text = open(WORKFLOW).read()
    if re.search(r'^(<<<<<<<|>>>>>>>|=======$)', text, re.M):
        sys.exit(f'{WORKFLOW} has conflict markers; this script edits a branch that has not merged main')
    if args.branch and git('rev-parse', args.branch).strip() != git('rev-parse', 'HEAD').strip():
        sys.exit(f'HEAD is not {args.branch}; check out the branch first')
    main_text = git('show', f'{args.main}:{WORKFLOW}')
    main_jobs = yaml.safe_load(main_text)['jobs']
    jobs = yaml.safe_load(text)['jobs']

    delete, restore, notes = [], {}, []
    if args.all:
        delete = [name for name, job in jobs.items() if contract_file(job)]
        insert = None
        if 'db-contracts' not in jobs:
            if not args.job_from:
                sys.exit('the workflow has no db-contracts job; give --job-from <ref> to take it from')
            insert = block_text(git('show', f'{args.job_from}:{WORKFLOW}'), 'db-contracts')
    else:
        if 'db-contracts' not in main_jobs:
            sys.exit(f'{args.main} has no db-contracts job yet; merge that first')
        base = git('merge-base', 'HEAD', args.main).strip()
        base_text = git('show', f'{base}:{WORKFLOW}')
        base_jobs = yaml.safe_load(base_text)['jobs']
        insert = None
        for name, job in jobs.items():
            if not contract_file(job) or name in main_jobs:
                continue
            if name not in base_jobs:
                delete.append(name)
            elif block_text(text, name) != block_text(base_text, name):
                restore[name] = block_text(base_text, name)  # main deleted it; the branch's edit would conflict
        notes += [f'kept: {n} (not a single-contract job)' for n, j in jobs.items()
                  if n not in base_jobs and not contract_file(j)]

    converted = [(name, contract_file(jobs[name])) for name in [*delete, *restore]]
    skipped = set(re.sub(r'#.*', '', git('show', f'{args.main}:{SKIP_LIST}', check=False) or '').split())
    refused = []
    for name, path in converted:
        stem = os.path.basename(path)[len('test_'):-len('.sql')]
        ok, why = guard_accepts(path, ('dm_refinement_' + stem)[:63])
        if not os.path.isfile(path):
            ok, why = False, f'{path} is not in this checkout'
        elif os.path.basename(path) in skipped:
            ok, why = False, f'{SKIP_LIST} lists {os.path.basename(path)}'
        if not ok:
            refused.append(name); notes.append(f'kept: {name}, because {why}')
    delete = [n for n in delete if n not in refused]
    restore = {n: t for n, t in restore.items() if n not in refused}
    converted = [(n, p) for n, p in converted if n not in refused]
    others = [open(os.path.join('.github/workflows', f)).read() for f in os.listdir('.github/workflows')
              if f.endswith('.yml') and f != os.path.basename(WORKFLOW)]
    named = set(re.findall(r'supabase/sql/test_[A-Za-z0-9_]+\.sql', '\n'.join([text, *others])))
    if not args.all:  # a contract the branch adds with no job at all runs in db-contracts too
        for path in git('diff', '--name-only', '--diff-filter=A', base, 'HEAD').split():
            if (re.fullmatch(r'supabase/sql/test_[A-Za-z0-9_]+\.sql', path) and path not in named
                    and os.path.basename(path) not in skipped):
                notes.append(f'runs in db-contracts too: {path}, which the branch adds and no job names '
                             f'(check it: scripts/ci/run-db-contracts.sh {os.path.basename(path)})')

    for note in notes:
        print(note)
    if not (delete or restore or insert):
        ok, report = merge_report(args.main, main_text, main_jobs, text)
        print(f'{WORKFLOW}: nothing to convert; {report}')
        sys.exit(0 if ok else 1)
    new_text = replace_jobs(text, delete, restore, insert)
    new_jobs = yaml.safe_load(new_text)['jobs']
    expected = set(jobs) - set(delete) | ({'db-contracts'} if insert else set())
    problems = [f'job {n} has no steps' for n, j in new_jobs.items() if not (j or {}).get('steps')]
    problems += [f'job set off by {sorted(expected ^ set(new_jobs))}'] if set(new_jobs) != expected else []
    problems += [f'job {n} changed' for n in new_jobs if n in jobs and n not in restore and
                 json.dumps(new_jobs[n], sort_keys=True) != json.dumps(jobs[n], sort_keys=True)]
    head = lambda t: {k: v for k, v in yaml.safe_load(t).items() if k != 'jobs'}
    problems += ['the header (everything above jobs:) changed'] if head(new_text) != head(text) else []
    if problems:
        sys.exit('refusing to write: ' + '; '.join(problems))
    named = set(re.findall(r'supabase/sql/test_[A-Za-z0-9_]+\.sql', '\n'.join([new_text, *others])))
    for name, path in converted:
        where = 'a workflow job still names it, so db-contracts skips it' if path in named else 'runs in db-contracts'
        print(f'converted: {name} -> {path} ({where})')
    open(WORKFLOW, 'w').write(new_text)
    ok, report = merge_report(args.main, main_text, main_jobs, new_text)
    print(f'{WORKFLOW}: {len(jobs)} -> {len(new_jobs)} jobs, every job has steps; {report}')
    print(f'next: git add {WORKFLOW} && git commit -m "ci(frontend-tests): hand contract jobs to db-contracts"')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
