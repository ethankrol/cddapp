#!/usr/bin/env python3
"""Retry only the 12 pre-epoch pooling failures; carry 13 completed reports intact."""
from __future__ import annotations
import argparse
import ast
import csv
from datetime import datetime, timezone
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
import experiment as e

OLD_SOURCES = {
    'train.py': 'cfacec2dbef239336dbf5744f77304a6eaa96e02a940e0e31d0d12cd970a516f',
    'experiment.py': '4f76514347138adfca62b68c6d1b208392ece2dafd85daec8fb2e175f949efda',
    'anyppg_probe.py': '188d6353b06f4aa2bcf21303f5a5aebc10c0c94420678f7138919aa446d34d2a',
}
RETRY_FILES = ('retry_cnn.py', 'train.py', 'pooling_preflight.py', 'experiment.py')
POOLING = 'adaptive_bins_slice_mean_stack_v1'
FAILURE = 'adaptive_avg_pool2d_backward_cuda does not have a deterministic implementation'
require, sha256, write_json = e.require, e.sha256, e.write_json


def read(path):
    return json.loads(Path(path).read_text())


def report_name(task):
    return (e.task_output(Path('.'), task) / 'report.json').as_posix()


def check_completed(report, task, source, prep, prep_hash, corrected=False):
    require(report.get('schema_version') == 1 and report.get('complete') is True and
            report.get('status') == 'complete', 'Completed report required.')
    require(report.get('source_sha256') == source, 'Worker source hash differs.')
    require(report.get('model') == ('anyppg_frozen_ridge' if task['model'] == 'anyppg' else task['model'])
            and all(report.get(k) == task[k] for k in ('arm', 'seed')), 'Report task differs.')
    require(report.get('label_contract') == e.LABEL_CONTRACT and
            report.get('identity_contract') == e.IDENTITY_CONTRACT, 'Report data contract differs.')
    fingerprints = report.get('input_fingerprints', {})
    require(fingerprints.get('manifest_sha256') == prep_hash and
            report.get('preparation_manifest_sha256', prep_hash) == prep_hash, 'Preparation hash differs.')
    consumed = fingerprints.get('arrays', {})
    prefix = 'feature' if task['model'] == 'lightgbm' else 'X'
    for split in ('train', 'val'):
        for name in [f'{kind}_{split}.npy' for kind in ('y', 'row', 'patient')] + [f'{prefix}_{task["arm"]}_{split}.npy']:
            require(consumed.get(name) == prep['arrays'][name]['sha256'], 'Input identity differs: ' + name)
    if task['model'] == 'lightgbm':
        require(report.get('lightgbm') == '4.6.0', 'LightGBM version differs.')
    if corrected:
        require(report.get('device') == 'cuda', 'CNN report must come from CUDA.')
        require(report.get('recipe', {}).get('pooling_implementation') == POOLING and
                report['recipe'].get('deterministic_algorithms') is True, 'CNN pooling/determinism differs.')
        require(report.get('initial_model_sha256') and report.get('epoch_order_sha256'), 'CNN pairing evidence missing.')
    values = report['metrics']['val']['outputs']
    for bp in ('SBP', 'DBP'):
        v = values[bp]['mae']
        require(isinstance(v, (float, int)) and math.isfinite(v) and v >= 0, 'Invalid validation MAE.')
    return values


def check_parent(parent):
    """Small metadata/source reads only; full data hashes run on a compute node."""
    parent = Path(parent).resolve()
    manifest = e.verify_runtime(parent)
    require(manifest['tasks'] == e.declared_tasks(True), 'Expected original 25-task comparison.')
    require(all(manifest['package_sha256'].get(k) == v for k, v in OLD_SOURCES.items()),
            'Parent source is not the original supported recording comparison.')
    prep, prep_hash = e.verified_preparation(parent, manifest)
    reports = {}
    for task in manifest['tasks']:
        name = report_name(task)
        path = parent / name
        require(path.is_file(), 'Missing original report: ' + name)
        report = read(path)
        if task['model'] == 'cnn':
            require(report.get('status') == 'failed' and report.get('complete') is False and
                    FAILURE in str(report.get('failure')) and report.get('epochs_completed') in (None, 0) and
                    report.get('selected_epoch') is None, 'Not a pre-epoch pooling failure: ' + name)
            require(report.get('source_sha256') == OLD_SOURCES['train.py'] and
                    all(report.get(k) == task[k] for k in ('model', 'arm', 'seed')), 'Failed CNN source/task differs.')
        else:
            source = OLD_SOURCES['anyppg_probe.py' if task['model'] == 'anyppg' else 'train.py']
            check_completed(report, task, source, prep, prep_hash)
        reports[name] = sha256(path)
    return manifest, prep, prep_hash, reports


def verify(folder):
    folder = Path(folder).resolve()
    m = read(folder / 'retry.json')
    require(m.get('schema_version') == 1 and m.get('tasks') == e.declared_tasks(True), 'Retry manifest differs.')
    require(m.get('retry_tasks') == [t for t in m['tasks'] if t['model'] == 'cnn'], 'Retry task list differs.')
    require(set(m['runtime_sha256']) == set(RETRY_FILES), 'Retry runtime list differs.')
    for name, digest in m['runtime_sha256'].items():
        path = folder / 'runtime' / name
        require(not path.is_symlink() and sha256(path) == digest, 'Retry runtime changed: ' + name)
    parent = Path(m['parent_experiment'])
    require(sha256(parent / 'experiment.json') == m['parent_experiment_sha256'], 'Parent experiment changed.')
    original = e.verify_runtime(parent)
    require(all(original['package_sha256'].get(k) == v for k, v in OLD_SOURCES.items()), 'Original source differs.')
    prep, prep_hash = e.verified_preparation(parent, original)
    require(prep_hash == m['preparation_manifest_sha256'], 'Prepared data manifest changed.')
    require(set(m['parent_report_sha256']) == {report_name(t) for t in m['tasks']}, 'Original report list differs.')
    for name, digest in m['parent_report_sha256'].items():
        require(sha256(folder / 'parent_reports' / name) == digest, 'Archived original report changed: ' + name)
        require(sha256(parent / name) == digest, 'Parent report changed: ' + name)
    return m, prep


def batch_options(folder, phase, jobs):
    common = ['--nodes=1', '--ntasks=1', '--cpus-per-task=4', '--chdir=' + str(folder),
              '--job-name=cbp_cnn_retry_' + phase,
              '--output=' + str(folder / ('logs/' + phase + '_%A_%a.log')),
              '--error=' + str(folder / ('logs/' + phase + '_%A_%a.err'))]
    if phase == 'summary':
        return common + ['--partition=hpg-default', '--constraint=el9', '--mem=4G', '--time=00:10:00',
                         '--dependency=afterany:' + jobs['preflight'] + ':' + jobs['cnn'], '--kill-on-invalid-dep=yes']
    common += ['--partition=hpg-b200', '--mem=64G', '--gres=gpu:1']
    if phase == 'preflight':
        return common + ['--time=00:10:00']
    return common + ['--time=01:00:00', '--array=0-11%2',
                     '--dependency=afterok:' + jobs['preflight'], '--kill-on-invalid-dep=yes']


def batch_text(folder, phase):
    mode = '--worker' if phase == 'cnn' else '--' + phase
    return '\n'.join(['#!/bin/bash', 'set -euo pipefail', 'module purge', 'module load pytorch/2.8.0',
        'export OMP_NUM_THREADS=4', 'export MKL_NUM_THREADS=4', 'export OPENBLAS_NUM_THREADS=4',
        'export CUBLAS_WORKSPACE_CONFIG=:4096:8',
        shlex.join(['python', '-u', str(folder / 'runtime/retry_cnn.py'), mode, '--experiment-dir', str(folder)]), ''])


def submit(parent, preview=False, here=None):
    parent = Path(parent).expanduser().resolve()
    original, prep, prep_hash, report_hashes = check_parent(parent)
    here = Path(here or Path(__file__).resolve().parent)
    hashes = {}
    for name in RETRY_FILES:
        require(not (here / name).is_symlink(), 'Linked retry source is not accepted.')
        ast.parse((here / name).read_text(), filename=name)
        hashes[name] = sha256(here / name)
    require(hashes['experiment.py'] == OLD_SOURCES['experiment.py'], 'Shared experiment helper changed.')
    require(hashes['train.py'] != OLD_SOURCES['train.py'], 'Corrected worker is missing.')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    folder = parent.parent / ('recording_cnn_retry_' + ('PREVIEW' if preview else stamp))
    if preview:
        result = {'preview': True, 'submitted': False, 'writes': False, 'parent': str(parent),
                  'retry_count': 12, 'carried_complete_count': 13,
                  'jobs': {p: batch_options(folder, p, {'preflight': 'GPU_CHECK', 'cnn': 'CNN_ARRAY'})
                           for p in ('preflight', 'cnn', 'summary')}}
        print(json.dumps(result, indent=2))
        return result
    require(shutil.which('sbatch'), 'sbatch is unavailable; submit on HiPerGator.')
    folder.mkdir(mode=0o700)
    (folder / 'logs').mkdir()
    (folder / 'runtime').mkdir()
    for name, digest in hashes.items():
        shutil.copyfile(here / name, folder / 'runtime' / name)
        require(sha256(folder / 'runtime' / name) == digest, 'Source changed during snapshot.')
    for name, digest in report_hashes.items():
        dest = folder / 'parent_reports' / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(parent / name, dest)
        require(sha256(dest) == digest, 'Original report changed during snapshot.')
    write_json(folder / 'retry.json', {'schema_version': 1, 'created_at': stamp,
        'parent_experiment': str(parent), 'parent_experiment_sha256': sha256(parent / 'experiment.json'),
        'preparation_manifest_sha256': prep_hash, 'parent_report_sha256': report_hashes,
        'runtime_sha256': hashes, 'tasks': original['tasks'],
        'retry_tasks': [t for t in original['tasks'] if t['model'] == 'cnn'],
        'reason': FAILURE, 'scope': e.SCOPE})
    jobs = {}
    print('Retry results folder:', folder, flush=True)
    try:
        for phase in ('preflight', 'cnn', 'summary'):
            jobs[phase] = e.sbatch(folder, phase, batch_options(folder, phase, jobs), batch_text(folder, phase))
            write_json(folder / 'submitted_jobs.json', jobs)
            print(phase + ' job: ' + jobs[phase], flush=True)
    except Exception as exc:
        write_json(folder / 'submission_failure.json', {'failure': str(exc), 'already_submitted_jobs': jobs,
                                                       'automatic_resubmission': False})
        print('Submission stopped. Inspect saved receipts and squeue before resubmitting:', jobs)
        raise
    print('Status: squeue -j ' + ','.join(jobs.values()))
    print('GPU check log: ' + str(folder / 'logs/preflight_*.log'))
    print('Summary: ' + shlex.join(['python3', str(folder / 'runtime/retry_cnn.py'), '--summary', '--experiment-dir', str(folder)]))
    print('12 CNN tasks, maximum 2 GPUs at once, 45-minute software budget / 1-hour allocation each.')
    print('GPU check: 10-minute allocation. Queue time is separate. Safe to close this terminal.')
    return folder


def validate_gate(folder, m):
    gate = read(folder / 'preflight.json')
    require(gate.get('passed') is True and gate.get('complete') is True and gate.get('device') == 'cuda',
            'A successful CUDA preflight is required.')
    require(gate.get('retry_manifest_sha256') == sha256(folder / 'retry.json') and
            gate.get('train_sha256') == m['runtime_sha256']['train.py'] and
            gate.get('source_sha256') == m['runtime_sha256']['pooling_preflight.py'] and
            gate.get('data_hashes_verified') is True and gate.get('repeated_training_exact') is True,
            'GPU preflight does not match this retry.')
    return gate


def preflight(folder):
    m, prep = verify(folder)
    require(os.environ.get('SLURM_JOB_ID'), 'Preflight must run inside the submitted GPU allocation.')
    require(not (folder / 'preflight.json').exists(), 'Preflight already exists; do not overwrite.')
    report = {'complete': False, 'passed': False, 'failure': None, 'device': 'cuda',
              'retry_manifest_sha256': sha256(folder / 'retry.json')}
    try:
        data_dir = Path(m['parent_experiment']) / 'data'
        for name, desc in prep['arrays'].items():
            path = data_dir / name
            require(path.resolve().parent == data_dir.resolve() and not path.is_symlink(), 'Unsafe data path.')
            require(sha256(path) == desc['sha256'], 'Prepared array changed: ' + name)
        from pooling_preflight import run_preflight
        report.update(run_preflight(device='cuda', batch_size=64))
        report['data_hashes_verified'] = True
        report['array_count_verified'] = len(prep['arrays'])
        report['complete'] = report.get('passed') is True
        verify(folder)
    except Exception as exc:
        report.update({'complete': False, 'passed': False, 'failure': f'{type(exc).__name__}: {exc}'})
        traceback.print_exc()
    write_json(folder / 'preflight.json', report)
    print(json.dumps(report, indent=2))
    require(report['passed'] and report['complete'], 'GPU preflight failed. CNN jobs will not start.')


def worker(folder):
    m, _ = verify(folder)
    validate_gate(folder, m)
    require(os.environ.get('SLURM_JOB_ID') and os.environ.get('SLURM_ARRAY_TASK_ID', '').isdigit(),
            'CNN workers must run inside the submitted Slurm array.')
    index = int(os.environ['SLURM_ARRAY_TASK_ID'])
    require(0 <= index < len(m['retry_tasks']), 'Invalid CNN task index.')
    task = m['retry_tasks'][index]
    out = e.task_output(folder, task)
    require(not out.exists(), 'Retry output already exists; no overwrite or resume.')
    try:
        subprocess.run([sys.executable, '-u', str(folder / 'runtime/train.py'),
            '--data-dir', str(Path(m['parent_experiment']) / 'data'), '--output-dir', str(out),
            '--model', 'cnn', '--arm', task['arm'], '--seed', str(task['seed']), '--minutes', '45'], check=True)
    except Exception as exc:
        out.mkdir(parents=True, exist_ok=True)
        write_json(out / 'controller_failure.json', {'status': 'failed', 'failure': str(exc), 'task': task})
        raise


def summarize(folder):
    m, prep = verify(folder)
    rows, reports, errors, old_attempts = [], {}, [], []
    gate_ok = False
    if (folder / 'preflight.json').is_file():
        try:
            validate_gate(folder, m)
            gate_ok = True
        except Exception as exc:
            errors.append('GPU preflight: ' + str(exc))
    for task in m['tasks']:
        name = report_name(task)
        corrected = task['model'] == 'cnn'
        row = {**task, 'origin': 'cnn_retry' if corrected else 'original_complete',
               'status': 'missing', 'complete': False, 'SBP_mae': None, 'DBP_mae': None, 'failure': None}
        original = read(folder / 'parent_reports' / name)
        if corrected:
            old_attempts.append({**task, 'status': original['status'], 'failure': original['failure'],
                                 'report_sha256': m['parent_report_sha256'][name]})
        path = folder / name if corrected else folder / 'parent_reports' / name
        if path.is_file():
            try:
                report = read(path)
                row.update({'status': report.get('status', 'incomplete'), 'failure': report.get('failure')})
                if report.get('complete') is True:
                    source = (m['runtime_sha256']['train.py'] if corrected else
                              OLD_SOURCES['anyppg_probe.py' if task['model'] == 'anyppg' else 'train.py'])
                    values = check_completed(report, task, source, prep, m['preparation_manifest_sha256'], corrected)
                    if corrected:
                        require(gate_ok, 'Completed CNN report lacks matching GPU preflight.')
                        if original.get('initial_model_sha256'):
                            require(report['initial_model_sha256'] == original['initial_model_sha256'], 'Initial weights changed from original attempt.')
                        old_orders = original.get('epoch_order_sha256', [])
                        require(report['epoch_order_sha256'][:len(old_orders)] == old_orders, 'Sample order changed from original attempt.')
                    row.update({'complete': True, **{bp + '_mae': values[bp]['mae'] for bp in ('SBP', 'DBP')}})
                    reports[(task['model'], task['arm'], task['seed'])] = report
            except Exception as exc:
                row.update({'status': 'contract_error', 'complete': False, 'failure': str(exc), 'SBP_mae': None, 'DBP_mae': None})
                errors.append(name + ': ' + str(exc))
        elif (path.parent / 'controller_failure.json').is_file():
            row.update({'status': 'failed', 'failure': read(path.parent / 'controller_failure.json').get('failure')})
        elif (path.parent / 'progress.json').is_file():
            row['status'] = 'incomplete'
        rows.append(row)
    baselines = None
    for key, report in reports.items():
        try:
            found = {n: {bp: report['baselines'][n]['val']['outputs'][bp]['mae'] for bp in ('SBP', 'DBP')}
                     for n in ('train_mean', 'train_median')}
            require(all(isinstance(v, (float, int)) and math.isfinite(v) and v >= 0 for pair in found.values() for v in pair.values()), 'Invalid baseline.')
            if baselines is None:
                baselines = found
            else:
                require(all(abs(found[n][bp] - baselines[n][bp]) <= 1e-4 for n in found for bp in found[n]), 'Shared baselines differ.')
        except Exception as exc:
            errors.append(str(key) + ': ' + str(exc))
    pair_checks = {}
    for seed in e.SEEDS:
        selected = [reports.get(('cnn', arm, seed)) for arm in e.ARMS]
        paired = None
        if all(selected):
            orders = [r['epoch_order_sha256'] for r in selected]
            common = min(map(len, orders))
            paired = len({r['initial_model_sha256'] for r in selected}) == 1 and all(o[:common] == orders[0][:common] for o in orders)
            if not paired:
                errors.append('CNN initial weights / epoch orders differ for seed ' + str(seed))
        pair_checks[str(seed)] = paired
    aggregate = {}
    for model in ('cnn', 'lightgbm'):
        for arm in e.ARMS:
            group = [r for r in rows if r['model'] == model and r['arm'] == arm]
            complete = len(group) == 3 and all(r['complete'] for r in group)
            aggregate[model + '/' + arm] = {'completed_seed_count': sum(r['complete'] for r in group),
                'all_seeds_complete': complete, 'validation': {bp: {
                    'mean_MAE': statistics.mean(r[bp + '_mae'] for r in group),
                    'sample_SD_MAE': statistics.stdev(r[bp + '_mae'] for r in group)} for bp in ('SBP', 'DBP')} if complete and not errors else None}
    result = {'schema_version': 1, 'scope': e.SCOPE, 'tasks': rows, 'parent_attempts': old_attempts,
        'parent_experiment': m['parent_experiment'], 'original_reports_preserved': True,
        'three_seed_summary': aggregate, 'cnn_pair_checks': pair_checks, 'gpu_preflight_passed': gate_ok,
        'validation_baselines': baselines, 'contract_errors': errors,
        'complete': gate_ok and all(r['complete'] for r in rows) and not errors,
        'notes': ['All 25 declared rows retained; 13 completed original reports carried without changes.',
                  'AnyPPG is exploratory; pretraining patient overlap unresolved.',
                  'Seed sample SD is not a patient confidence interval. No partial-seed averages.']}
    write_json(folder / 'summary.json', result)
    with (folder / 'summary.csv').open('w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['model', 'arm', 'seed', 'origin', 'status', 'complete', 'SBP_mae', 'DBP_mae', 'failure'], extrasaction='ignore')
        writer.writeheader()
        writer.writerows(rows)
    lines = ['# Recording comparison after CNN retry', '', e.SCOPE, '',
             '| Model | Filter | Seed | Origin | Status | SBP MAE | DBP MAE |', '|---|---|---|---|---|---:|---:|']
    for r in rows:
        lines.append('| ' + ' | '.join(str(r[k]) if r[k] is not None else '—' for k in ('model', 'arm', 'seed', 'origin', 'status', 'SBP_mae', 'DBP_mae')) + ' |')
    lines += ['', *result['notes'], '', '```json', json.dumps({'three_seed_summary': aggregate, 'errors': errors}, indent=2), '```', '']
    (folder / 'summary.md').write_text('\n'.join(lines))
    print('CNN RETRY COMBINED SUMMARY — all 25 declared runs retained')
    for r in rows:
        print(r['model'], r['arm'], r['seed'], r['status'], r['SBP_mae'], r['DBP_mae'], r['origin'])
    print('GPU preflight passed:', gate_ok, '| Complete comparison:', result['complete'])
    print('Contract errors:', errors)
    print('JSON / CSV / Markdown:', folder)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    for name in ('submit', 'preview', 'preflight', 'worker', 'summary'):
        modes.add_argument('--' + name, action='store_true')
    parser.add_argument('--parent-experiment', type=Path)
    parser.add_argument('--experiment-dir', type=Path)
    args = parser.parse_args()
    if args.submit or args.preview:
        require(args.parent_experiment is not None, '--parent-experiment is required.')
        submit(args.parent_experiment, args.preview)
    else:
        require(args.experiment_dir is not None, '--experiment-dir is required.')
        folder = args.experiment_dir.resolve()
        require(Path(__file__).resolve() == folder / 'runtime/retry_cnn.py', 'Use the snapshotted runtime/retry_cnn.py.')
        if args.preflight:
            preflight(folder)
        elif args.worker:
            worker(folder)
        else:
            summarize(folder)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
