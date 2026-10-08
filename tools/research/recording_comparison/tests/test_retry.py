"""Retry orchestration with synthetic metadata and mocked Slurm/GPU calls.

No scheduler or GPU is contacted by these tests. Numeric CPU checks live in
 test_pooling.py; the submitted preflight performs the real CUDA check.
"""
from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
import experiment as e
import retry_cnn as r


class RetryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.parent = self.root / 'original'
        (self.parent / 'runtime').mkdir(parents=True)
        (self.parent / 'data').mkdir()
        sources = {}
        for name, content in [('train.py', '# original synthetic worker\n'),
                              ('anyppg_probe.py', '# original synthetic encoder\n'),
                              ('experiment.py', (HERE / 'experiment.py').read_text())]:
            path = self.parent / 'runtime' / name
            path.write_text(content)
            sources[name] = e.sha256(path)
        patcher = mock.patch.object(r, 'OLD_SOURCES', sources)
        patcher.start()
        self.addCleanup(patcher.stop)
        e.write_json(self.parent / 'experiment.json', {'schema_version': 1, 'config': e.CONFIG,
            'include_anyppg': True, 'tasks': e.declared_tasks(), 'package_sha256': sources,
            'label_contract': e.LABEL_CONTRACT, 'identity_contract': e.IDENTITY_CONTRACT})
        arrays = {}
        for split in ('train', 'val'):
            names = [f'{kind}_{split}.npy' for kind in ('y', 'row', 'patient')]
            names += [f'{kind}_{arm}_{split}.npy' for kind in ('X', 'feature') for arm in e.ARMS]
            for name in names:
                path = self.parent / 'data' / name
                path.write_bytes(('synthetic bytes for hash checking: ' + name).encode())
                arrays[name] = {'sha256': e.sha256(path)}
        self.prep = {'schema_version': 1, 'complete': True, 'arrays': arrays, 'arms': e.ARMS,
                     'label_contract': e.LABEL_CONTRACT, 'identity_contract': e.IDENTITY_CONTRACT}
        e.write_json(self.parent / 'data/manifest.json', self.prep)
        self.prep_hash = e.sha256(self.parent / 'data/manifest.json')
        e.write_json(self.parent / 'prepared_complete.json', {'complete': True,
            'experiment_sha256': e.sha256(self.parent / 'experiment.json'),
            'preparation_manifest_sha256': self.prep_hash})
        for task in e.declared_tasks():
            if task['model'] == 'cnn':
                report = {**task, 'schema_version': 1, 'complete': False, 'status': 'failed',
                    'source_sha256': sources['train.py'], 'failure': 'RuntimeError: ' + r.FAILURE,
                    'epochs_completed': None, 'selected_epoch': None,
                    'initial_model_sha256': 'initial-' + str(task['seed']),
                    'epoch_order_sha256': ['epoch1']}
            else:
                report = self.completed(task, sources['anyppg_probe.py' if task['model'] == 'anyppg' else 'train.py'])
            path = self.parent / r.report_name(task)
            path.parent.mkdir(parents=True, exist_ok=True)
            e.write_json(path, report)
        self.original_hashes = {str(p.relative_to(self.parent)): e.sha256(p) for p in self.parent.rglob('*') if p.is_file()}

    def completed(self, task, source):
        return {'schema_version': 1, 'complete': True, 'status': 'complete', **task,
            'model': 'anyppg_frozen_ridge' if task['model'] == 'anyppg' else task['model'],
            'source_sha256': source, 'lightgbm': '4.6.0', 'device': 'cuda',
            'label_contract': e.LABEL_CONTRACT, 'identity_contract': e.IDENTITY_CONTRACT,
            'preparation_manifest_sha256': self.prep_hash,
            'input_fingerprints': {'manifest_sha256': self.prep_hash,
                'arrays': {n: d['sha256'] for n, d in self.prep['arrays'].items()}},
            'metrics': {'val': {'outputs': {'SBP': {'mae': 13.}, 'DBP': {'mae': 8.}}}},
            'baselines': {n: {'val': {'outputs': {'SBP': {'mae': 14.}, 'DBP': {'mae': 9.}}}}
                          for n in ('train_mean', 'train_median')},
            'recipe': {'pooling_implementation': r.POOLING, 'deterministic_algorithms': True},
            'initial_model_sha256': 'initial-' + str(task['seed']), 'epoch_order_sha256': ['epoch1', 'epoch2']}

    def submitted(self):
        calls = []
        def fake(command, **kwargs):
            calls.append((command, kwargs))
            return subprocess.CompletedProcess(command, 0, str(1100 + len(calls)) + '\n', '')
        with mock.patch.object(r.shutil, 'which', return_value='/mock/sbatch'), \
             mock.patch.object(e.subprocess, 'run', side_effect=fake), redirect_stdout(io.StringIO()):
            folder = r.submit(self.parent, here=HERE)
        return folder, calls

    def gate(self, folder, passed=True):
        m = r.read(folder / 'retry.json')
        gate = {'passed': passed, 'complete': passed, 'device': 'cuda',
                'retry_manifest_sha256': e.sha256(folder / 'retry.json'),
                'train_sha256': m['runtime_sha256']['train.py'],
                'source_sha256': m['runtime_sha256']['pooling_preflight.py'],
                'data_hashes_verified': True, 'repeated_training_exact': True}
        e.write_json(folder / 'preflight.json', gate)

    def summary(self, folder):
        with redirect_stdout(io.StringIO()):
            return r.summarize(folder)

    def test_preview_writes_nothing(self):
        before = list(self.root.rglob('*'))
        with mock.patch.object(e.subprocess, 'run') as run, redirect_stdout(io.StringIO()):
            result = r.submit(self.parent, preview=True, here=HERE)
        self.assertEqual(result['retry_count'], 12)
        self.assertEqual(result['carried_complete_count'], 13)
        self.assertEqual(before, list(self.root.rglob('*')))
        run.assert_not_called()

    def test_submits_only_gpu_gate_cnn_array_and_summary(self):
        folder, calls = self.submitted()
        self.assertEqual(len(calls), 3)
        self.assertIn('--dependency=afterok:1101', calls[1][0])
        self.assertIn('--array=0-11%2', calls[1][0])
        self.assertIn('--kill-on-invalid-dep=yes', calls[1][0])
        self.assertIn('--dependency=afterany:1101:1102', calls[2][0])
        self.assertIn('--preflight', calls[0][1]['input'])
        self.assertEqual(len(r.verify(folder)[0]['parent_report_sha256']), 25)
        self.assertEqual(self.original_hashes, {str(p.relative_to(self.parent)): e.sha256(p) for p in self.parent.rglob('*') if p.is_file()})

    def test_refuses_other_failure_or_already_trained(self):
        path = self.parent / r.report_name(e.declared_tasks()[0])
        report = r.read(path)
        for change in ({'failure': 'out of memory'}, {'epochs_completed': 1}, {'status': 'complete'}):
            e.write_json(path, {**report, **change})
            with self.assertRaisesRegex(ValueError, 'pre-epoch pooling failure'):
                r.check_parent(self.parent)

    def test_partial_submission_preserves_receipts(self):
        results = [subprocess.CompletedProcess([], 0, '234\n', ''), subprocess.CompletedProcess([], 1, '', 'quota')]
        with mock.patch.object(r.shutil, 'which', return_value='/mock/sbatch'), \
             mock.patch.object(e.subprocess, 'run', side_effect=results) as run, \
             redirect_stdout(io.StringIO()), self.assertRaisesRegex(ValueError, 'sbatch failed'):
            r.submit(self.parent, here=HERE)
        self.assertEqual(run.call_count, 2)
        folder = next(self.root.glob('recording_cnn_retry_*'))
        failure = r.read(folder / 'submission_failure.json')
        self.assertEqual(failure['already_submitted_jobs'], {'preflight': '234'})
        self.assertFalse(failure['automatic_resubmission'])

    def test_worker_refuses_failed_or_mismatched_gate(self):
        folder, _ = self.submitted()
        self.gate(folder, False)
        with mock.patch.object(r.subprocess, 'run') as run, self.assertRaisesRegex(ValueError, 'successful CUDA'):
            r.worker(folder)
        run.assert_not_called()
        self.gate(folder)
        gate = r.read(folder / 'preflight.json')
        gate['train_sha256'] = 'wrong'
        e.write_json(folder / 'preflight.json', gate)
        with self.assertRaisesRegex(ValueError, 'does not match'):
            r.worker(folder)

    def test_worker_reads_parent_and_never_allows_cpu(self):
        folder, _ = self.submitted()
        self.gate(folder)
        with mock.patch.dict(os.environ, {'SLURM_JOB_ID': '11', 'SLURM_ARRAY_TASK_ID': '11'}), \
             mock.patch.object(r.subprocess, 'run') as run:
            r.worker(folder)
        command = run.call_args.args[0]
        self.assertEqual(command[command.index('--data-dir') + 1], str(self.parent / 'data'))
        self.assertEqual(command[command.index('--seed') + 1], '127')
        self.assertEqual(command[command.index('--arm') + 1], 'bandpass_offline')
        self.assertNotIn('--allow-cpu', command)

    def test_summary_preserves_13_sources_12_failures_and_no_partial_means(self):
        folder, _ = self.submitted()
        result = self.summary(folder)
        self.assertEqual(len(result['tasks']), 25)
        self.assertEqual(sum(t['complete'] for t in result['tasks']), 13)
        self.assertEqual(len(result['parent_attempts']), 12)
        self.assertEqual(result['contract_errors'], [])
        self.assertFalse(result['complete'])
        self.assertIsNone(result['three_seed_summary']['cnn/raw']['validation'])
        self.assertIsNotNone(result['three_seed_summary']['lightgbm/raw']['validation'])
        for name, digest in self.original_hashes.items():
            self.assertEqual(e.sha256(self.parent / name), digest)

    def test_combined_complete_checks_pairing_and_retains_both_source_versions(self):
        folder, _ = self.submitted()
        self.gate(folder)
        m = r.read(folder / 'retry.json')
        for task in m['retry_tasks']:
            path = folder / r.report_name(task)
            path.parent.mkdir(parents=True)
            e.write_json(path, self.completed(task, m['runtime_sha256']['train.py']))
        result = self.summary(folder)
        self.assertTrue(result['complete'], result['contract_errors'])
        self.assertTrue(all(result['cnn_pair_checks'].values()))
        self.assertEqual(len(result['tasks']), 25)
        path = folder / r.report_name(m['retry_tasks'][0])
        report = r.read(path)
        report['initial_model_sha256'] = 'unexpected'
        e.write_json(path, report)
        result = self.summary(folder)
        self.assertFalse(result['complete'])
        self.assertTrue(result['contract_errors'])

    def test_tampering_with_success_report_is_rejected(self):
        folder, _ = self.submitted()
        task = [t for t in e.declared_tasks() if t['model'] == 'lightgbm'][0]
        path = folder / 'parent_reports' / r.report_name(task)
        path.write_text('{}')
        with self.assertRaisesRegex(ValueError, 'Archived original report changed'):
            r.verify(folder)

    def test_gpu_gate_hashes_arrays_before_cuda_and_records_failure(self):
        import pooling_preflight
        folder, _ = self.submitted()
        (self.parent / 'data/X_raw_train.npy').write_bytes(b'tampered')
        with mock.patch.dict(os.environ, {'SLURM_JOB_ID': 'gate'}), \
             mock.patch.object(pooling_preflight, 'run_preflight') as run, \
             redirect_stdout(io.StringIO()), self.assertRaisesRegex(ValueError, 'GPU preflight failed'):
            r.preflight(folder)
        run.assert_not_called()
        self.assertFalse(r.read(folder / 'preflight.json')['passed'])

    def test_gpu_gate_calls_real_interface_with_cuda_and_batch64(self):
        import pooling_preflight
        folder, _ = self.submitted()
        m = r.read(folder / 'retry.json')
        synthetic_gpu_result = {'passed': True, 'device': 'cuda', 'repeated_training_exact': True,
            'source_sha256': m['runtime_sha256']['pooling_preflight.py'], 'train_sha256': m['runtime_sha256']['train.py']}
        with mock.patch.dict(os.environ, {'SLURM_JOB_ID': 'gate'}), \
             mock.patch.object(pooling_preflight, 'run_preflight', return_value=synthetic_gpu_result) as run, \
             redirect_stdout(io.StringIO()):
            r.preflight(folder)
        run.assert_called_once_with(device='cuda', batch_size=64)
        r.validate_gate(folder, m)
        self.assertEqual(r.read(folder / 'preflight.json')['array_count_verified'], 22)


if __name__ == '__main__':
    unittest.main()
