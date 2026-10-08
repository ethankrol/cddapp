"""Actual subprocess handoff from preparation to workers to aggregate report."""
from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

import numpy as np

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
import experiment as e


class PipelineIntegration(unittest.TestCase):
    @unittest.skipUnless(os.environ.get('CDD_ANYPPG_ENCODER'), 'Set CDD_ANYPPG_ENCODER for full actual-worker handoff.')
    def test_actual_preparation_workers_and_summary(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / 'experiment'
            folder.mkdir()
            runtime = folder / 'runtime'
            hashes = e.package_files(HERE)
            for name in hashes:
                dest = runtime / name
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(HERE / name, dest)
            source = Path(tmp) / 'synthetic-source'
            (source / 'ppg').mkdir(parents=True)
            (source / 'labels').mkdir()
            clock = np.arange(3750) / 125
            for split, names in (('train', ['p9001', 'p9002']), ('val', ['p9003', 'p9004'])):
                (source / (split + '_subjects.txt')).write_text('\n'.join(names) + '\n')
                for k, name in enumerate(names):
                    x = np.full((30, 3750), np.nan, dtype=np.float32)
                    y = np.full((30, 2), np.nan, dtype=np.float32)
                    for i in range(2):
                        x[i] = np.sin(2 * np.pi * (1.1 + .1 * k + .03 * i) * clock)
                        y[i] = [115 + 3 * k + i, 65 + k + i]
                    np.save(source / 'ppg' / (name + '_ppg.npy'), x)
                    np.save(source / 'labels' / (name + '_labels.npy'), y)
            e.write_json(folder / 'experiment.json', {
                'schema_version': 1, 'config': e.CONFIG, 'tasks': e.declared_tasks(),
                'include_anyppg': True, 'package_sha256': hashes,
                'label_contract': e.LABEL_CONTRACT, 'identity_contract': e.IDENTITY_CONTRACT})

            def run(script, *args):
                result = subprocess.run([sys.executable, str(runtime / script), *map(str, args)],
                                        capture_output=True, text=True, timeout=120)
                self.assertEqual(result.returncode, 0, result.stdout[-2000:] + result.stderr[-3000:])

            run('prepare.py', '--dataset-root', source, '--output-dir', folder / 'data', '--synthetic')
            e.write_json(folder / 'prepared_complete.json', {
                'complete': True, 'experiment_sha256': e.sha256(folder / 'experiment.json'),
                'preparation_manifest_sha256': e.sha256(folder / 'data/manifest.json')})
            for model in ('cnn', 'lightgbm'):
                task = {'model': model, 'arm': 'raw', 'seed': 125}
                run('train.py', '--data-dir', folder / 'data', '--output-dir', e.task_output(folder, task),
                    '--arm', 'raw', '--model', model, '--seed', 125, '--minutes', 2,
                    '--allow-cpu', '--max-epochs', 2, '--patience', 1)
            run('anyppg_probe.py', '--data-dir', folder / 'data', '--source-dir', os.environ['CDD_ANYPPG_ENCODER'],
                '--output-dir', folder / 'runs/anyppg_probe', '--device', 'cpu', '--threads', 2, '--minutes', 2)
            run('experiment.py', '--summary', '--experiment-dir', folder)
            report = json.loads((folder / 'summary.json').read_text())
            self.assertEqual(report['contract_errors'], [])
            self.assertEqual(len(report['tasks']), 25)
            self.assertEqual(sum(r['complete'] for r in report['tasks']), 3)
            self.assertEqual(sum(r['status'] == 'missing' for r in report['tasks']), 22)
            self.assertFalse(report['complete'])
            self.assertTrue(all(v['validation'] is None for v in report['three_seed_summary'].values()))
            self.assertIsNotNone(report['validation_baselines'])


if __name__ == '__main__':
    unittest.main()
