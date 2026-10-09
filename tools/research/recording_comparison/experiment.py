#!/usr/bin/env python3
"""Snapshot and submit recording-level research; never modify app/model assets."""
from __future__ import annotations

import argparse
import ast
import csv
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import shlex
import shutil
import statistics
import subprocess
import sys
import traceback

BASE = Path('/orange/xiangyan/rithika/cdd')
ARMS = ['raw', 'legacy_kalman', 'bandpass_causal', 'bandpass_offline']
SEEDS = [125, 126, 127]
LABEL_CONTRACT = 'provided_recording_labels_sbp_dbp_semantics_uncertified_v1'
IDENTITY_CONTRACT = 'named_train_val_lists_disjoint_global_numeric_ids_v1'
CONFIG = {'worker_minutes': 45, 'threads': 4, 'lightgbm_version': '4.6.0',
          'sampling_rate_hz': 125, 'samples_per_recording': 3750,
          'gpu_array_concurrency': 2, 'cpu_array_concurrency': 2}
SCOPE = ('Fresh 30-second recordings from named train/validation subjects. No test split, existing beat cache, '
         'personal calibration, export, or phone update. Provided recording-label semantics remain uncertified. '
         'Results are not directly comparable to the earlier beat-level experiment.')


def require(ok, message):
    if not ok:
        raise ValueError(message)


def sha256(path):
    path = Path(path)
    before = path.stat()
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1048576), b''):
            h.update(block)
    after = path.stat()
    require((before.st_size, before.st_mtime_ns) == (after.st_size, after.st_mtime_ns),
            'File changed while hashing: ' + str(path))
    return h.hexdigest()


def write_json(path, value):
    path = Path(path)
    temp = path.with_suffix(path.suffix + '.partial')
    temp.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')
    temp.replace(path)


def declared_tasks(include_anyppg=True):
    tasks = [{'model': model, 'arm': arm, 'seed': seed}
             for model in ('cnn', 'lightgbm') for seed in SEEDS for arm in ARMS]
    if include_anyppg:
        tasks.append({'model': 'anyppg', 'arm': 'raw', 'seed': None,
                      'exploratory': True, 'pretraining_patient_overlap': 'unresolved'})
    return tasks


def package_files(here):
    here = Path(here)
    required = {'experiment.py', 'prepare.py', 'features.py', 'train.py', 'anyppg_probe.py', 'README.md'}
    files = {}
    for path in sorted(here.rglob('*')):
        if '__pycache__' in path.parts or not path.is_file() or path.suffix not in ('.py', '.md'):
            continue
        require(not path.is_symlink(), 'Linked source is not accepted: ' + str(path))
        if path.suffix == '.py':
            ast.parse(path.read_text(), filename=str(path))
        files[path.relative_to(here).as_posix()] = sha256(path)
    require(required <= files.keys(), 'Missing package source: ' + str(sorted(required - files.keys())))
    require(any(name.startswith('tests/') for name in files), 'Package tests are missing.')
    return files


def verify_runtime(folder):
    folder = Path(folder).resolve()
    manifest = json.loads((folder / 'experiment.json').read_text())
    require(manifest.get('schema_version') == 1 and manifest.get('config') == CONFIG,
            'Changed experiment schema or recipe.')
    require(manifest.get('tasks') == declared_tasks(manifest.get('include_anyppg') is True),
            'Changed predeclared tasks.')
    require(manifest.get('label_contract') == LABEL_CONTRACT and manifest.get('identity_contract') == IDENTITY_CONTRACT,
            'Changed label or identity contract.')
    for name, expected in manifest['package_sha256'].items():
        p = folder / 'runtime' / name
        require(p.resolve().is_relative_to(folder / 'runtime') and not p.is_symlink(), 'Unsafe runtime source path.')
        require(sha256(p) == expected, 'Runtime source changed: ' + name)
    return manifest


def verified_preparation(folder, manifest):
    folder = Path(folder)
    complete = json.loads((folder / 'prepared_complete.json').read_text())
    require(complete.get('complete') is True and complete.get('experiment_sha256') == sha256(folder / 'experiment.json'),
            'Preparation belongs to a different experiment.')
    digest = sha256(folder / 'data/manifest.json')
    require(digest == complete.get('preparation_manifest_sha256'), 'Preparation manifest changed.')
    data = json.loads((folder / 'data/manifest.json').read_text())
    require(data.get('complete') is True and data.get('schema_version') == 1, 'Incomplete preparation.')
    require(data.get('label_contract') == LABEL_CONTRACT and data.get('identity_contract') == IDENTITY_CONTRACT,
            'Wrong preparation label/identity contract.')
    require(data.get('arms') == ARMS, 'Unexpected preparation filter arms.')
    return data, digest


def batch_text(folder, mode):
    command = ["python", "-u", str(Path(folder) / 'runtime/experiment.py'), mode, '--experiment-dir', str(folder)]
    return '\n'.join(['#!/bin/bash', 'set -euo pipefail', 'module purge', 'module load pytorch/2.8.0',
                      'export OMP_NUM_THREADS=4', 'export MKL_NUM_THREADS=4',
                      'export OPENBLAS_NUM_THREADS=4', 'export CUBLAS_WORKSPACE_CONFIG=:4096:8',
                      shlex.join(command), ''])


def batch_options(folder, phase, dependencies=None, include_anyppg=True):
    folder = Path(folder)
    common = ['--nodes=1', '--ntasks=1', '--cpus-per-task=4', '--chdir=' + str(folder),
              '--job-name=cbp_record_' + phase,
              '--output=' + str(folder / ('logs/' + phase + '_%A_%a.log')),
              '--error=' + str(folder / ('logs/' + phase + '_%A_%a.err'))]
    cpu = ['--partition=hpg-default', '--constraint=el9']
    if phase == 'prepare':
        return common + cpu + ['--mem=64G', '--time=02:00:00']
    if phase == 'gpu':
        return common + ['--partition=hpg-b200', '--mem=64G', '--gres=gpu:1', '--time=01:00:00',
                         '--array=0-' + str(12 if include_anyppg else 11) + '%2',
                         '--dependency=afterok:' + dependencies['prepare'], '--kill-on-invalid-dep=yes']
    if phase == 'cpu':
        return common + cpu + ['--mem=16G', '--time=01:00:00', '--array=0-11%2',
                              '--dependency=afterok:' + dependencies['prepare'], '--kill-on-invalid-dep=yes']
    return common + cpu + ['--mem=4G', '--time=00:10:00',
                          '--dependency=afterany:' + ':'.join(dependencies[p] for p in ('prepare', 'gpu', 'cpu')),
                          '--kill-on-invalid-dep=yes']


def sbatch(folder, phase, args, body):
    result = subprocess.run(['sbatch', '--parsable', *args], input=body, text=True, capture_output=True)
    write_json(Path(folder) / ('submission_' + phase + '.json'),
               {'command': ['sbatch', '--parsable', *args], 'returncode': result.returncode,
                'stdout': result.stdout, 'stderr': result.stderr})
    require(result.returncode == 0, 'sbatch failed for ' + phase + '; inspect saved submission response. Do not blindly resubmit.')
    job = result.stdout.strip().split(';')[0]
    require(job.isdigit(), 'Ambiguous sbatch response for ' + phase + '; a job may exist. Inspect saved response before resubmitting.')
    return job


def submit(base, include_anyppg=True, preview=False, here=None):
    here = Path(here or Path(__file__).resolve().parent)
    files = package_files(here)
    base = Path(base).expanduser().resolve()
    if preview:
        folder = base / 'outputs/iphone_inference/recording_comparison_PREVIEW'
        deps = {'prepare': 'PREPARE_JOB', 'gpu': 'GPU_ARRAY', 'cpu': 'CPU_ARRAY'}
        result = {'preview': True, 'writes': False, 'submitted': False, 'source_files_checked': len(files),
                  'dataset_root': str(base / 'mimic_bp'), 'tasks': declared_tasks(include_anyppg),
                  'jobs': {phase: batch_options(folder, phase, deps, include_anyppg)
                           for phase in ('prepare', 'gpu', 'cpu', 'summary')}, 'scope': SCOPE}
        print(json.dumps(result, indent=2))
        return result
    require(shutil.which('sbatch'), 'Submit on HiPerGator where sbatch is available.')
    dataset = base / 'mimic_bp'
    require(all((dataset / name).is_dir() for name in ('ppg', 'labels')) and
            all((dataset / (s + '_subjects.txt')).is_file() for s in ('train', 'val')),
            'Missing raw PPG, labels, or named train/validation lists in ' + str(dataset))
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    folder = base / 'outputs/iphone_inference' / ('recording_comparison_' + stamp)
    folder.mkdir(parents=True, exist_ok=False)
    (folder / 'logs').mkdir()
    for name, expected in files.items():
        dest = folder / 'runtime' / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes((here / name).read_bytes())
        require(sha256(dest) == expected, 'Source changed during snapshot: ' + name)
    manifest = {'schema_version': 1, 'created_at': datetime.now(timezone.utc).isoformat(),
                'base_dir': str(base), 'dataset_root': str(dataset), 'include_anyppg': include_anyppg,
                'tasks': declared_tasks(include_anyppg), 'config': CONFIG, 'package_sha256': files,
                'label_contract': LABEL_CONTRACT, 'identity_contract': IDENTITY_CONTRACT, 'scope': SCOPE}
    write_json(folder / 'experiment.json', manifest)
    jobs = {}
    print('Experiment:', folder, flush=True)
    try:
        for phase, mode in [('prepare', '--prepare'), ('gpu', '--worker'), ('cpu', '--cpu-worker'), ('summary', '--summary')]:
            jobs[phase] = sbatch(folder, phase, batch_options(folder, phase, jobs, include_anyppg), batch_text(folder, mode))
            write_json(folder / 'submitted_jobs.json', jobs)
            print(phase + ' job: ' + jobs[phase], flush=True)
    except Exception as exc:
        write_json(folder / 'submission_failure.json', {'error': str(exc), 'already_submitted_jobs': jobs,
                                                       'automatic_resubmission': False})
        print('Submission stopped. Already submitted jobs:', jobs, flush=True)
        print('Inspect submission_*.json and squeue before deciding what to submit next.', flush=True)
        raise
    print('Status: squeue -j ' + ','.join(jobs.values()))
    print('Summary: ' + shlex.join(['python3', str(folder / 'runtime/experiment.py'), '--summary', '--experiment-dir', str(folder)]))
    print('At most ' + ('13' if include_anyppg else '12') + ' GPU-hours; no more than two GPUs concurrently. Each worker has a 45-minute software budget inside a 1-hour allocation.')
    print('CPU allocations: up to 12 worker-hours plus 2 preparation-hours; queue time is separate. Safe to close terminal.')
    return folder


def dependency_environment(folder):
    env = os.environ.copy()
    existing = env.get('PYTHONPATH', '')
    env['PYTHONPATH'] = str(Path(folder) / 'deps') + (os.pathsep + existing if existing else '')
    return env


def prepare(folder):
    folder = Path(folder)
    manifest = verify_runtime(folder)
    require(not (folder / 'prepared_complete.json').exists(), 'Preparation already completed; do not reuse experiments.')
    command = [sys.executable, '-u', str(folder / 'runtime/prepare.py'), '--dataset-root', manifest['dataset_root'],
               '--output-dir', str(folder / 'data')]
    subprocess.run(command, check=True)
    dependencies = {}
    # Optional dependencies must never invalidate successful fresh-data preparation.
    try:
        check = subprocess.run([sys.executable, '-c', 'import lightgbm; assert lightgbm.__version__ == "4.6.0"'],
                               env=dependency_environment(folder), text=True, capture_output=True)
        if check.returncode:
            install = subprocess.run([sys.executable, '-m', 'pip', 'install', '--disable-pip-version-check',
                                      '--no-deps', '--timeout', '30', '--retries', '1', '--target', str(folder / 'deps'),
                                      'lightgbm==4.6.0'], text=True, capture_output=True, timeout=600)
            write_json(folder / 'lightgbm_install.json', {'returncode': install.returncode,
                       'stdout': install.stdout, 'stderr': install.stderr})
            require(install.returncode == 0, 'LightGBM installation failed; CNN jobs can still run.')
        check = subprocess.run([sys.executable, '-c', 'import lightgbm; assert lightgbm.__version__ == "4.6.0"'],
                               env=dependency_environment(folder), text=True, capture_output=True)
        require(check.returncode == 0, 'Pinned LightGBM import failed: ' + check.stderr)
        dependencies['lightgbm'] = {'available': True, 'version': '4.6.0'}
    except Exception as exc:
        dependencies['lightgbm'] = {'available': False, 'failure': str(exc)}
    if manifest['include_anyppg']:
        try:
            from anyppg_probe import fetch_encoder
            fetched = fetch_encoder(folder / 'encoder')
            dependencies['anyppg'] = {'available': True, 'fetch_result': fetched}
        except Exception as exc:
            dependencies['anyppg'] = {'available': False, 'failure': str(exc)}
    write_json(folder / 'dependency_report.json', dependencies)
    data = json.loads((folder / 'data/manifest.json').read_text())
    require(data.get('complete') is True and data.get('label_contract') == LABEL_CONTRACT and
            data.get('identity_contract') == IDENTITY_CONTRACT, 'Preparation contract failed.')
    write_json(folder / 'prepared_complete.json', {'complete': True, 'experiment_sha256': sha256(folder / 'experiment.json'),
               'preparation_manifest_sha256': sha256(folder / 'data/manifest.json'), 'dependencies': dependencies})
    print('Fresh train/validation preparation complete. Optional dependency results:', dependencies, flush=True)


def task_output(folder, task):
    if task['model'] == 'anyppg':
        return Path(folder) / 'runs/anyppg_probe'
    return Path(folder) / 'runs' / task['model'] / task['arm'] / ('seed_' + str(task['seed']))


def worker(folder, cpu=False):
    folder = Path(folder)
    manifest = verify_runtime(folder)
    verified_preparation(folder, manifest)
    require(os.environ.get('SLURM_JOB_ID') and os.environ.get('SLURM_ARRAY_TASK_ID', '').isdigit(),
            'Workers must run through the submitted Slurm array.')
    tasks = [t for t in manifest['tasks'] if t['model'] == 'lightgbm'] if cpu else [t for t in manifest['tasks'] if t['model'] != 'lightgbm']
    index = int(os.environ['SLURM_ARRAY_TASK_ID'])
    require(0 <= index < len(tasks), 'Invalid array index.')
    task = tasks[index]
    out = task_output(folder, task)
    require(not out.exists(), 'Worker output already exists. Do not overwrite/reuse selected checkpoints.')
    if task['model'] == 'anyppg':
        command = [sys.executable, '-u', str(folder / 'runtime/anyppg_probe.py'),
                   '--data-dir', str(folder / 'data'), '--output-dir', str(out), '--source-dir', str(folder / 'encoder'),
                   '--device', 'cuda', '--minutes', str(CONFIG['worker_minutes'])]
    else:
        command = [sys.executable, '-u', str(folder / 'runtime/train.py'), '--data-dir', str(folder / 'data'),
                   '--output-dir', str(out), '--arm', task['arm'], '--model', task['model'],
                   '--seed', str(task['seed']), '--minutes', str(CONFIG['worker_minutes'])]
    try:
        if task['model'] in ('lightgbm', 'anyppg'):
            dependencies = json.loads((folder / 'dependency_report.json').read_text())
            dependency = dependencies.get(task['model'], {})
            require(dependency.get('available') is True,
                    'Required optional dependency unavailable: ' + task['model'] + '; ' + str(dependency.get('failure')))
        result = subprocess.run(command, env=dependency_environment(folder))
        require(result.returncode == 0, 'Worker process exited with code ' + str(result.returncode))
    except Exception as exc:
        out.mkdir(parents=True, exist_ok=True)
        write_json(out / 'controller_failure.json', {'complete': False, 'status': 'failed', 'task': task, 'failure': str(exc)})
        raise


def summarize(folder):
    folder = Path(folder)
    manifest = verify_runtime(folder)
    contract_errors, preparation, prep_hash = [], None, None
    try:
        preparation, prep_hash = verified_preparation(folder, manifest)
    except Exception as exc:
        contract_errors.append('Preparation: ' + str(exc))
    rows, reports = [], {}
    for task in manifest['tasks']:
        row = {**task, 'status': 'missing', 'complete': False, 'SBP_mae': None, 'DBP_mae': None,
               'SBP_patient_macro_mae': None, 'DBP_patient_macro_mae': None, 'failure': None}
        report_path = task_output(folder, task) / 'report.json'
        key = (task['model'], task['arm'], task['seed'])
        if report_path.is_file():
            try:
                report = json.loads(report_path.read_text())
                reports[key] = report
                row['status'] = report.get('status', 'complete' if report.get('complete') else 'incomplete')
                row['failure'] = report.get('failure')
                if report.get('complete') is True:
                    require(report.get('schema_version') == 1 and row['status'] == 'complete', 'Invalid completed-report schema/status.')
                    source = 'anyppg_probe.py' if task['model'] == 'anyppg' else 'train.py'
                    require(report.get('source_sha256') == manifest['package_sha256'][source], 'Worker source differs or is absent.')
                    require(report.get('label_contract') == LABEL_CONTRACT and report.get('identity_contract') == IDENTITY_CONTRACT,
                            'Report label/identity contract differs.')
                    fingerprints = report.get('input_fingerprints', {})
                    found_hash = report.get('preparation_manifest_sha256', fingerprints.get('manifest_sha256'))
                    require(prep_hash is not None and found_hash == prep_hash, 'Prepared manifest hash differs or is absent.')
                    expected_model = 'anyppg_frozen_ridge' if task['model'] == 'anyppg' else task['model']
                    require(report.get('model') == expected_model and all(report.get(k) == task[k] for k in ('arm', 'seed')),
                            'Report task identity differs.')
                    if task['model'] == 'lightgbm':
                        require(report.get('lightgbm') == CONFIG['lightgbm_version'], 'Unpinned LightGBM version.')
                    if task['model'] == 'cnn':
                        require(isinstance(report.get('initial_model_sha256'), str) and report['initial_model_sha256'],
                                'Missing CNN initial-weight fingerprint.')
                        orders = report.get('epoch_order_sha256')
                        require(isinstance(orders, list) and orders and all(isinstance(x, str) and x for x in orders),
                                'Missing CNN epoch-order fingerprints.')
                    consumed = fingerprints.get('arrays', report.get('input_sha256', {}))
                    for split in ('train', 'val'):
                        for kind in ('y', 'row', 'patient'):
                            name = f'{kind}_{split}.npy'
                            require(consumed.get(name) == preparation['arrays'][name]['sha256'], 'Row/label/patient identity differs: ' + name)
                    values = report['metrics']['val']
                    outputs = values.get('outputs', values.get('model'))
                    for bp in ('SBP', 'DBP'):
                        value = outputs[bp]['mae']
                        require(isinstance(value, (float, int)) and math.isfinite(value) and value >= 0, 'Invalid validation MAE.')
                        row[bp + '_mae'] = value
                        row[bp + '_patient_macro_mae'] = outputs[bp].get('patient_macro_mae')
                    row['complete'] = True
            except Exception as exc:
                row.update({'status': 'contract_error', 'complete': False, 'failure': str(exc),
                            'SBP_mae': None, 'DBP_mae': None, 'SBP_patient_macro_mae': None, 'DBP_patient_macro_mae': None})
                contract_errors.append(str(key) + ': ' + str(exc))
        else:
            failure_path = task_output(folder, task) / 'controller_failure.json'
            if failure_path.is_file():
                try:
                    failure = json.loads(failure_path.read_text())
                    row.update({'status': 'failed', 'failure': failure.get('failure')})
                except Exception as exc:
                    row.update({'status': 'unreadable_failure', 'failure': str(exc)})
            elif (report_path.parent / 'progress.json').is_file():
                row.update({'status': 'incomplete', 'failure': 'Progress exists without a final report; inspect Slurm logs/status.'})
        rows.append(row)
    # Baselines use only training-label constants and the same validation rows.
    # Allow float32/float64 reduction rounding across the independent workers.
    baselines = None
    baseline_tolerance = 1e-4
    for row in rows:
        if not row['complete']:
            continue
        key = (row['model'], row['arm'], row['seed'])
        try:
            found = {name: {bp: reports[key]['baselines'][name]['val']['outputs'][bp]['mae']
                            for bp in ('SBP', 'DBP')} for name in ('train_mean', 'train_median')}
            require(all(isinstance(v, (float, int)) and math.isfinite(v) and v >= 0
                        for pair in found.values() for v in pair.values()), 'Invalid baseline MAE.')
            if baselines is None:
                baselines = found
            else:
                require(all(abs(found[name][bp] - baselines[name][bp]) <= baseline_tolerance
                            for name in found for bp in ('SBP', 'DBP')), 'Shared-cohort baselines differ.')
        except Exception as exc:
            contract_errors.append(str(key) + ': baseline contract: ' + str(exc))
    comparisons = {}
    for seed in SEEDS:
        relevant = [reports.get(('cnn', arm, seed)) for arm in ARMS]
        check = {'complete_four_filter_reports': all(r and r.get('complete') for r in relevant),
                 'initial_weights_match': None, 'overlapping_epoch_orders_match': None}
        if check['complete_four_filter_reports']:
            initials = [r.get('initial_model_sha256') for r in relevant]
            orders = [r.get('epoch_order_sha256') for r in relevant]
            if all(initials):
                check['initial_weights_match'] = len(set(initials)) == 1
            if all(isinstance(o, list) and o for o in orders):
                shared = min(map(len, orders))
                check['overlapping_epoch_orders_match'] = all(o[:shared] == orders[0][:shared] for o in orders)
                check['shared_epochs_checked'] = shared
            if check['initial_weights_match'] is False or check['overlapping_epoch_orders_match'] is False:
                contract_errors.append('CNN paired-run initialization/order mismatch for seed ' + str(seed))
        comparisons[str(seed)] = check
    aggregate = {}
    for model in ('cnn', 'lightgbm'):
        for arm in ARMS:
            selected = [r for r in rows if r['model'] == model and r['arm'] == arm]
            complete = all(r['complete'] for r in selected) and len(selected) == len(SEEDS)
            group = {'completed_seed_count': sum(r['complete'] for r in selected), 'all_seeds_complete': complete,
                     'validation': None}
            if complete:
                group['validation'] = {bp: {'mean_MAE': statistics.mean(r[bp + '_mae'] for r in selected),
                                             'sample_SD_MAE': statistics.stdev(r[bp + '_mae'] for r in selected)}
                                       for bp in ('SBP', 'DBP')}
            aggregate[model + '/' + arm] = group
    result = {'schema_version': 1, 'scope': SCOPE, 'all_declared_rows_retained': True,
              'tasks': rows, 'three_seed_summary': aggregate, 'cnn_pair_checks': comparisons,
              'validation_baselines': baselines, 'baseline_consistency_tolerance_mmhg': baseline_tolerance,
              'contract_errors': contract_errors, 'comparison_contract_passed': not contract_errors,
              'complete': all(r['complete'] for r in rows) and not contract_errors,
              'anyppg_note': 'Exploratory only. Pretraining patient overlap unresolved; excluded from three-seed independent-model comparison.',
              'uncertainty_note': 'Seed sample SD is not a patient confidence interval. No partial-seed averages are reported.'}
    write_json(folder / 'summary.json', result)
    fields = ['model', 'arm', 'seed', 'status', 'complete', 'SBP_mae', 'DBP_mae', 'SBP_patient_macro_mae', 'DBP_patient_macro_mae', 'failure']
    with (folder / 'summary.csv').open('w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(rows)
    lines = ['# Recording comparison results', '', SCOPE, '',
             '| Model | Filter | Seed | Status | SBP MAE | DBP MAE |', '|---|---|---|---|---:|---:|']
    def fmt(v):
        return '—' if v is None else f'{v:.4f}'
    for row in rows:
        lines.append('| ' + ' | '.join([row['model'], row['arm'], str(row['seed']), row['status'], fmt(row['SBP_mae']), fmt(row['DBP_mae'])]) + ' |')
    if baselines is not None:
        lines += ['', '## Shared validation baselines', '', '| Constant predictor | SBP MAE | DBP MAE |', '|---|---:|---:|']
        for name, values in baselines.items():
            lines.append('| ' + name + ' | ' + fmt(values['SBP']) + ' | ' + fmt(values['DBP']) + ' |')
    lines += ['', 'AnyPPG is exploratory because pretraining patient overlap is unresolved. Do not call it a held-out winner.',
              '', 'Only groups with all three seeds complete receive an average. Seed variability is not a patient confidence interval.',
              '', '## Contract checks', '', '```json', json.dumps({'errors': contract_errors, 'CNN': comparisons}, indent=2), '```', '']
    (folder / 'summary.md').write_text('\n'.join(lines))
    print('RECORDING COMPARISON — all ' + str(len(rows)) + ' predeclared runs retained; validation development only')
    for row in rows:
        print(row['model'], row['arm'], row['seed'], row['status'], row['SBP_mae'], row['DBP_mae'])
    print('Shared validation baselines:', baselines)
    print('Contract errors:', contract_errors)
    print('JSON / CSV / Markdown:', folder)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    for name in ('submit', 'preview', 'prepare', 'worker', 'cpu-worker', 'summary'):
        mode.add_argument('--' + name, action='store_true')
    parser.add_argument('--base-dir', type=Path, default=BASE)
    parser.add_argument('--experiment-dir', type=Path)
    parser.add_argument('--skip-anyppg', action='store_true')
    args = parser.parse_args()
    if args.submit or args.preview:
        submit(args.base_dir, not args.skip_anyppg, args.preview)
        return
    require(args.experiment_dir is not None, '--experiment-dir is required.')
    folder = args.experiment_dir.resolve()
    require(Path(__file__).resolve() == folder / 'runtime/experiment.py', 'Use the snapshotted runtime/experiment.py inside this experiment.')
    if args.prepare:
        prepare(folder)
    elif args.worker or args.cpu_worker:
        worker(folder, args.cpu_worker)
    else:
        summarize(folder)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
