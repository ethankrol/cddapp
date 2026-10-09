"""Controller regression checks; all scheduler submissions are mocked."""
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


class SchedulerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        for name in ('experiment.py', 'prepare.py', 'features.py', 'train.py', 'anyppg_probe.py'):
            (self.source / name).write_text('# synthetic source snapshot\n')
        (self.source / 'README.md').write_text('Synthetic controller fixture\n')
        (self.source / 'tests').mkdir()
        (self.source / 'tests/test_placeholder.py').write_text('# test\n')
        self.base = self.root / 'base'
        for name in ('ppg', 'labels'):
            (self.base / 'mimic_bp' / name).mkdir(parents=True)
        for name in ('train', 'val'):
            (self.base / 'mimic_bp' / (name + '_subjects.txt')).write_text(name + '\n')

    def submitted(self, anyppg=True):
        calls = []
        def fake_run(command, **kwargs):
            calls.append((command, kwargs))
            return subprocess.CompletedProcess(command, 0, str(1000 + len(calls)) + ';cluster\n', '')
        with mock.patch.object(e.shutil, 'which', return_value='/fake/sbatch'), \
             mock.patch.object(e.subprocess, 'run', side_effect=fake_run), redirect_stdout(io.StringIO()):
            folder = e.submit(self.base, anyppg, here=self.source)
        return folder, calls

    def prepared(self, folder):
        manifest = {'schema_version': 1, 'complete': True, 'arms': e.ARMS,
                    'label_contract': e.LABEL_CONTRACT, 'identity_contract': e.IDENTITY_CONTRACT,
                    'arrays': {f'{kind}_{split}.npy': {'sha256': kind + split}
                               for split in ('train', 'val') for kind in ('y', 'row', 'patient')}}
        (folder / 'data').mkdir(exist_ok=True)
        e.write_json(folder / 'data/manifest.json', manifest)
        e.write_json(folder / 'prepared_complete.json', {'complete': True,
            'experiment_sha256': e.sha256(folder / 'experiment.json'),
            'preparation_manifest_sha256': e.sha256(folder / 'data/manifest.json')})
        e.write_json(folder / 'dependency_report.json', {'lightgbm': {'available': True}, 'anyppg': {'available': True}})
        return manifest

    def valid_report(self, folder, task):
        data = json.loads((folder / 'data/manifest.json').read_text())
        source = 'anyppg_probe.py' if task['model'] == 'anyppg' else 'train.py'
        outputs = {'SBP': {'mae': 10.0, 'patient_macro_mae': 10.5}, 'DBP': {'mae': 5.0, 'patient_macro_mae': 5.5}}
        return {'schema_version': 1, 'complete': True, 'status': 'complete', **task,
                'model': 'anyppg_frozen_ridge' if task['model'] == 'anyppg' else task['model'],
                'source_sha256': e.sha256(folder / 'runtime' / source), 'lightgbm': '4.6.0',
                'label_contract': e.LABEL_CONTRACT, 'identity_contract': e.IDENTITY_CONTRACT,
                'input_fingerprints': {'manifest_sha256': e.sha256(folder / 'data/manifest.json'),
                    'arrays': {name: desc['sha256'] for name, desc in data['arrays'].items()}},
                'metrics': {'val': {'outputs': outputs}},
                'baselines': {name: {'val': {'outputs': {'SBP': {'mae': 14.0}, 'DBP': {'mae': 9.0}}}}
                              for name in ('train_mean', 'train_median')},
                'initial_model_sha256': 'initial-' + str(task['seed']), 'epoch_order_sha256': ['epoch1', 'epoch2']}

    def store_report(self, folder, task, report):
        target = e.task_output(folder, task)
        target.mkdir(parents=True, exist_ok=True)
        e.write_json(target / 'report.json', report)

    def summarize(self, folder):
        with redirect_stdout(io.StringIO()):
            return e.summarize(folder)

    def test_preview_is_read_only_and_never_submits(self):
        before = set(self.root.rglob('*'))
        with mock.patch.object(e.subprocess, 'run') as run, redirect_stdout(io.StringIO()):
            plan = e.submit(self.base, preview=True, here=self.source)
        self.assertEqual(len(plan['tasks']), 25)
        self.assertIn('--array=0-12%2', plan['jobs']['gpu'])
        self.assertIn('--array=0-11%2', plan['jobs']['cpu'])
        self.assertEqual(before, set(self.root.rglob('*')))
        run.assert_not_called()

    def test_submission_dependencies_caps_and_snapshot(self):
        folder, calls = self.submitted()
        self.assertEqual(len(calls), 4)
        self.assertIn('--dependency=afterok:1001', calls[1][0])
        self.assertIn('--dependency=afterok:1001', calls[2][0])
        self.assertIn('--dependency=afterany:1001:1002:1003', calls[3][0])
        self.assertIn('--array=0-12%2', calls[1][0])
        self.assertIn('--time=01:00:00', calls[1][0])
        self.assertIn('--kill-on-invalid-dep=yes', calls[2][0])
        self.assertEqual(e.verify_runtime(folder)['tasks'], e.declared_tasks())
        (folder / 'runtime/train.py').write_text('# changed\n')
        with self.assertRaisesRegex(ValueError, 'Runtime source changed'):
            e.verify_runtime(folder)

    def test_skip_encoder_has_24_runs(self):
        folder, calls = self.submitted(False)
        self.assertEqual(len(e.verify_runtime(folder)['tasks']), 24)
        self.assertIn('--array=0-11%2', calls[1][0])

    def test_partial_submission_keeps_job_receipts_and_stops(self):
        outcomes = [subprocess.CompletedProcess([], 0, '456\n', ''),
                    subprocess.CompletedProcess([], 1, '', 'QOS invalid')]
        with mock.patch.object(e.shutil, 'which', return_value='/fake/sbatch'), \
             mock.patch.object(e.subprocess, 'run', side_effect=outcomes) as run, redirect_stdout(io.StringIO()), \
             self.assertRaisesRegex(ValueError, 'sbatch failed'):
            e.submit(self.base, here=self.source)
        folder = next((self.base / 'outputs/iphone_inference').iterdir())
        self.assertEqual(run.call_count, 2)
        failure = json.loads((folder / 'submission_failure.json').read_text())
        self.assertEqual(failure['already_submitted_jobs'], {'prepare': '456'})
        self.assertFalse(failure['automatic_resubmission'])
        self.assertEqual(json.loads((folder / 'submission_gpu.json').read_text())['stderr'], 'QOS invalid')

    def test_anyppg_worker_command_passes_real_cli_parser(self):
        import anyppg_probe
        folder, _ = self.submitted()
        self.prepared(folder)
        calls = []
        def parse_actual_command(command, **kwargs):
            calls.append(command)
            with mock.patch.object(sys, 'argv', command[2:]), \
                 mock.patch.object(anyppg_probe, 'fit', return_value={'status': 'complete'}) as fit, \
                 redirect_stdout(io.StringIO()):
                anyppg_probe.main()
            self.assertEqual(fit.call_args.args[:4], (folder / 'encoder', folder / 'data', folder / 'runs/anyppg_probe', 'cuda'))
            self.assertEqual(fit.call_args.args[-1], 45)
            return subprocess.CompletedProcess(command, 0)
        with mock.patch.dict(os.environ, {'SLURM_JOB_ID': '700', 'SLURM_ARRAY_TASK_ID': '12'}), \
             mock.patch.object(e.subprocess, 'run', side_effect=parse_actual_command):
            e.worker(folder)
        self.assertEqual(len(calls), 1)

    def test_failed_optional_dependency_is_recorded_without_launch(self):
        folder, _ = self.submitted()
        self.prepared(folder)
        e.write_json(folder / 'dependency_report.json', {'lightgbm': {'available': False, 'failure': 'offline'}})
        with mock.patch.dict(os.environ, {'SLURM_JOB_ID': '700', 'SLURM_ARRAY_TASK_ID': '0'}), \
             mock.patch.object(e.subprocess, 'run') as run, self.assertRaisesRegex(ValueError, 'dependency unavailable'):
            e.worker(folder, cpu=True)
        run.assert_not_called()
        task = [t for t in e.declared_tasks() if t['model'] == 'lightgbm'][0]
        self.assertTrue((e.task_output(folder, task) / 'controller_failure.json').is_file())

    def test_optional_dependency_failure_does_not_fail_preparation(self):
        import anyppg_probe
        folder, _ = self.submitted()
        def fake_process(command, **kwargs):
            if '--dataset-root' in command:
                self.prepared(folder)
                (folder / 'prepared_complete.json').unlink()
                return subprocess.CompletedProcess(command, 0, '', '')
            return subprocess.CompletedProcess(command, 1, '', 'offline fixture')
        with mock.patch.object(e.subprocess, 'run', side_effect=fake_process), \
             mock.patch.object(anyppg_probe, 'fetch_encoder', side_effect=OSError('offline fixture')), \
             redirect_stdout(io.StringIO()):
            e.prepare(folder)
        complete = json.loads((folder / 'prepared_complete.json').read_text())
        self.assertTrue(complete['complete'])
        self.assertFalse(complete['dependencies']['lightgbm']['available'])
        self.assertFalse(complete['dependencies']['anyppg']['available'])
        e.verified_preparation(folder, e.verify_runtime(folder))

    def test_summary_retains_failed_missing_corrupt_and_partial_runs(self):
        folder, _ = self.submitted()
        self.prepared(folder)
        tasks = e.declared_tasks()
        # One complete three-seed group, plus one incomplete group.
        for task in tasks:
            if task['model'] == 'cnn' and task['arm'] == 'raw':
                self.store_report(folder, task, self.valid_report(folder, task))
        self.store_report(folder, tasks[1], {'complete': False, 'status': 'time_limit', 'failure': 'budget'})
        bad = self.valid_report(folder, tasks[2])
        bad['input_fingerprints']['arrays']['row_val.npy'] = 'wrong rows'
        self.store_report(folder, tasks[2], bad)
        self.store_report(folder, tasks[-1], self.valid_report(folder, tasks[-1]))
        broken = e.task_output(folder, tasks[12])
        broken.mkdir(parents=True)
        (broken / 'controller_failure.json').write_text('{broken')
        result = self.summarize(folder)
        self.assertEqual(len(result['tasks']), 25)
        self.assertFalse(result['complete'])
        self.assertEqual(result['tasks'][1]['status'], 'time_limit')
        self.assertEqual(result['tasks'][2]['status'], 'contract_error')
        self.assertEqual(result['tasks'][12]['status'], 'unreadable_failure')
        self.assertTrue(result['tasks'][-1]['complete'])
        self.assertIsNone(result['three_seed_summary']['cnn/legacy_kalman']['validation'])
        self.assertEqual(result['three_seed_summary']['cnn/raw']['validation']['SBP']['mean_MAE'], 10.0)
        self.assertEqual(result['validation_baselines']['train_mean']['SBP'], 14.0)
        self.assertEqual(len((folder / 'summary.csv').read_text().splitlines()), 26)

    def test_summary_rejects_changed_worker_source_baseline_and_pairing(self):
        folder, _ = self.submitted(False)
        self.prepared(folder)
        tasks = e.declared_tasks(False)
        for task in tasks:
            report = self.valid_report(folder, task)
            if task == tasks[1]:
                report['initial_model_sha256'] = 'unexpected initial weights'
            if task == tasks[2]:
                report['baselines']['train_mean']['val']['outputs']['SBP']['mae'] += 1
            if task == tasks[12]:
                report['source_sha256'] = 'other code'
            self.store_report(folder, task, report)
        result = self.summarize(folder)
        self.assertFalse(result['comparison_contract_passed'])
        self.assertFalse(result['complete'])
        self.assertFalse(result['cnn_pair_checks']['125']['initial_weights_match'])
        self.assertEqual(result['tasks'][12]['status'], 'contract_error')
        messages = ' '.join(result['contract_errors'])
        self.assertIn('Worker source differs', messages)
        self.assertIn('baselines differ', messages)
        self.assertIn('initialization/order mismatch', messages)

    def test_summary_without_preparation_preserves_all_rows(self):
        folder, _ = self.submitted()
        result = self.summarize(folder)
        self.assertEqual(len(result['tasks']), 25)
        self.assertFalse(result['complete'])
        self.assertTrue(result['contract_errors'])
        self.assertIsNone(result['validation_baselines'])


if __name__ == '__main__':
    unittest.main()
