# Optional AnyPPG experiment, explained simply

AnyPPG is a published model that has already learned patterns from large collections of pulse signals. Here we use it as a **pattern reader**: it turns a recording into a list of numbers, then a small regression model learns how those numbers relate to the two blood-pressure targets.

This is an additional research candidate. It does not replace the model in the iPhone app, and it is not a reproduction of the paper's blood-pressure benchmark.

## What this experiment does

1. Start with the same accepted 30-second recordings and original recording-level labels used by the new CNN and LightGBM experiments. Use only training and validation data.
2. Split each recording into three consecutive 10-second pieces. At 125 samples per second, each piece contains 1,250 values.
3. Standardize each piece: subtract its average and divide by its standard deviation plus `1e-8`. This follows the author's time-axis normalization recommendation. It changes scale; it does not remove motion artifacts or certify signal quality.
4. Run the unchanged pretrained encoder on each piece. Each produces 512 features. Average the three feature lists to obtain one list for the original recording.
5. Fit a **ridge regression** model: a weighted sum of those features, with a penalty that discourages excessively large weights. Its feature standardization, coefficients, and intercept are fitted on training recordings only.
6. Try the four predeclared penalties `0.1, 1, 10, 100`. Select the one with the lowest average of validation SBP and DBP absolute error. Keep all four trial results in the report. Exact ties select the first penalty.

The encoder stays frozen: its original weights do not change. There is one exploratory run, rather than three training seeds, because the frozen encoder and closed-form regression do not use random training initialization. No extra filter is applied in this arm. Its results therefore compare the complete method, not only the encoder architecture.

The code uses one label pair per original recording. It does not copy that label into three supposedly independent evaluation examples. Patient-level average errors and recording-level errors are both reported.

## Important comparison limitation

The paper includes PulseDB, whose sources include MIMIC-III, in its pretraining data. Our dataset is also MIMIC-derived. We have not established whether any of our patients were seen during that earlier pretraining. The training/validation split of this experiment is disjoint, but that alone cannot resolve overlap with an external pretrained model.

For that reason, the summary labels this arm **exploratory** and keeps it separate from the three-seed, newly trained model comparison. A lower error would be a useful lead, not proof that AnyPPG works better on completely unseen patients. Recording-label meaning also remains uncertified. Compare results within the new recording-level experiment; its labels and evaluation unit differ from the earlier beat-level benchmark.

## Reproducibility and failure behavior

- The source is pinned to commit `661b877aa96eac3bba320a462cb2a3bfea991103` of the [author-linked repository](https://github.com/PKUDigitalHealth/AnyPPG/tree/661b877aa96eac3bba320a462cb2a3bfea991103).
- Only `load_anyppg/resnet1d.py` and `load_anyppg/anyppg_ckpt.pth` are downloaded. Both must match the SHA-256 values recorded in `anyppg_probe.py`. SHA-256 is a file fingerprint: changing the contents changes the fingerprint.
- The checkpoint is loaded with `weights_only=True` and strict weight-name/shape matching. The encoder runs in evaluation mode with gradients disabled.
- Prepared array hashes, shapes, patient identities, recording identities, and source hashes are checked. Existing results are never overwritten.
- Empty, non-finite, or constant chunks fail the arm. They are not quietly removed to produce a more favorable score or a different evaluation cohort.
- The worker has a maximum 45-minute software budget. Timeouts and errors remain visible as incomplete results; partial runs do not become successful benchmark entries.
- Outputs include `report.json`, `ridge_probe.npz`, and private train/validation prediction files. The prediction files contain aligned numeric patient/recording identifiers and targets. Keep them on HiPerGator; share aggregate reports instead.

The default experiment launcher includes this optional GPU task. Use `--skip-anyppg` to run the newly trained CNN/LightGBM comparisons without it. The launcher downloads the two pinned files during preparation; no source or weights are added to the mobile app.

## Checks completed before submitting patient-data jobs

On the development host, all seven protocol tests passed with no skips when the actual pinned checkpoint was supplied. They covered a real encoder-plus-ridge run on four synthetic training recordings and two synthetic validation recordings, input tampering, patient overlap, normalization, a hand-solvable regression example, saved metric reproduction, and timeout reporting.

A separate CPU smoke test loaded the actual 4,044,272-parameter encoder from its 16,375,441-byte checkpoint. Three synthetic 10-second inputs produced finite features, and repeating the recording gave exactly the same output. That check used Python 3.12.14, PyTorch 2.8.0+cpu, and NumPy 2.3.5. These checks establish that the code runs; they do not establish blood-pressure accuracy, GPU performance, or iPhone compatibility.

For a standalone synthetic check after the pinned files have been fetched:

```bash
python3 anyppg_probe.py \
  --source-dir /path/to/encoder \
  --smoke --threads 2 \
  --output-dir /path/to/new-smoke-result
```

For the actual prepared recording arrays, the launcher invokes the equivalent of:

```bash
python3 anyppg_probe.py \
  --source-dir /path/to/encoder \
  --data-dir /path/to/experiment/data \
  --output-dir /path/to/new-probe-result \
  --device cuda --minutes 45
```

## Primary sources

- [AnyPPG paper, version 3](https://arxiv.org/html/2511.01747v3): pretrained model, dataset provenance, and original evaluation design.
- [Pinned author repository README](https://github.com/PKUDigitalHealth/AnyPPG/blob/661b877aa96eac3bba320a462cb2a3bfea991103/README.md): 125 Hz input contract, time-axis normalization, encoder configuration, feature output, and frozen-model usage.

The three-chunk averaging, ridge penalties, recording-level target, and local selection rule above are our declared experiment choices. They should not be presented as the paper's exact protocol.
