#!/usr/bin/env python3
"""Compare cBP-Tnet training with original augmentation on versus off.

Run on HiPerGator with --submit. Two sequential GPU array tasks use the same
initialization seed, cached train/validation data, architecture, and optimizer.
The original training main is never executed. No test-cache evaluation occurs.
This tests the augmentation pipeline as a whole, not only its derivative bug.
"""
import argparse
import ast
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import random
import shlex
import subprocess
import sys
import types

BASE = Path('/orange/xiangyan/rithika/cdd')
DEFINITIONS = {
    'set_random_seeds', 'generate_fixed_length_vector', 'augment_beat',
    'BloodPressureDataset', 'SubjectStratifiedSampler', 'ConvBlock',
    'CNNTransformerBP', 'ClinicalHuberLoss', 'Trainer', 'predict',
}
DEFINITION_HASH = '5476589899288bb1693cc23f6173c4934b40d8d35ede77a025b93e3ec4de42d2'
TRAIN_HASH = '3442299cb3996386916707cd88f89e5bc5cbdf08077d3e8d94ed181b5fdb4940'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha256(path):
    h = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def write_json(path, value):
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')
    temporary.replace(path)


def canonical_ast(node):
    # Python 3.12 added type_params; neither reviewed class/function uses it.
    # Own serialization also avoids ast.dump's version-dependent empty fields.
    if isinstance(node, ast.AST):
        require(not getattr(node, 'type_params', []), 'Unexpected generic type parameters.')
        return [type(node).__name__, [[key, canonical_ast(value)]
                for key, value in ast.iter_fields(node) if key != 'type_params']]
    if isinstance(node, list):
        return [canonical_ast(value) for value in node]
    return node


def definitions(source):
    tree = ast.parse(source)
    nodes = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.ClassDef))
             and n.name in DEFINITIONS]
    require(len(nodes) == len(DEFINITIONS) and {n.name for n in nodes} == DEFINITIONS,
            'Required training definitions are missing or duplicated.')
    tree = ast.Module(body=nodes, type_ignores=[])
    digest = hashlib.sha256(json.dumps(canonical_ast(tree), separators=(',', ':')).encode()).hexdigest()
    require(digest == DEFINITION_HASH,
            'Local training definitions differ from the reviewed version. No training was started; share the local source for review.')
    return tree


def submit(base):
    source_path = base / 'cbp_tnet_train_v4_final.py'
    source = source_path.read_text()
    definitions(source)
    norm_path = base / 'outputs/iphone_inference/normalization.json'
    settings = json.loads(norm_path.read_text())
    require(settings.get('train_cache_sha256') == TRAIN_HASH, 'Unexpected normalization metadata.')
    cache_paths = {s: base / ('mimic_bp/feature_cache/v4final_' + s + '_sf125_ws250.npz')
                   for s in ('train', 'val')}
    cache_hashes = {s: sha256(p) for s, p in cache_paths.items()}
    require(cache_hashes['train'] == TRAIN_HASH, 'Training cache differs from the audited cache.')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    folder = base / 'outputs/iphone_inference' / ('augmentation_comparison_' + stamp)
    folder.mkdir(parents=True, exist_ok=False)
    (folder / 'training_source.py').write_text(source)
    controller = folder / 'compare_cbp_augmentation.py'
    controller.write_text(Path(__file__).read_text())
    write_json(folder / 'normalization_input.json', settings)
    manifest = {
        'created_utc': datetime.now(timezone.utc).isoformat(), 'base_dir': str(base),
        'cache_paths': {s: str(p) for s, p in cache_paths.items()}, 'cache_sha256': cache_hashes,
        'source_sha256': sha256(folder / 'training_source.py'),
        'controller_sha256': sha256(controller),
        'normalization_sha256': sha256(folder / 'normalization_input.json'),
        'seed': 125, 'arms': ['on', 'off'], 'epochs': 500, 'patience': 80,
        'lr': 3e-4, 'batch_size': 256, 'beats_per_subject_per_epoch': 30,
        'note': 'Diagnostic ablation on validation only. Original augmentation versus no augmentation; no automatic deployment.',
    }
    write_json(folder / 'experiment.json', manifest)
    logs = base / 'logs'
    logs.mkdir(exist_ok=True)
    command = 'python -u {} --worker --experiment-dir {}'.format(
        shlex.quote(str(controller)), shlex.quote(str(folder)))
    body = '\n'.join(['#!/bin/bash', 'set -euo pipefail', 'module purge',
                      'module load pytorch/2.8.0', 'export OMP_NUM_THREADS=4',
                      'export MKL_NUM_THREADS=4', command, ''])
    result = subprocess.run([
        'sbatch', '--parsable', '--job-name=cbp_aug_compare', '--array=0-1%1',
        '--partition=hpg-b200', '--nodes=1', '--ntasks=1', '--cpus-per-task=4',
        '--mem=16G', '--gres=gpu:1', '--time=02:00:00', '--chdir=' + str(base),
        '--output=' + str(logs / 'cbp_aug_%A_%a.log'),
        '--error=' + str(logs / 'cbp_aug_%A_%a.err'),
    ], input=body, text=True, capture_output=True, check=True)
    job = result.stdout.strip().split(';')[0]
    manifest['slurm_array_job_id'] = job
    write_json(folder / 'experiment.json', manifest)
    print('Submitted two sequential comparison tasks:', job, '(0=on, 1=off)')
    print('Status: squeue -j ' + job)
    print('Summary command:')
    print('python3 {} --summary --experiment-dir {}'.format(
        shlex.quote(str(controller)), shlex.quote(str(folder))))
    print('Each task has a two-hour limit; queue time is separate.')
    if result.stderr.strip():
        print(result.stderr.strip())


def metric(pred, target, np):
    require(pred.shape == target.shape and pred.shape[1:] == (2,), 'Unexpected output shape.')
    require(np.isfinite(pred).all() and np.isfinite(target).all(), 'Nonfinite predictions or labels.')
    result = {}
    for i, name in enumerate(('SBP', 'DBP')):
        p, y = pred[:, i].astype(np.float64), target[:, i].astype(np.float64)
        result[name] = {
            'mae': float(np.mean(np.abs(p - y))),
            'correlation': float(np.corrcoef(p, y)[0, 1]) if np.ptp(p) > 1e-12 and np.ptp(y) > 1e-12 else None,
            'prediction_sd': float(p.std()), 'target_sd': float(y.std()),
        }
    return result


def state_digest(model):
    digest = hashlib.sha256()
    for name, tensor in model.state_dict().items():
        array = tensor.detach().cpu().contiguous().numpy()
        digest.update(name.encode())
        digest.update(str(array.dtype).encode())
        digest.update(str(array.shape).encode())
        digest.update(array.tobytes())
    return digest.hexdigest()


def run_worker(folder):
    import numpy as np
    import torch
    from tqdm import tqdm

    manifest = json.loads((folder / 'experiment.json').read_text())
    for key, filename in (('source_sha256', 'training_source.py'),
                          ('controller_sha256', 'compare_cbp_augmentation.py'),
                          ('normalization_sha256', 'normalization_input.json')):
        require(sha256(folder / filename) == manifest[key], 'Experiment snapshot changed: ' + filename)
    arm_id = int(os.environ['SLURM_ARRAY_TASK_ID'])
    require(arm_id in (0, 1), 'Expected array task 0 or 1.')
    arm = manifest['arms'][arm_id]
    out = folder / ('augmentation_' + arm)
    out.mkdir(exist_ok=False)
    require(torch.cuda.is_available(), 'No CUDA device is available in this GPU job.')
    torch.set_num_threads(4)
    torch.set_num_interop_threads(1)
    torch.backends.cudnn.benchmark = False
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    device = torch.device('cuda')
    module = types.ModuleType('cbp_reviewed_training_definitions')
    sys.modules[module.__name__] = module
    scope = module.__dict__
    scope.update({'np': np, 'random': random, 'torch': torch, 'nn': torch.nn,
                  'optim': torch.optim, 'Dataset': torch.utils.data.Dataset,
                  'F': torch.nn.functional, 'DEVICE': device, 'tqdm': tqdm})
    exec(compile(definitions((folder / 'training_source.py').read_text()),
                 str(folder / 'training_source.py'), 'exec'), scope)
    settings = json.loads((folder / 'normalization_input.json').read_text())
    require(settings['channel_order'] == ['PPG', 'dPPG', 'd2PPG']
            and settings['timing_feature_order'] == ['scaled_upstroke_time', 'scaled_beat_interval']
            and settings['output_order'] == ['SBP', 'DBP']
            and settings['sampling_rate_hz'] == 125 and settings['samples_per_beat'] == 250,
            'Normalization contract differs from the audited model.')
    cm = np.asarray(settings['channel_mean'], dtype=np.float32)[None, :, None]
    cs = np.asarray(settings['channel_std'], dtype=np.float32)[None, :, None]
    tm = np.asarray(settings['timing_mean'], dtype=np.float32)
    ts = np.asarray(settings['timing_std'], dtype=np.float32)
    require(cm.shape == cs.shape == (1, 3, 1) and tm.shape == ts.shape == (2,)
            and all(np.isfinite(a).all() for a in (cm, cs, tm, ts))
            and (cs > 0).all() and (ts > 0).all(), 'Invalid normalization values.')
    datasets, targets, baselines = {}, {}, {}
    print('AUGMENTATION COMPARISON:', arm, flush=True)
    print('Python:', sys.version.split()[0], 'Torch:', torch.__version__,
          'NumPy:', np.__version__, 'GPU:', torch.cuda.get_device_name(), flush=True)
    for split, count in (('train', 220000), ('val', 39000)):
        path = Path(manifest['cache_paths'][split])
        require(sha256(path) == manifest['cache_sha256'][split], 'Cache changed: ' + split)
        before = path.stat()
        with np.load(path, allow_pickle=False) as data:
            x, timing = data['beats'], data['PTT']
            y = np.column_stack([data['SBP'], data['DBP']]).astype(np.float32)
            subjects = data['subject_ids']
        after = path.stat()
        require((before.st_size, before.st_mtime_ns) == (after.st_size, after.st_mtime_ns), 'Cache changed during read.')
        require(x.dtype == np.float32 and x.shape == (count, 3, 250)
                and timing.shape == (count, 2) and y.shape == (count, 2)
                and subjects.shape == (count,), 'Unexpected ' + split + ' cache shape.')
        require(np.isfinite(x).all() and np.isfinite(timing).all() and np.isfinite(y).all(), 'Nonfinite cache values.')
        if split == 'train':
            baselines = {'train_mean': y.mean(axis=0), 'train_median': np.median(y, axis=0)}
        x = (x - cm) / cs
        timing = (timing - tm) / ts
        datasets[split] = scope['BloodPressureDataset'](
            x, y[:, 0], y[:, 1], timing, subjects, augment=(split == 'train' and arm == 'on'))
        targets[split] = y
        del x, timing, subjects

    # Seed after all loading, identically in both arms; start from fresh weights.
    scope['set_random_seeds'](manifest['seed'])
    sampler = scope['SubjectStratifiedSampler'](datasets['train'].subject_ids,
                                               manifest['beats_per_subject_per_epoch'])
    common = {'batch_size': manifest['batch_size'], 'num_workers': 4, 'pin_memory': True}
    loaders = {
        'train': torch.utils.data.DataLoader(datasets['train'], sampler=sampler, **common),
        'val': torch.utils.data.DataLoader(datasets['val'], shuffle=False, **common),
    }
    model = scope['CNNTransformerBP']()
    initial_hash = state_digest(model)
    write_json(out / 'run_manifest.json', {
        'arm': arm, 'seed': manifest['seed'], 'initial_model_sha256': initial_hash,
        'cache_sha256': manifest['cache_sha256'], 'source_sha256': manifest['source_sha256'],
        'torch': str(torch.__version__), 'numpy': np.__version__,
        'slurm_job_id': os.environ.get('SLURM_JOB_ID'),
    })
    print('Initial model digest:', initial_hash, flush=True)
    checkpoint = out / 'best_model.pth'
    class CheckedTrainer(scope['Trainer']):
        def _run_epoch(self, *args, **kwargs):
            values = super()._run_epoch(*args, **kwargs)
            require(np.isfinite(values).all(), 'Training/evaluation produced a nonfinite loss or MAE.')
            return values

    trainer = CheckedTrainer(model, loaders['train'], loaders['val'],
                               epochs=manifest['epochs'], lr=manifest['lr'],
                               save_path=str(checkpoint), patience=manifest['patience'],
                               warmup_epochs=10)
    trainer.train_model(grad_clip=4.0)
    require(checkpoint.exists() and trainer.best_epoch > 0, 'Training produced no valid best checkpoint.')
    require(np.isfinite(trainer.train_losses).all() and np.isfinite(trainer.val_losses).all(), 'Nonfinite training history.')
    model.load_state_dict(torch.load(checkpoint, map_location=device, weights_only=True), strict=True)
    sp, dp, sy, dy, _ = scope['predict'](model, loaders['val'], device)
    pred, target = np.column_stack([sp, dp]), np.column_stack([sy, dy])
    np.testing.assert_array_equal(target, targets['val'])
    report = {
        'arm': arm, 'seed': manifest['seed'], 'initial_model_sha256': initial_hash,
        'best_epoch': trainer.best_epoch, 'epochs_completed': len(trainer.train_losses),
        'validation_count': len(target), 'model': metric(pred, target, np),
        'baselines': {k: metric(np.broadcast_to(v, target.shape), target, np) for k, v in baselines.items()},
        'checkpoint_sha256': sha256(checkpoint), 'cache_sha256': manifest['cache_sha256'],
        'scope': 'Validation only. This ablation changes the whole augmentation pipeline; it does not isolate one operation.',
    }
    write_json(out / 'validation_report.json', report)
    history = {k: getattr(trainer, k) for k in ('train_losses', 'val_losses', 'train_sbp_maes',
                                              'val_sbp_maes', 'train_dbp_maes', 'val_dbp_maes')}
    write_json(out / 'training_history.json', history)
    settings['model_sha256'] = report['checkpoint_sha256']
    settings['cache_checkpoint_pairing_verified'] = True
    settings['training_run'] = {'experiment': folder.name, 'arm': arm, 'seed': manifest['seed'],
                                'source_sha256': manifest['source_sha256']}
    write_json(out / 'normalization.json', settings)
    print('\nARM COMPLETE:', arm, 'best epoch:', trainer.best_epoch, flush=True)
    print(json.dumps(report, indent=2), flush=True)
    print('Results:', out, flush=True)


def summary(folder):
    manifest = json.loads((folder / 'experiment.json').read_text())
    reports = {}
    for arm in manifest['arms']:
        path = folder / ('augmentation_' + arm) / 'validation_report.json'
        if path.exists():
            reports[arm] = json.loads(path.read_text())
        else:
            print('No completed report for augmentation', arm, '(pending, running, or failed).')
    if not reports:
        print('Check squeue and the cbp_aug job logs in', Path(manifest['base_dir']) / 'logs')
        return
    print('\nVALIDATION COMPARISON — MAE in mmHg; lower is better')
    print('{:<26} {:>9} {:>9} {:>9} {:>9} {:>9} {:>9}'.format(
        'Method', 'SBP MAE', 'DBP MAE', 'SBP r', 'DBP r', 'SBP SD', 'DBP SD'))
    first = next(iter(reports.values()))
    rows = [(name + ' baseline', scores) for name, scores in first['baselines'].items()]
    rows += [('augmentation ' + arm, report['model']) for arm, report in reports.items()]
    for name, scores in rows:
        a, b = scores['SBP'], scores['DBP']
        correlations = ['n/a' if x['correlation'] is None else '{:.4f}'.format(x['correlation']) for x in (a, b)]
        print('{:<26} {:>9.4f} {:>9.4f} {:>9} {:>9} {:>9.3f} {:>9.3f}'.format(
            name, a['mae'], b['mae'], *correlations, a['prediction_sd'], b['prediction_sd']))
    for arm, report in reports.items():
        print('Augmentation', arm, 'best epoch:', report['best_epoch'],
              'epochs completed:', report['epochs_completed'])
    if len(reports) == 2:
        require(reports['on']['initial_model_sha256'] == reports['off']['initial_model_sha256'],
                'Arms did not start with identical weights; do not treat as a controlled comparison.')
        require(reports['on']['cache_sha256'] == reports['off']['cache_sha256'], 'Cache mismatch between arms.')
        print('Identical starting weights and cache hashes: confirmed.')
    print('Compare both outputs and correlations. A single-seed ablation is diagnostic, not a final model validation.')
    print('Experiment:', folder)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--submit', action='store_true')
    mode.add_argument('--worker', action='store_true')
    mode.add_argument('--summary', action='store_true')
    parser.add_argument('--base-dir', type=Path, default=BASE)
    parser.add_argument('--experiment-dir', type=Path)
    args = parser.parse_args()
    if args.submit:
        submit(args.base_dir.resolve())
    else:
        require(args.experiment_dir is not None, '--experiment-dir is required for this mode.')
        if args.worker:
            run_worker(args.experiment_dir.resolve())
        else:
            summary(args.experiment_dir.resolve())


if __name__ == '__main__':
    main()
