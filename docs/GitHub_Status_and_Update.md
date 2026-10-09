# GitHub status and the next update

Checked September 27, 2026 against `ethankrol/cddapp`, branch `rithika-ML`, commit `2bd3424767acb67aece47fa2fddb7cfcd21b4fae` (`testing`). This is an inspection of that branch, not a claim that `main` contains the same work. GitHub can change after this check.

## Is the correct model on GitHub?

**Yes: the original model that passed the iPhone tests is present, and its actual bytes match.** The repository was downloaded and the file fingerprints were calculated, rather than relying only on file names or the export report.

| File | What it is | SHA-256 |
|---|---|---|
| `python code/cBP-Tnet_Model.pth` | Original trained PyTorch weights, 20,925,411 bytes | `2cabfe0c64bf2463495d9581dea837638c41c149948abd9730b8b6be25fd0169` |
| `assets/models/onnx_export/cbp_tnet.onnx` | Converted model actually used by the phone, 20,979,327 bytes | `a8e26e25b852344814e4a474e73e92b9f8d40845c20948fdcce828c9e4f12fce` |
| `assets/models/onnx_export/normalization.json` | Numbers used to scale the model's inputs | `bc8a28b7ca84faa00644fa7d13ae706705ecd47b9543296753273555be3aba41` |

These match the export evidence and identifiers in your successful device reports. A fingerprint match confirms which file we have. It does not mean this is our most accurate possible model. The original model's saved test MAEs were 14.34 SBP / 9.53 DBP mmHg, close to simple constant baselines. Its phone tests established that the software calculations run correctly. New research checkpoints have not been deployed.

The export report still contains `iphone_runtime_tested: false` and an unverified-pairing flag from the day of export. Later audits and phone reports document subsequent work. Keep the original report intact: editing it changes a fingerprint required by the reproducible test packages.

## Is everything up to date?

**Not yet.** The checked commit contains the original smoke test, profiling, native memory probe, raw-PPG preprocessing, four-beat connected test, calibration calculation core and earlier documentation. It does not contain these later additions:

- `app/ml-ppg-expanded.tsx`, `components/BpExpandedLink.tsx` and the four `services/bpExpanded*` files.
- `assets/ppg-expanded/full_ppg_reference_v1.json` and its installation provenance.
- The expanded-test link in `app/ml-test.tsx`.
- The later all-candidate, five-minute rolling/block and twenty-minute block reports, and their updated explanation.

The checked tree does not track `node_modules`, `ios/Pods`, `iphone-test-backups`, virtual environments or Xcode user-state folders. Keep the native project and local memory module: they contain needed app integration. No files were deleted or pushed during this check.

## Update from the Mac that ran the expanded tests

Download and extract `cdd-model-benchmark.zip` into Downloads. The commands below assume the extracted folder is `~/Downloads/cdd-model-benchmark`.

First check your local model and expanded test files. This command is read-only and needs no USB:

```bash
python3 ~/Downloads/cdd-model-benchmark/check_repo.py \
  --project /Users/rithika/Desktop/cddapp
```

All listed files should say `MATCH`, and the branch should be `rithika-ML`. If it reports missing/changed files, retain the output and review the differences before staging. Do not replace models just to make this check pass. Successful checks print a precise `git add` command for the expanded phone files.

Copy the updated documentation and synthetic evidence into your repository, keeping a dated backup of the existing master document:

```bash
(
set -e
cd /Users/rithika/Desktop/cddapp
backup_dir="iphone-test-backups/docs-$(date +%Y%m%dT%H%M%S)"
mkdir -p "$backup_dir" docs/evidence/expanded-20260927
cp docs/CDD_Blood_Pressure_Engineering_Status_and_Calibration.md "$backup_dir/"
cp ~/Downloads/cdd-model-benchmark/docs/CDD_Blood_Pressure_Engineering_Status_and_Calibration.md docs/
cp ~/Downloads/cdd-model-benchmark/docs/Expanded_iPhone_Test_Results.md docs/
cp ~/Downloads/cdd-model-benchmark/docs/GitHub_Status_and_Update.md docs/
cp -R ~/Downloads/cdd-model-benchmark/docs/evidence/expanded-20260927/. docs/evidence/expanded-20260927/
git status --short
)
```

Run the `git add` command printed by the checker, then stage only these documentation changes:

```bash
cd /Users/rithika/Desktop/cddapp
git add -- docs/CDD_Blood_Pressure_Engineering_Status_and_Calibration.md \
  docs/Expanded_iPhone_Test_Results.md docs/GitHub_Status_and_Update.md \
  docs/evidence/expanded-20260927
git diff --cached --stat
git diff --cached --name-status
```

Inspect that list, including anything you had already staged. It should contain the intended test and documentation files, without private credentials or dataset recordings. When it matches:

```bash
git commit -m "Document expanded iPhone inference tests and add replay test"
git push origin rithika-ML
git rev-parse HEAD
git ls-remote origin refs/heads/rithika-ML
```

The last two commands should print the same commit hash. If push fails, keep the local commit and share the exact error; do not force-push or disable certificate checks. This updates your working branch; merging into `main` is a separate repository decision.

## The new model comparison

See the package README for the one-command HiPerGator submission. It writes new research checkpoints into a separate experiment directory. It does not modify these app models or automatically publish a candidate. A selected candidate needs a new export, matching preprocessing/scaling metadata, Python parity and phone tests before deployment.

The recovered committed training source matches SHA-256 `18658a5309d85b9875251a705d091b133fc678bfe33bdd6160d6c8f23d82597e`. The recovered saved comparison controller matches `1435d394be538b088b0581192d130ea5e39a6c9ccae3470eff27cc5c760c1a29`. Those source checks resolved the earlier request for a source ZIP; no repeat upload is needed for this benchmark.
