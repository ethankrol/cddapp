# CDD blood-pressure prediction: calibration design, inference package, and device-test report

**Project:** `ethankrol/cddapp`, working branch `rithika-ML`  
**Prepared for:** Rithika Mathew  
**Status date:** September 25, 2026, evidence through 12:18 a.m. EDT (04:18 UTC)  
**Scope:** Engineering documentation and research recommendations. Proposed features are explicitly distinguished from implemented and observed behavior.

## Start here: the project in plain English

For the shorter worked explanation, read [BP_Project_Explained_Simply.md](BP_Project_Explained_Simply.md).

- **What passed:** Rithika ran the installed app on her physical iPhone and supplied its reports. The app performed the model calculations locally and matched the saved Python results. The assistant prepared code, checked calculations and reviewed evidence; it did not remotely operate the phone.
- **Why it was fast:** the app already contained a synthetic file representing 30 seconds of PPG. It did not wait 30 seconds to collect a new recording. It found 31 candidate beats and checked/inferred the first four. The complete connected test call took about 0.166 seconds. Real acquisition would still take the selected recording duration.
- **Why it fits:** the approximately 20 MB ONNX model has a fixed size. New signal samples do not grow the model. The separate five-cycle test observed approximately 35.1 MB baseline and 72.1 MB sampled peak whole-app physical footprint. Continuous acquisition, battery use and long-session stability remain separate work.
- **Calibration:** estimate how far a person's model predictions differ from paired reference cuff readings, then add separate SBP and DBP corrections. If the average corrections are +7 and +4, a model output of 121/77 becomes 128/81. Negative corrections are subtracted. This example is fictional; a 30-day validity policy has not been validated.
- **Model identity:** the phone executes `cbp_tnet.onnx`, converted from the original `cBP-Tnet_Model.pth`. New CNN/Tnet comparison checkpoints were not automatically deployed. Exact byte fingerprints and the export report identify the matching package; matching files do not establish BP accuracy.
- **Other models:** a smaller CNN and cBP-Tnet were compared across three seeds under a shared new recipe. No benchmark of external published state-of-the-art methods has been run. The smaller CNN is a development candidate, not the current phone model.
- **Repository handoff:** inspection on September 25 found remote `rithika-ML` still at `2852dd82dff3afb5649a4be53802836f5b578606`, with the original checkpoint but without later mobile test code/assets. A guarded Mac organizer has been prepared; its execution and current local fingerprints still require the user-run report.

The two assigned documentation/mock-inference tasks meet their stated scope. Integrating actual sensor acquisition, calibration UI/storage and establishing useful real-world BP accuracy are additional tasks. The detailed historical sections below retain the limits that applied at each test stage.

## 1. Executive status

The trained cBP-Tnet model has been exported to ONNX and executed successfully on a physical iPhone. The phone’s synthetic-input predictions agree with Python within the chosen numerical tolerance. A subsequent screenshot shows another successful test in Airplane Mode. The new profiling report from September 24 at 20:02 UTC records 111/111 successful synthetic inferences in a non-development build, with no parity/runtime failures. Across 100 measured calls, mean latency was 6.187 ms and nearest-rank p95 was 7.742 ms. Two further supplied runs also passed, bringing the total to 333/333 successful calls across three runs of the same synthetic fixture. The supplied device screenshot identifies an iPhone 16 Pro running iOS 26.6.2. Run means were 6.187, 9.713 and 6.436 ms in chronological order, so the slower middle run must remain visible. A later Xcode screenshot sequence records whole-app memory of 30.6 MB before the test, a displayed high of 70.3 MB, and 58.8 MB in the image labeled ten seconds afterward. This is one observed sequence, not a repeated-cycle leak assessment. The automated five-cycle native sampler subsequently completed on the user's physical iPhone at 21:10 UTC: 555/555 inference calls passed, and the report records 1,251 memory samples with no sampling errors. Baseline footprint was 35.145 MB, largest observed sample 72.091 MB, and settled memory decreased from 70.714 MB after cycle 1 to 50.169 MB after cycle 5. This short run shows no increasing sequence of settled values; it does not establish leak freedom or a long-session memory budget. Energy and app-launch timing remain unmeasured, and the causes of latency variation remain unresolved.

The original deployed checkpoint’s predictive performance is a separate issue. Re-evaluation reproduces the original training log, but a fixed training-set mean slightly outperforms the uncalibrated model. After per-person calibration, the model adds almost no improvement over using the mean of that person’s five reference labels. That checkpoint is therefore a useful deployment demonstration, not evidence of useful cuffless BP measurement.

A training augmentation inconsistency has been identified, and the controlled augmentation-on/off experiment **43160017** has completed. With augmentation disabled, validation MAE improved from **13.9589 to 13.2848 mmHg for SBP** and **9.6288 to 8.8738 mmHg for DBP**. Correlation and prediction spread also increased. This candidate modestly beats the constant baselines, but the result is a single-seed comparison of the entire augmentation pipeline. It does not isolate the derivative-scaling issue or establish clinical accuracy. The candidate has not replaced the phone model.

The label-window audit **43161373** has also produced its report. Across 48 training/validation segments and 2,009 accepted beats, the supposed upstroke-time feature was almost always zero or clipped to its maximum. The code's peak-to-peak segmentation explains this endpoint behavior. ABP label windows frequently extended across multiple beats, but the audit does not establish that their labels are incorrect. Filter-reset effects were small in the inspected sample.

The subsequent keep-versus-mask experiment has completed. Masking the upstroke proxy changed validation MAE from **13.3956/9.0524 to 13.4363/8.8478 mmHg (SBP/DBP)**: SBP became slightly worse and DBP slightly better. This single-seed result does not establish the proxy as the main cause of poor prediction. The repeated unmasked configuration also differed from its earlier run.

The supplied selected-epoch and final-epoch training histories show late divergence in both arms: logged training errors fell while validation SBP error rose by **2.145 mmHg (keep)** and **2.559 mmHg (mask)**. This is consistent with late overfitting and supports retaining the earlier selected checkpoints. Training and validation used different modes and sampling, so their raw gap does not measure fixed-checkpoint generalization precisely.

The matching-condition audit is now complete and reproduced both validation reports. At the selected checkpoints, keep-upstroke achieved **13.3674/8.7216 mmHg on train** and **13.3956/9.0524 on validation**; mask-upstroke achieved **12.7420/8.1336 on train** and **13.4363/8.8478 on validation**. Both learn some signal, but training fit is still modest and less of the gain over constant prediction transfers to validation. Small raw train/validation gaps do not eliminate a generalization problem because baseline difficulty differs between splits. The training-only capacity probe **43223464** subsequently passed: on 128 fixed beats, best-observed MAE was **0.2588 SBP / 0.1460 DBP mmHg**, and both outputs stayed below 1 mmHg at checks 200, 250, and 300. This demonstrates small-set fitting under a simplified recipe, not accuracy on new subjects or correct physiological labeling. The first CNN-only comparison attempt failed before optimization because its guard mistook split-local numeric indices for patient identities. That guard has now been repaired and locally tested; submission checks actual current patient lists and cache structure before requesting GPUs. The historical cache-to-patient mapping remains reconstructed rather than independently certified because original list hashes were not stored. The repaired preflight passed on HiPerGator, and the user supplied completed comparison results for GPU array 43230748. CNN-only validation MAE was 13.0077/8.6517 mmHg versus 13.0071/8.6811 for cBP-Tnet. CNN-only uses 464,962 parameters versus 5,219,394 (91.1% fewer), with very similar validation errors. It is the pragmatic smaller candidate for further development, not a demonstrated accuracy winner from this single seed. In parallel, the tested calibration core and phone-profiling extension were installed on the Mac, three phone profiling reports were received, and a wearable-access memo was prepared. The original phone model remains the deployment demonstration; no comparison candidate has replaced it. The additional pairs at seeds 126 and 127 have now completed with early stopping. Across three seeds, CNN-only mean validation MAE is 13.0435/8.6337 mmHg and cBP-Tnet is 12.9911/8.6854 mmHg (SBP/DBP). Their equally weighted two-output means differ by only 0.00034 mmHg. CNN-only remains the practical smaller development architecture, without a superiority/equivalence claim or automatic phone replacement. The exact preprocessing packet has now been supplied and reviewed. A standalone PPG-only reference and read-only CPU parity audit have been implemented and passed 13 local synthetic tests. The user has now completed the recording audit: all 2,009 legacy-accepted beats from 48 sampled train/validation recordings have exact feature and timing parity. The 31 extra PPG candidates were excluded only by the legacy ABP-length gate. The full audit report and generated synthetic fixture have now been supplied and verified. A JavaScript preprocessing port matches the uploaded fixture exactly and passed 24 local numerical/installer tests, including full comparisons on 349 beats from ten synthetic signals. The installer then succeeded on the Mac, and the user supplied a passing physical-iPhone report from the Release app in Hermes: 31 candidates, matching first-four intervals, and zero differences across 3,000 channel values and eight timing values. The preprocessing call took 45.500 ms on one 30-second synthetic recording. The raw-to-features device step is complete for this fixture; the user has subsequently supplied the four-candidate Python normalization/ONNX reference. All 3,008 normalized values were independently reproduced exactly. The connected iPhone test subsequently passed on the user’s non-development iOS/Hermes app: raw preprocessing and normalization matched exactly, all four single-beat model calls agreed with Python ONNX Runtime within tolerance, and the session was released without error. Total test-call time was 165.700 ms, with mean inference-call time 2.978 ms across the four calls (Section 6.22). This completes the synthetic raw-input-to-model-output integration milestone. Recorded-signal evaluation, model accuracy, calibration integration and wearable acquisition remain unfinished.

### 1.1 Acceptance-criteria coverage

| Work item | Covered by this document | Implementation/evidence status |
|---|---|---|
| Weighted/calibrated method and rationale | Sections 3.1–3.4 and 3.12 | Offline method reviewed; pure weighted-offset/aggregation core implemented and locally tested |
| Monthly collection, storage, and application | Sections 3.5–3.8 and 3.12 | Core policy/serialization implemented; collection UI, persistence/activation, and longitudinal validation remain pending |
| Inputs, outputs, assumptions, and edge cases | Sections 3.6–3.9 and 3.12 | Pure-core tests pass; mobile integration/device tests remain pending |
| Calibration flow and evaluation | Sections 3.8–3.10 | Current offline results recorded; proposed evaluation protocol specified |
| Inference package and edge-computing design | Sections 4 and 6.22 | Original-model synthetic raw PPG → normalization → inference passes on iPhone; live wearable acquisition and recorded-signal validation remain pending |
| Repository artifact and target device path | Sections 2 and 4 | `.pth` push confirmed; local phone package installed; latest Git tracking of app/export files not yet checked |
| Mock data and expected-output criteria | Sections 5.1 and 6.18–6.20 | Original normalized model fixture and separate raw-PPG feature fixture passed on iPhone; connected-chain Python oracle supplied and four-candidate phone test passed |
| Raw PPG preprocessing on device | Section 6.19 | Hermes Release report passed: 31 candidates; exact numerical match on first four; one preprocessing-call duration of 45.500 ms |
| On-device execution and observations | Sections 5.2–5.4, 5.9–5.13 and 6.22 | Three original profiles: 333/333 calls; separate memory run: 555/555 calls; new connected raw-input test: 4/4 calls with exact feature/normalization parity |
| Memory and performance characterization | Sections 5.3, 5.6, 5.8–5.13 | Initial timing and five-cycle physical-footprint evidence recorded; full-trace recomputation, longer-session/device coverage, energy and app-launch measurements remain pending |
| Reproducible steps and follow-ups | Sections 5.5–5.7, 5.12 and 7 | Commands, procedures and a guarded automatic-memory installer included |

**Release position:** Keep this model in an explicitly labeled research/test flow. Do not represent its synthetic outputs as the user’s BP or use this checkpoint for diagnosis or treatment. This position follows the observed model limitations and current AHA guidance on unvalidated cuffless devices. [R1]

## 2. Completed work and evidence

### 2.1 Training run and provenance

The original training job was **27887941**, on March 24, 2026, from approximately 11:49:56 to 12:11:52 EDT. It completed with exit code 0. The job rebuilt all three feature caches, trained the model, selected epoch 7, and stopped at epoch 87 after no further qualifying validation improvement.

| Item | Recorded value |
|---|---|
| Training source | `cbp_tnet_train_v4_final.py` |
| Submission script | `submit_cbp_tnet_final.sbatch` |
| Training log | `/orange/xiangyan/rithika/cdd/logs/cbp_tnet_27887941.log` |
| Architecture | CNN + six Transformer encoder layers; two scalar timing features; separate SBP/DBP heads |
| Trainable parameters | 5,219,394 |
| Training subjects / cached beats | 1,100 / 220,000 |
| Validation subjects / cached beats | 195 / 39,000 |
| Test subjects / cached beats | 229 / 45,800 |
| Training sampler | Up to 30 cached beats per subject per epoch: 33,000 training examples per epoch |
| Logged training environment | Python 3.13.5, PyTorch 2.10.0+cu128, CUDA on NVIDIA B200 |
| Module command | `module load pytorch/2.8.0`; the actual runtime reported PyTorch 2.10.0, so the module name must not be treated as the runtime version |

The model was pushed to GitHub in commit `2852dd8` (`add model pth`) at repository path `python code/cBP-Tnet_Model.pth`.

```text
Checkpoint SHA-256:
2cabfe0c64bf2463495d9581dea837638c41c149948abd9730b8b6be25fd0169

Training-cache SHA-256:
3442299cb3996386916707cd88f89e5bc5cbdf08077d3e8d94ed181b5fdb4940
```

The September audit confirmed these fingerprints match the export metadata, recomputed normalization agrees with the phone package, and validation/test/calibrated results reproduce the March log. Together, these are strong operational evidence that the current artifacts reproduce that run. The original checkpoint contains weights rather than a complete training manifest; no historical cache hash was recorded inside it.

The exported metadata still contains `cache_checkpoint_pairing_verified: false`, and the phone’s yellow message reads that historical field. The successful audit did not edit that field. Preserve the original export report and attach the audit as additional evidence; do not silently rewrite historical results or confuse this provenance flag with predictive accuracy.

### 2.2 Exact audit results

All MAEs below are in mmHg. `r` is Pearson correlation. These are beat-level research results, not results of a device clinical-validation protocol.

| Method | SBP MAE | DBP MAE | SBP r | DBP r |
|---|---:|---:|---:|---:|
| Validation model | 13.9556 | 9.5043 | 0.0209 | 0.1568 |
| Test model, uncalibrated | 14.3402 | 9.5348 | 0.0249 | 0.1557 |
| Test: fixed training-mean baseline | 14.2803 | 9.4769 | Undefined | Undefined |
| Test: fixed training-median baseline | 14.2369 | 9.5434 | Undefined | Undefined |
| Test: model + calibration, reference beats excluded | 10.2240 | 5.8038 | 0.6649 | 0.7480 |
| Test: five-reference-mean baseline, same held-out beats | 10.2298 | 5.8188 | 0.6647 | 0.7468 |

Correlation is undefined for a constant prediction; it should not be reported as zero or interpreted as a missing accuracy result.

| Test-set variation | SBP | DBP |
|---|---:|---:|
| Model prediction mean | 114.153 | 56.164 |
| Reference-label mean | 113.578 | 59.455 |
| Model prediction standard deviation | 1.568 | 1.069 |
| Reference-label standard deviation | 17.701 | 11.918 |

The model produces a much narrower range than the reference labels. Calibration improves pooled scores chiefly by inserting information from each person’s reference BP. Its additional MAE benefit over the reference-only baseline is approximately **0.0058 SBP** and **0.0150 DBP**. This is not evidence of meaningful waveform-derived benefit or a statistically established improvement.

The original log also reported calibrated results including the five calibration beats per subject: SBP MAE 10.178320 and DBP MAE 5.776878. Use the held-out values above when discussing predictive performance. Even those held-out beats are not a longitudinal or session-separated evaluation.

Audit report location:

```text
/orange/xiangyan/rithika/cdd/outputs/iphone_inference/saved_model_audit_20260924T031309282241Z/audit_report.json
```

### 2.3 Work completed so far

1. Transferred and pushed the trained `.pth` artifact through HiPerGator after the Mac HTTPS certificate problem.
2. Computed normalization from the existing training cache and prepared 16 recorded test-beat fixtures.
3. Created an isolated CPU export environment and exported a fixed, single-beat ONNX graph.
4. Compared PyTorch with ONNX Runtime on those 16 prepared beats; conversion passed.
5. Generated a separate synthetic normalized fixture with saved Python outputs for distribution with the app.
6. Added the native inference service, model-test screen, home-screen link, and ONNX asset configuration to the Mac project.
7. Installed the native runtime and built the iPhone app; resolved development connectivity issues sufficiently to run the test.
8. Observed phone/Python agreement in an initial test and a later Airplane Mode test.
9. Investigated the original training log and reran the saved-model audit, including constant and reference-only baselines.
10. Identified the augmentation inconsistency, completed the controlled comparison, and reviewed the supplied validation results in Section 6.
11. Completed the bounded, read-only training/validation label-window audit and reviewed the reported endpoint timing behavior, multi-beat label windows, and small filter-context effects.
12. Completed the controlled upstroke-proxy comparison with augmentation disabled in both arms. Reviewed both supplied validation reports and their matching initial-weight, cache, source, and normalization fingerprints; recorded the mixed effect of masking.
13. Reviewed selected-epoch and final-epoch history rows for both upstroke arms and recorded the late divergence.
14. Completed the fixed-checkpoint train/validation audit, reproduced both validation reports, and compared gains over split-appropriate constant baselines.
15. Completed training-only tiny-fit job 43223464. It reached its engineering memorization target after 300 updates; the best checked step was 250. No checkpoint was saved or phone asset changed.
16. Prepared `compare_cbp_cnn.py` for a matched CNN-only/cBP-Tnet comparison. The first attempt failed before training on an incorrect identity guard. Repaired the guard with current-patient-list preflight, source/cache checks, snapshots, and explicit historical-provenance limits; locally tested both numeric collisions and real-name overlap.
17. Implemented the dependency-free research calibration core, TypeScript declarations, serialized profile validation, and a non-overwriting installer. All 21 arithmetic/state/installer tests passed locally. App UI and persistence integration remain pending.
18. Prepared and user-installed an additive iPhone synthetic profiling screen/service, guarded installer, read-only environment/artifact collector, and physical-device measurement protocol. All three user-supplied profiles passed, totaling 333 calls; independently recomputed each 100-call latency summary from its raw measurements (Sections 5.9–5.10).
19. Reviewed official wearable-data access documentation and recorded required hardware/SDK/fixture details. The user later identified SFH 7050A optical and ADXL366 motion components; analog readout, microcontroller/Bluetooth and waveform acquisition details remain unknown.
20. Received successful current-patient-list preflight and completed CNN-only/cBP-Tnet comparison results for array 43230748. Both selected checkpoints beat validation constant baselines, with nearly identical model errors despite an 11.23-fold parameter-count ratio (Sections 6.12–6.13).

21. Reviewed the three same-process Xcode memory screenshots and recorded their limits. Implemented an additive native iOS memory sampler, five-cycle controller, screen and guarded installer. Eleven protocol/summary and seven installer tests passed locally. The user then supplied a successful physical-device five-cycle run with 555 passing calls and 1,251 reported memory samples (Sections 5.11–5.13).

22. Prepared and locally tested the standalone multi-seed Slurm runner. The user supplied the completed three-seed summary and all four new arm logs from `cnn_multiseed_20260924T221508227477Z`. Recomputed paired differences and their sample statistics, checked reported aggregate precision and stopping behavior, and recorded the nearly tied architecture result (Section 6.15). The source-only preprocessing packet has since been supplied and reviewed (Section 6.16).

23. Reviewed the supplied preprocessing definitions and implemented a PPG-only numerical reference plus scheduled parity audit. Thirteen synthetic/local worker tests passed, followed by the user-run recording audit: 2,009 retained beats matched exactly. The terminal results and remaining evidence boundaries are recorded in Section 6.17.

24. Verified the uploaded full PPG audit report and synthetic fixture. Implemented a dependency-free JavaScript preprocessing port, guarded installer and shareable iPhone test screen. Sixteen numerical/contract and eight installer tests passed; the user subsequently supplied an exact physical-phone preprocessing match (Sections 6.18–6.19).

25. Generated and reviewed the four-candidate Python normalization/ONNX oracle; independently reproduced every normalized value. Implemented the connected phone test with 26 passing local checks. The user then supplied its successful Hermes/iOS result: all input stages matched exactly, four outputs passed the numerical tolerance, and resources were released. Total test-call time was 165.700 ms (Sections 6.20–6.22).

## 3. Calibration and weighting design

### 3.1 What calibration means here

For the existing offline method, calibration is **addition of two separate constants**: one offset for SBP and another for DBP. A negative offset is subtraction. It does not update the neural-network weights and does not estimate a slope.

For output `k` in `{SBP, DBP}`, let `p_jk` be the uncalibrated prediction and `c_jk` the reference value for paired observation `j`:

```text
residual_jk = reference_jk - uncalibrated_prediction_jk
offset_k = mean(residual_jk over calibration observations)
calibrated_prediction_k = new_uncalibrated_prediction_k + offset_k
```

The existing training script uses the first five cached beats for each test subject as references. Their labels come from the dataset’s ABP waveform processing, not five home cuff measurements. It applies the resulting offset to that subject’s beats and separately reports results with those five reference beats excluded.

Because cached beats were randomly sampled within each subject, “first five” means first in cache order. It does not establish an initial chronological visit followed by later visits. There is no monthly calibration or app calibration storage implemented by that function.

### 3.2 Three meanings of “weighted” must remain separate

| Weighting | Purpose | Current/proposed status |
|---|---|---|
| Training-loss weighting | Change how much different label ranges and outputs contribute during optimization | Implemented in `ClinicalHuberLoss` |
| Beat-quality weighting | Combine accepted beat predictions into a recording-level estimate | Proposed; no validated signal-quality weighting implemented in the phone flow |
| Calibration-observation weighting | Combine paired cuff/prediction residuals into personal offsets | Proposed extension; existing offline calibration uses an equal mean |

The current training loss uses Huber loss with `delta=5`. SBP loss is multiplied by 1.2. A label-dependent multiplier of 2 is applied for SBP labels at or below 90 or at or above 140, and DBP labels at or below 60 or at or above 90; other labels receive multiplier 1. These are source-code training choices, not user-facing diagnostic rules or evidence of clinical validation.

In compact form:

```text
L = 1.2 * mean(c_SBP(y) * Huber5(pred_SBP - y_SBP))
    + mean(c_DBP(y) * Huber5(pred_DBP - y_DBP))
```

These loss weights do not automatically produce a confidence score or a calibration weight during inference.

### 3.3 Recommended initial app method: weighted offset correction

For an accepted recording containing beat predictions `p_ik`, use:

```text
recording_prediction_k = sum(q_i * p_ik) / sum(q_i)
```

Here `q_i >= 0` reflects a separately specified signal-quality policy. Reject unacceptable beats before aggregation. Initially use equal weights for accepted beats; introduce graded weights only after validating the quality score. Quality must not be defined as “how close the prediction is to an expected normal BP.” If no beats pass or the weight sum is zero, return an insufficient-signal result.

For calibration, pair each accepted cuff reading with one temporally matched recording-level prediction:

```text
offset_k = sum(w_j * (cuff_jk - recording_prediction_jk)) / sum(w_j)
final_prediction_k = current_recording_prediction_k + offset_k
```

**Recommended first version:** use the newest accepted calibration session and equal weights across its accepted cuff/prediction pairs. Compute each cuff pair once, rather than treating many adjacent beats attached to the same cuff reading as independent cuff observations. This is a weighted formulation with equal initial weights and a clear path to validated quality weighting.

Worked example, using fictional values:

| Pair | Model SBP/DBP | Cuff SBP/DBP | Cuff minus model |
|---|---|---|---|
| 1 | 118 / 76 | 126 / 80 | +8 / +4 |
| 2 | 122 / 78 | 128 / 82 | +6 / +4 |

Equal weighting gives offsets **+7 SBP / +4 DBP**. A later uncalibrated output of `121 / 77` becomes `128 / 81`. If a separately validated policy assigned pair weights 0.75 and 0.25, the offsets would instead be `+7.5 / +4`. Those weights illustrate the arithmetic; they are not a recommended clinical weighting rule.

An offset of `-5 / -3` would turn `121 / 77` into `116 / 74`. Apply the offset exactly once, after recording aggregation, and round only for display.

### 3.4 Why this method—and what it cannot fix

Offset correction is transparent, computationally cheap, and feasible with a small number of paired observations. It corrects an approximately stable personal bias. It cannot recover BP changes that the model does not track, correct every sensor-domain mismatch, or establish accuracy outside the calibration conditions.

If the model always predicts approximately a constant `a`, then:

```text
offset ≈ mean(reference) - a
calibrated prediction ≈ mean(reference)
```

That explains why the current calibrated model and reference-only baseline are nearly identical. A larger pooled correlation after calibration can reflect differences between people’s reference values rather than successful tracking of changes within one person.

Do not use an arbitrary blend such as `70% model + 30% last month's cuff reading` as the default. It changes the meaning of a current estimate and can conceal an uninformative model. Likewise, a gain-and-offset model `a * prediction + b` needs sufficient independent paired observations spanning BP variation; two resting cuff readings do not justify fitting it.

An optional future recency-weighted residual method is:

```text
w_j = quality_j * exp(-ln(2) * age_days_j / half_life_days)
      * indicator(age_days_j <= maximum_age_days)
```

This is a research option, not the initial recommendation. The half-life, age limit, and quality function would require validation. Do not silently decay the offset toward zero when calibration expires; an unvalidated uncalibrated prediction is not made reliable by a smaller correction.

### 3.5 Monthly calibration: collection workflow and frequency

**A monthly interval is a proposed product requirement, not a validated property of this model.** No current experiment establishes how long its offsets remain accurate. ESH guidance includes a recalibration-stability test precisely because performance after calibration must be evaluated over time. [R2]

For a research prototype, make the scheduling policy explicit and configurable: `calibration_interval_days = 30`. This means a rolling 30-day research reminder/expiry policy, not every calendar month and not a clinical recommendation. Test whether this interval is acceptable before presenting a monthly guarantee. It does not prescribe how often someone should monitor their BP for medical care.

Proposed user workflow, after the raw-PPG and pairing functionality exists:

1. Select **Calibrate** and confirm the intended user, wearable, sensor placement, and reference cuff.
2. Use a validated upper-arm cuff with the correct fit. Follow the cuff instructions. For reference collection, AHA guidance includes avoiding smoking, caffeine, and exercise for 30 minutes beforehand, emptying the bladder, resting quietly for at least five minutes, supporting the arm at heart level, and taking two readings one minute apart. [R3]
3. Collect PPG automatically around each cuff measurement under a predefined pairing protocol. The user should remain still rather than interact with the phone during acquisition.
4. Import cuff values or enter and confirm SBP, DBP, units, and measurement time. Retain both readings individually.
5. Check signal quality, timing alignment, measurement context, and reference consistency. Record rejection reasons. Require the protocol’s minimum accepted independent cuff/prediction pairs; the initial design proposes two, subject to study approval and validation.
6. Compute separate SBP/DBP offsets and create a versioned calibration profile. Display when it was performed and when the research policy considers it due again.
7. At the next scheduled session, collect new paired measurements. Create a new profile; preserve the old one for audit and reproducibility.

**Pairing remains an open protocol decision.** Cuff inflation can alter distal PPG on the same arm. Do not assume that an inflated-cuff waveform is representative. Specify sensor arm/site, whether acquisition is simultaneous or immediately before/after the cuff reading, allowed time separation, and how arm differences are handled. A cuff value entered weeks after an unrelated PPG recording is not a valid calibration pair.

Require calibration review after incompatible changes to model, normalization, preprocessing, sensor, placement, or firmware. Observed disagreement with reference measurements should also trigger review rather than an automatic larger offset. Physiological changes may affect validity, but this project has not established individualized recalibration rules for them.

### 3.6 Required inputs, outputs, and data contract

| Component | Required inputs | Outputs |
|---|---|---|
| Model inference | Valid normalized `beat` and `timing` tensors; exact model bundle identity | Uncalibrated SBP/DBP in mmHg |
| Recording aggregation | Accepted beat predictions, quality decisions/weights, acquisition metadata | One uncalibrated recording estimate, accepted/rejected counts, quality status |
| Calibration creation | Paired cuff readings and uncalibrated recording predictions; timestamps; user/device/model/preprocessing identities | Two offsets, profile ID/version, validity interval, provenance, accepted/rejected pairs |
| Calibration application | Current uncalibrated estimate, compatible active profile, current acquisition context/time | Corrected estimate or explicit unavailable status; applied profile/version |

Minimum proposed `CalibrationProfile` fields:

```text
profile_id, user_id, created_at_utc
calibrated_at_utc, expires_at_utc, scheduling_policy_version
model_sha256, normalization_sha256, preprocessing_version
sensor_id, firmware_version, sensor_site, wavelength_or_channel_configuration
sampling_rate_hz, resampling_version, pairing_protocol_version
method = "per_output_offset_v1"
offset_sbp_mmhg, offset_dbp_mmhg
reference_pairs[]:
  reference_id, cuff_device_id, measured_at_utc, cuff_sbp, cuff_dbp, units
  recording_id, recording_start_utc, recording_end_utc
  uncalibrated_sbp, uncalibrated_dbp, quality_policy_version, weight
  accepted, rejection_reason
status, supersedes_profile_id, invalidation_reason
```

Predictions should retain `uncalibrated_estimate`, nullable `calibrated_estimate`, `calibration_profile_id`, calibration age/status, model/preprocessing identities, measurement time, accepted beat count, and signal-quality status. Preserve sufficient precision internally. Keep manually entered cuff readings, model estimates, and synthetic test outputs as distinct record types.

### 3.7 Storage recommendation

Implement calibration as an app service outside the ONNX graph. Store versioned profiles and reference records in the app’s local data layer so inference can work offline. Protect health-related records with platform-supported encryption/access controls and bind them to the correct signed-in user. Store identifiers for raw waveform records rather than embedding large recordings in every calibration profile.

Optional server synchronization can provide backup and multi-device access; it must not be required for each prediction. A cloud database, including DynamoDB if later selected, is not implemented or required by the current smoke test. Define retention, consent, deletion, access control, and conflict handling before collecting real participant data.

Create profiles atomically. Do not overwrite offsets without retaining their reference data and version. On sign-out or account change, prevent another user’s profile from being selected. Cross-device reuse is not automatically valid because the sensing and preprocessing conditions may differ.

### 3.8 Application flow and failure handling

```text
Acquire PPG and validate its metadata
→ preprocess and normalize using the selected model bundle
→ infer per-beat uncalibrated SBP/DBP
→ reject poor-quality beats and aggregate the recording
→ find a compatible, unexpired calibration profile
→ apply the two offsets once
→ validate the result and return values plus provenance/status
```

| Condition | Recommended behavior |
|---|---|
| No calibration profile | Return `calibration_required`; a developer screen may show clearly labeled uncalibrated research output |
| Age reaches/exceeds 30 days under the provisional policy | Mark `stale`; request a new session; withhold a current calibrated result |
| Device clock is invalid or calibration time is in the future | Return a time-validation error; do not extend validity silently |
| Wrong user or incompatible model/normalization/preprocessing/sensor | Return `incompatible`; require a compatible profile or a new calibration |
| Too few accepted cuff pairs | Return `insufficient_calibration`; do not treat more beats from one cuff reading as additional independent references |
| All quality weights are zero or nonfinite | Return invalid/insufficient signal; avoid division by zero |
| PPG is clipped, flat, interrupted, or otherwise rejected | Return `insufficient_signal`; do not substitute the last cuff reading as a new model measurement |
| Values/units are invalid, SBP is not above DBP, or offsets are implausible under a reviewed protocol | Reject or request review with a reason; do not silently clamp values into a plausible range |
| Two references disagree beyond a pre-specified repeatability rule | Ask for a protocol-defined repeat/review; do not invent that threshold from this model’s error |
| Good current signal but acquisition conditions fall outside validation | Return `out_of_scope` or an explicitly restricted research result |
| Duplicate upload or concurrent calibration creation | Use idempotent reference IDs and transactional profile activation |
| Offline operation | Use an already stored compatible, active profile; queue optional synchronization |
| Model update | Invalidate incompatible profiles; historical records remain tied to the model that produced them |

For this prototype, “active” means active under the research policy, not clinically validated. Signal-quality criteria, acceptable offset ranges, and reference-repeatability thresholds remain to be specified and tested.

### 3.9 Implementation-oriented recommendation

Keep three independently testable functions:

```text
aggregatePrediction(beats, qualityPolicy) → recordingEstimate | rejection
createCalibration(referencePairs, modelBundle, deviceContext, policy) → profile | rejection
applyCalibration(recordingEstimate, profile, modelBundle, deviceContext, now) → result | rejection
```

Require positive finite total weights, matching identities, valid timestamps, and accepted references before applying any offsets. Applying the same profile twice must be prevented through the result’s processing stage/provenance.

Minimum arithmetic/state tests include: the +7/+4 example above; negative offsets; unequal weights; zero total weight; a nonfinite reference; missing profile; expiry exactly at `expires_at_utc`; future timestamps; another user’s profile; changed model/normalization/sensor; and exactly-once application. These cases now have passing pure-core tests (Section 3.12); they have not yet been executed as an integrated mobile calibration flow.

### 3.10 How calibration must be evaluated

Report uncalibrated and calibrated performance separately. Include population-mean/median baselines, a personal-reference-mean baseline, and an appropriately defined last-reference baseline. Use identical reference budgets and held-out records for each calibrated method.

Future evaluation should separate subjects for model development and use chronological, session-separated calibration/evaluation within held-out subjects. Adjacent beats and overlapping windows from one recording should not be treated as independent visits. A proposed study schedule can measure performance at calibration and at days 1, 7, 14, and 30; those are study time points, not a proven calibration schedule.

Report SBP and DBP MAE, signed bias, error SD, error distributions, within-person change tracking, recording-level and subject-level results, and rejection/coverage rates. Use subject-clustered uncertainty estimates rather than treating 45,800 correlated beats as independent participants. Examine accuracy versus time since calibration and deployment sensor/site. Fix weighting and expiry policies using development data before a reserved final evaluation.

The source functions named `AAMI_standard` and `BHS_standard` calculate summary statistics and error bands. Their names do not establish that an AAMI/ISO/ESH clinical protocol was performed or passed. ESH describes distinct tests for static accuracy, device position, BP changes, and recalibration stability as applicable to the device. [R2]

### 3.11 Decisions still needed

- Which wearable exposes raw PPG, at what sampling rate, wavelength, site, and access permissions?
- Is the intended use an occasional resting estimate, tracking changes, or continuous measurement?
- Which validated cuff and paired-acquisition protocol will provide reference measurements?
- Who will approve the study protocol and user-facing interpretation?
- What signal-quality and reference-repeatability rules will be validated?
- Does a 30-day validity window meet the study’s pre-specified criteria?
- How should calibration be reviewed after physiological or device changes?
- Which app data store, retention policy, and optional synchronization service will be used?

### 3.12 Implemented research calibration core

The parallel-work package contains `calibration/bpCalibration.js`, `bpCalibration.d.ts`, two Node test files, a guarded installer, and integration notes. The installer adds the library files under `services/bp-calibration-research/` in the Expo project. It does not add cuff-entry UI or persistent account storage.

Implemented pure operations are `aggregatePrediction`, `createCalibration`, `selectLatestCalibration`, `applyCalibration`, `serializeProfile`, and `deserializeProfile`. They return an explicit success value or rejection status/reason. Context binds the user, model/normalization hashes, preprocessing, sensor/firmware/site/channels, sampling/resampling, quality policy and pairing protocol. Profiles have separate SBP/DBP offsets, reference provenance, timestamps, expiry, schema/revision fields, and supersession lineage.

Calibration references must belong to one explicit session. Both the cuff/recording pairing gap and maximum accepted session span must be supplied by the caller; no clinical timing default is invented. At least two distinct accepted positive-weight pairs are required by this implementation. Session-span checks prevent older references from being refreshed by a newly added reading. Configurable expiry is exclusive at its boundary; stale/missing/incompatible profiles return no corrected result. The core does not decay offsets toward zero or clamp invalid corrected outputs. Synthetic inputs are excluded from personal calibration, and result-stage tags prevent applying offsets twice.

**Verification:** 21 local Node tests passed: 17 arithmetic/state groups and four installer groups. Coverage includes the documented +7/+4 example, negative/unequal/large weights, zero/NaN rejection, reference duplication/reuse, every context mismatch, synthetic exclusion, time/expiry boundaries, latest-session conflicts, session-span checks, serialization consistency, exactly-once application, and installer dry-run/idempotency/conflict/symlink behavior. Tests use fictional inputs only; no participant profile or health-journal entry was created.

**Still pending:** acquisition/quality and reference-repeatability protocols; collection UI; authenticated storage and atomic activation/invalidation; reminders; mobile end-to-end testing; and longitudinal calibration validation. JSON serialization is not encrypted storage or a signature, and stage tags are not cryptographic proof of input origin. A 30-day policy remains a configurable research choice. Full integration instructions are in the package's `calibration/README.md`.

## 4. Inference package and edge computing

### 4.1 Where computation occurs

**Current edge device: the iPhone.** The phone loads and executes the ONNX model locally using the CPU execution provider. The present demonstration does not run the model on a watch and does not require cloud inference. HiPerGator performs training, export, and research evaluation.

| Stage | Intended location | Current status |
|---|---|---|
| Model training and selection | HiPerGator | Implemented; current model has weak predictive value |
| Model export and numerical checks | HiPerGator CPU export environment | Completed |
| Raw wearable PPG acquisition/transfer | Wearable and phone | Not connected or validated in this test |
| Filtering, beat detection, feature extraction | iPhone | Implemented and exact on the synthetic fixture in Hermes; four candidate tensors compared |
| Neural-network inference | iPhone CPU | Passes normalized-input tests and the connected raw-PPG synthetic test; original model, four candidate calls in the connected test |
| Beat aggregation and personal calibration | Phone | Proposed; not exercised by the smoke test |
| Display/history and optional cloud synchronization | App / optional backend | Test display exists; synthetic results are not saved to the health journal |

Moving inference onto a watch would be a separate deployment project with its own runtime, sensor access, energy, and memory constraints. BLE is a possible transport, but its availability and payload format depend on the actual device/API.

### 4.2 Artifact inventory

| Artifact | Purpose/location |
|---|---|
| `python code/cBP-Tnet_Model.pth` | Confirmed repository checkpoint, commit `2852dd8` |
| `python code/cbp_tnet_train_v4_final.py` | Reviewed repository training source; Git blob `40b0ff63c48ebf793b3075b0f3bf3f991187fe5e` |
| `outputs/cBP-Tnet_Model.pth` | Original HiPerGator checkpoint |
| `outputs/iphone_inference/export_iphone_onnx.py` | Export utility on HiPerGator |
| `outputs/iphone_inference/normalization.json` | Saved training statistics and artifact fingerprints |
| `outputs/iphone_inference/prepared_test_beats.npz` | Sixteen recorded test beats used for conversion checking; not the distributable synthetic fixture |
| `outputs/iphone_inference/onnx_export/cbp_tnet.onnx` | Fixed-shape FP32 ONNX model, approximately 20 MB |
| `onnx_export/normalization.json` | Matching inference normalization contract |
| `onnx_export/export_report.json` | Export hashes, environment, parity results, and scope flags |
| `onnx_export/synthetic_model_smoke_test.json` | Synthetic normalized inputs and saved Python expected output |
| Mac `assets/models/onnx_export/` | Installed application asset directory |

HiPerGator paths in this section are relative to `/orange/xiangyan/rithika/cdd`; Mac app paths are relative to `/Users/rithika/Desktop/cddapp`. Only the checkpoint push is confirmed in the provided Git output. Verify and explicitly commit the app code/export package if they are intended to be reproducible from the remote branch; do not assume local installation means GitHub contains them.

### 4.3 Exact model contract

| Tensor | Name | Type | Shape | Meaning |
|---|---|---|---|---|
| Input | `beat` | float32 | `[1, 3, 250]` | Channel order: PPG, first derivative, second derivative |
| Input | `timing` | float32 | `[1, 2]` | Scaled upstroke-time proxy, scaled beat interval |
| Output | `bp` | float32 | `[1, 2]` | SBP followed by DBP, in mmHg |

Batch size is fixed at one in the exported graph. Inputs must already be normalized. Normalization, raw-PPG preprocessing, and personal calibration are outside the graph. Do not apply normalization again to the bundled synthetic fixture, and do not treat the two timing values as BP labels.

The training variable `PTT` contains these two waveform timing proxies. It is not a directly measured pulse-transit time between synchronized vascular/sensor sites.

### 4.4 Preprocessing contract to reproduce before live input

The reviewed training implementation uses a 125 Hz signal and the following operations:

1. Apply its adaptive Kalman filter to each source PPG segment.
2. Detect PPG peaks with `pyampd.ampd.find_peaks`, using `scale=125`.
3. Extract peak-to-peak beats according to the source loop; accepted beats have at least ten samples.
4. Compute `numpy.gradient` twice on the variable-length beat, before padding.
5. Independently zero-pad or truncate PPG, dPPG, and d²PPG to 250 samples. The current code does not time-resample every beat to 250 samples.
6. Compute `clip((argmax(beat)/125)/0.15, 0, 3)` and `clip(((end-start)/125)/1.2, 0, 3)` as the timing features.
7. Apply the saved training-set means and standard deviations and form the float32 tensors.

The 250-sample array is a fixed representation, not necessarily two seconds of observed waveform: shorter beats are padded. If a wearable supplies a different rate, any resampling and filter-state policy must be defined, versioned, and tested. Streaming filter state is not automatically equivalent to restarting the filter on the training segments.

| Feature | Mean | Standard deviation |
|---|---:|---:|
| PPG | 0.4523533880710602 | 0.7686189413070679 |
| dPPG | 0.0000008225564442909672 | 0.02521825209259987 |
| d²PPG | 0.000055200511269504204 | 0.0038505829870700836 |
| Scaled upstroke-time proxy | 1.3942710161209106 | 1.494810700416565 |
| Scaled beat interval | 0.6097057461738586 | 0.14007417857646942 |

Each feature is transformed as `(value - mean) / standard_deviation`. These numbers apply to the recorded checkpoint/cache combination; a new model/preprocessing package requires its own versioned contract.

The training code also uses ABP-derived labels and label-dependent sample filters. A deployed wearable will not have ABP available, so those reference-dependent filters cannot simply become runtime input requirements. Their effect on dataset selection and deployment coverage needs evaluation.

### 4.5 Runtime implementation and environment

The installed service is `services/bpSmokeTest.native.ts`; its UI is `app/ml-test.tsx`. The home-screen entry is `components/BpSmokeTestLink.tsx`. A non-native fallback explains that browser inference is not configured.

The service resolves the bundled `.onnx` through `expo-asset`, caches an ONNX Runtime session, specifies `executionProviders: ['cpu']`, and sets both intra-op and inter-op threads to one. It validates fixture/tensor contracts, checks finite outputs and parity, disposes per-call tensors, and retains the session for reuse. It does not use Core ML, the GPU, or the Apple Neural Engine in this configuration.

Recorded app setup uses Expo SDK 54 and `onnxruntime-react-native@1.24.3`, plus Expo-compatible `expo-asset` and `expo-dev-client`. Native modules require a custom native build; Expo Go is not the test target. The lockfile and installed versions should be retained with each device-test record.

| Environment | Recorded versions |
|---|---|
| CPU export virtual environment | Python 3.9.25, PyTorch 2.8.0+cpu, NumPy 1.26.4, ONNX 1.17.0, ONNX Runtime 1.19.2 |
| September saved-model audit | Python 3.13.5, PyTorch 2.10.0+cu128, NumPy 2.2.6, CUDA |
| iPhone binding | ONNX Runtime React Native 1.24.3 |

The exporter uses ONNX opset 17 and the legacy TorchScript export path. Its deprecation warning describes a future/default exporter change, not a failed export. Keep the tested versions pinned until a deliberate migration passes the same checks. ONNX Runtime supports local mobile model execution; disk size and runtime memory must be measured separately. [R4]

### 4.6 Package/version recommendation

Treat the ONNX model, normalization, preprocessing version, input/output schema, and fixture/reference report as one atomic bundle. Record SHA-256 values, a bundle version, source revision, and runtime versions. Confirm graph output order and preprocessing compatibility before activating an update; preserve a previous known-good bundle for rollback.

The setup installer checked model/settings hashes. The current phone service checks fixture and tensor contracts but does not independently recompute every artifact hash on each run. That distinction should be documented rather than claiming full runtime integrity verification already exists.

### 4.7 Wearable-access readiness

The user subsequently identified SFH 7050A optical and ADXL366 motion components. The analog readout, microcontroller/Bluetooth and actual waveform interface remain unknown. The parallel package includes `WEARABLE_READINESS.md`, with official-source evidence and the needed sample/metadata contract. Ordinary heart-rate values cannot replace the required PPG waveform. Apple documents a SensorKit PPG waveform interface with a potentially variable signal scale [R15], but reading it requires approved research access and participant permission [R16]. Its documented fetch route imposes a 24-hour holding period [R17], so that route does not satisfy immediate live prediction.

Do not assume the wearable is an Apple Watch because the phone is an iPhone. Before implementing decoding, identify manufacturer/model, OS/firmware, SDK/API, waveform access route, sample rate/clock, units/scaling, channels/wavelengths, sensor filtering and gap behavior. A short authorized waveform fixture is still needed. No BLE decoder, entitlement, continuous-capture capability, or wearable performance is claimed as completed.

## 5. Mock-data on-device test report

### 5.1 Fixture and pass criteria

The distributable fixture is generated with NumPy’s `default_rng(125)`: standard-normal float32 arrays of shape `[1,3,250]` and `[1,2]`. The model produces the saved Python reference output.

This fixture represents the tensor interface and execution path. It is not a physiologically representative PPG recording. Random derivative channels and timing values need not describe any real pulse. It must be described as an execution/parity smoke test, not a physiological or accuracy test.

The separate export validation used 16 prepared, recorded test beats. Those establish numerical agreement for a small sample of dataset inputs, not broad model accuracy or sensor generalization. Do not distribute patient-derived fixtures without confirming the dataset’s applicable permissions and project policy.

Pass criteria for the phone test:

- The native runtime loads the bundled model and accepts the expected input names, float32 types, and shapes.
- Output `bp` has shape `[1,2]` and contains finite SBP/DBP values.
- Absolute phone/Python difference is at most **0.01 mmHg for each output**.
- The result is visibly labeled synthetic and is not saved as a health-journal measurement.

The 0.01 threshold is a software conversion tolerance. It is not a BP-accuracy requirement against a cuff or arterial reference.

### 5.2 Recorded execution results

| Check | Result |
|---|---|
| CPU PyTorch vs ONNX, 16 prepared beats | Passed |
| Maximum SBP conversion difference | 0.00005341 mmHg |
| Maximum DBP conversion difference | 0.00001144 mmHg |
| Physical iPhone synthetic test | `PASS — matches Python` shown in supplied screenshots |
| Phone SBP / DBP display | 109.3460 / 53.5788 mmHg |
| Python SBP / DBP display | 109.3459 / 53.5788 mmHg |
| Reported absolute SBP / DBP differences | 0.000031 / 0.000004 mmHg |
| First shown inference call | 5.7 ms |
| Later Airplane Mode inference call | 3.6 ms |

Displayed values are rounded; the difference calculation uses the underlying values. Do not recompute parity from only the four-decimal display.

Evidence consists of user-supplied terminal outputs and physical-device screenshots from September 23–24, 2026. The later screenshot visibly shows Airplane Mode and a successful test. It does not independently record the app’s exact build configuration, device model, OS version, USB state, or every step of a fresh-process launch. A fully documented offline cold-launch test should capture those details explicitly.

### 5.3 Performance and memory observations

| Measurement | Status/interpretation |
|---|---|
| Earlier inference-call screenshots | 5.7 ms and 3.6 ms, without systematic first/warm classification |
| New first inference | 3.885 ms in the user-supplied profiling run |
| Measured-call distributions | Three runs, each with 100 measured calls after one first call and ten warm-ups; means 6.187/9.713/6.436 ms and nearest-rank p95s 7.742/12.386/7.376 ms; preserve per-run values (Section 5.10) |
| What inference timers include | The awaited `session.run` call and associated native/JS call overhead |
| What inference timers exclude | Asset resolution, session creation, input preparation, raw PPG processing/acquisition, aggregation, calibration, output validation and display rendering |
| Fresh model-session creation | 109.643/107.353/57.647 ms across the three runs; OS cache state uncontrolled |
| First checked result inside benchmark | 131.565/128.278/76.379 ms across runs; not app-launch or tap-to-visible latency |
| Whole-app memory / retained growth | Automatic run: baseline 35.145 MB, sampled peak 72.091 MB, settled values 70.714 → 68.503 → 56.362 → 54.593 → 50.169 MB; no progressive settled growth in these five cycles (Section 5.13). Earlier Xcode screenshots are separate evidence. |
| Energy / thermal context / long-session stability | Energy unmeasured; automatic run records thermal-state code 0 and Low Power Mode off at both endpoints, without a continuous thermal trace; long-session stability unmeasured |
| Device/build metadata | Screenshot: iPhone 16 Pro, iOS 26.6.2. Automatic report: physical hardware iPhone17,1, OS build 23G90, app 1.0.0/build 1, non-development JS. Original profiles: ORT 1.24.3, CPU and one thread. Xcode version, Git commit and complete run conditions remain unrecorded |

The approximately 20 MB model file is not a RAM measurement. The 5,219,394 FP32 trainable parameters alone correspond to approximately 19.9 MiB, before buffers, activations, runtime workspaces, React Native, and the rest of the app. One pair of input tensors contains 3,008 bytes of float32 values, also excluding object/native-runtime overhead. Neither calculation predicts peak application memory.

The raw arrays reproduce all reported latency statistics for all three runs. The two earlier screenshot timings should not be pooled with these runs. Three runs on one device and one repeated input do not establish cross-device performance, verified cold launches or representative physiological input coverage. The manual screenshots and automatic five-cycle summary are initial memory evidence, not an established long-session memory or battery budget. See Sections 5.9–5.13 for exact records and evidence limits.

### 5.4 Failures and limitations encountered

| Issue | Observed resolution/status |
|---|---|
| Mac Git push failed on a self-signed certificate | Checkpoint transferred/pushed through HiPerGator; not a model-conversion failure |
| GitHub account password rejected for Git operations | Subsequent authenticated push succeeded |
| Phone could not load the development server at the LAN address | Development tunnel used; local `@expo/ngrok` installation resolved package discovery |
| Global ngrok install was not discovered by Expo | Installed the package in the project’s development dependencies |
| Old CocoaPods deployment-target warnings | A Podfile post-install adjustment to a minimum of 15.1 was supplied; later app execution succeeded; the warning text alone did not identify every build error |
| Expo CLI Release command reported missing Simulator information | Direct Xcode workspace/Release workflow was supplied; later offline execution shown |
| Root project folder opened as a directory in Xcode | Open `ios/cddapp.xcworkspace` instead |
| Yellow pairing warning persists | Export metadata still contains its historical false flag; later audit supplies stronger evidence separately |
| Synthetic fixture only | At the initial smoke-test stage, raw preprocessing had not been tested. Section 6.22 now records synthetic raw-PPG phone parity; live wearable input and recording-level/calibrated flow remain untested. |
| Current prediction quality | Near-constant output and weak baseline comparison; investigated separately from runtime success |

The Podfile adjustment is a local native customization; regenerating the native project with a clean prebuild can remove it. Preserve the working native configuration rather than treating a clean regeneration as a routine profiling step.

### 5.5 Reproduce the installed phone test

On the Mac:

```bash
cd /Users/rithika/Desktop/cddapp
open -a Xcode /Users/rithika/Desktop/cddapp/ios/cddapp.xcworkspace
```

1. Select the actual iPhone and the app scheme. Verify signing and, for an offline test, set the Run configuration to **Release** through **Product → Scheme → Edit Scheme**.
2. Build/install the app. For this environment, use the working Xcode path if the Expo CLI Simulator-detection error recurs.
3. Open **Test ML model → ML Model Test → Run synthetic test**.
4. Record the displayed outputs, differences, inference-call time, model bundle hashes, and build/device details.
5. For an explicit offline cold-launch check: stop Metro, disconnect USB after installation, enable Airplane Mode and ensure Wi-Fi is off, fully close the app, reopen it from its icon, and rerun the test. Record each step and its outcome.

Release builds embed application assets; a development build may depend on Metro for its JavaScript bundle. This is separate from whether the model computation itself is local. [R5]

To reproduce CPU conversion independently, use a new output directory rather than replacing the installed package:

```bash
(
set -e
cd /orange/xiangyan/rithika/cdd
export_check_dir=$(mktemp -d /orange/xiangyan/rithika/cdd/outputs/iphone_inference/export_recheck_XXXXXX)
venv-iphone-export/bin/python outputs/iphone_inference/export_iphone_onnx.py \
  --checkpoint outputs/cBP-Tnet_Model.pth \
  --normalization outputs/iphone_inference/normalization.json \
  --fixtures outputs/iphone_inference/prepared_test_beats.npz \
  --output-dir "$export_check_dir"
)
```

This is a reproducibility command, not an instruction to repeat an already passed export while the training comparison runs. Use an allocated compute session where required by cluster policy.

### 5.6 Complete the missing memory/performance evidence

**Current status:** the automatic add-on has produced the five-cycle physical-device result in Section 5.13. This initial measurement is complete; further manual screenshots are not required for that milestone. The Xcode/Instruments procedures below remain available for independent checks or investigations of future sustained growth. Energy and true app-launch measurements remain separate tasks.

On a physical iPhone, profile the app through Xcode’s **Product → Profile** workflow with an appropriate Release/Profile configuration. Use Instruments’ Allocations and the app memory view; Apple documents both allocation analysis and memory-graph inspection. Record app memory before loading the model, after session creation, after inference, after repeated runs, and after leaving/reopening the screen. [R6, R7]

Distinguish retained allocations, peak allocations, and process memory/footprint; label whichever metric the selected tool reports. Reused runtime arenas may retain memory without indicating a leak. A sustained increase across equivalent repeated cycles deserves investigation.

The implemented profiling screen now automates setup timing, one first call, ten warm-ups and 100 measured calls, and exports JSON. Three supplied runs passed; retain their distributions separately rather than averaging them into a single stability claim. The measured-call timer excludes tensor construction, output validation and UI updates. Actual app-launch timing and input-to-visible end-to-end latency remain separate tasks.

For an independent Xcode memory check, connect the iPhone, use the existing working Xcode workspace and a Release configuration, and start a fresh app process. Go directly to **Profile synthetic inference** before using the old smoke-test button, which keeps a separate session alive. In Xcode's Debug navigator, select the app's Memory report, which shows current and highest observed process memory. Record a baseline before the benchmark, the peak, and the settled value after release. Repeat five benchmark cycles in the same process, using a consistent idle interval such as ten seconds between cycles, and record each settled value. These instrumented runs are for memory observations; do not pool their latency with the uninstrumented timing reports. [R6]

A screenshot of that trace is an initial process-memory observation, not a complete allocation/leak diagnosis. Use Instruments' Allocations timeline to investigate sustained growth and label its live/persistent or cumulative metrics exactly; allocation totals are not interchangeable with process footprint. A ten-second pause is a measurement convention, not proof that retained memory must return to baseline. Do not use HiPerGator `MaxRSS` as an iPhone-memory result.

### 5.7 Follow-up fixture coverage

The next fixture set should cover: approved recorded PPG replay, exact raw-preprocessing parity, flat/clipped/noisy/missing-sample input, wrong sample rate, insufficient beats, wrong tensor shape, nonfinite values, corrupted/incompatible assets, repeated calls, and calibration states. Signal-quality failures should produce explicit unavailable results rather than plausible-looking BP numbers.

Generate expected outputs with the exact bundle under test. Keep physiological accuracy, preprocessing fidelity, model-conversion fidelity, and device execution as separate pass/fail categories.

### 5.8 Synthetic profiling extension

The parallel package adds a `/ml-profile` route and separate synthetic profiling service using the original installed ONNX artifact. Its guarded installer verifies the existing Expo 54 / ONNX Runtime 1.24.3 package, fixture/model contract and checksums; it adds a button only when the original model-test screen matches the known generated version. It backs up that edit, refuses conflicting files, and supports guarded restoration. The existing smoke-test service and native configuration remain in place.

The new screen performs one first inference, ten warm-up calls, and 100 measured calls. Every output must meet the existing 0.01 mmHg parity tolerance. The service records runtime-import, asset-resolution, session-creation, first-result and release durations separately, plus measured-call mean, nearest-rank p50/p95 and maximum. It reports incomplete/cancelled/parity/runtime failures, prevents duplicate benchmark starts, and releases its session and tensors. The screen offers a user-initiated JSON report; it makes no health-journal entry.

Measured inference durations surround `session.run`, including the JS/native call boundary; input preparation, output checks and UI rendering are excluded. New session creation is not a claim of cold OS-cache behavior. For memory measurements, start a fresh app process and visit profiling before running the old smoke test, which retains its own session. A separate read-only Mac collector records selected package/build/Git metadata and artifact hashes without credentials or device serials. Its output is not an iPhone memory measurement.

**Local verification:** percentile fixtures, installer dry-run/apply/repeat/guarded rollback and edited-file refusal passed. The controller passed synthetic runtime stand-in tests for 111 successful calls, parity failure, nonfinite output, cancellation, and tensor/session release. A combined-installer test also confirmed that a conflict in the profiling component blocks calibration installation before any write. These checks do not constitute an Expo build or native-runtime test.

**Execution boundary:** the user installed the extension and supplied three phone timing/parity reports (Sections 5.9–5.10), manual memory screenshots (Section 5.11), and a completed automatic five-cycle report (Section 5.13). Device execution was performed by the user, not remotely by the document author. The native sampler's normal execution path is now exercised on the phone. Its full raw trace, independent restart/offline evidence, energy, true app-launch timing and longer-run characterization remain outstanding. The original profiler alone continues to report no memory measurements.

### 5.9 First supplied iPhone profiling run — September 24, 20:02 UTC

Evidence file: `iphone_profile_20260924T200250184Z.json`, preserved from the user-pasted JSON. This records the existing ONNX model, not either candidate in the newly submitted GPU comparison. The report identifies one fresh model session; it does not establish a fresh app process or cold OS file caches.

| Field | Reported result |
|---|---|
| UTC interval | 2026-09-24T20:02:50.184Z to 2026-09-24T20:02:52.167Z |
| Platform / OS | iOS / 26.6.2 |
| Build flag | `developmentBuild: false`; non-development JS build reported |
| Runtime / provider / threads | ONNX Runtime 1.24.3 / CPU / 1 |
| Input | Fixed synthetic, already normalized model inputs |
| Calls | 1 first call + 10 warm-ups + 100 measured = 111 |
| Functional result | Complete and PASS; 111 attempted, 111 successful, zero parity/runtime failures, no cancellation |
| Maximum absolute SBP difference | 0.000030517578125 mmHg |
| Maximum absolute DBP difference | 0.000003814697265625 mmHg |
| Per-output parity tolerance | 0.01 mmHg |
| Runtime import | 16.432 ms |
| Model asset resolution | 1.378 ms |
| Fresh session creation | 109.643 ms |
| First inference call | 3.885 ms |
| First checked result inside benchmark | 131.565 ms |
| Measured mean / nearest-rank p50 | 6.187 / 5.826 ms |
| Measured nearest-rank p95 | 7.742 ms: 95 of the 100 measured calls completed within this value |
| Measured minimum / maximum | 4.963 / 8.856 ms |
| Sum of 100 measured-call durations | 618.719 ms, independently recomputed |
| Session release | 1.311 ms |
| Entire benchmark wall time | 1,983.617 ms |
| Memory / energy measured | false / false |
| OS cache state | uncontrolled |

The 100 individual durations were independently checked for finite nonnegative values. Count, mean, nearest-rank p50/p95, minimum and maximum match the supplied summary. Attempted/successful counts and error flags are internally consistent. This verifies the arithmetic and reported execution outcome, not independent rerunning of the phone test.

The approximately two-second benchmark wall time includes setup, 111 calls, warm-ups, output checking, progress callbacks, deliberate event-loop yields and release. It is not one prediction's latency and must not be divided by 100 as the inference statistic. The first call being faster than the measured-call mean is observable; the report alone cannot identify the cause.

Recorded identity fields:

```text
ONNX model SHA-256:
a8e26e25b852344814e4a474e73e92b9f8d40845c20948fdcce828c9e4f12fce
Synthetic fixture SHA-256:
10ddfcddb8a5aaf2fe5098b5565ef018a6872580ade2d1eb7f839d1d920631a8
```

These fields and the runtime version are copied from installer metadata by the profiling service; the JSON is not a new runtime hash attestation. The ONNX hash refers to a different artifact from the original `.pth` checkpoint hash. Its difference from that checkpoint hash is expected.

**What is now supported:** successful repeated execution of this synthetic fixture and a first measured inference-latency distribution on the user's phone. This does not demonstrate BP accuracy, raw-PPG preprocessing, wearable transfer, patient calibration, recorded-input coverage or long-session stability.

**Follow-up status:** two additional reports and the iPhone model were subsequently received (Section 5.10). Still record Xcode/app build or commit, app-process restart confirmation, debugger/Instruments attachment, charging/Low Power Mode and thermal context. Record an explicitly offline fresh-launch run with USB disconnected, Airplane Mode on and Wi-Fi off. Collect memory separately using the documented Instruments procedure, including baseline, peak and post-release behavior over repeated cycles. Energy and true app-launch timing remain separate measurements.

### 5.10 Three phone runs and device identification

The supplied Settings screenshot identifies **iPhone 16 Pro**, **iOS 26.6.2**, matching the OS field in all three JSONs. The new reports were pasted in reverse chronological order; the table below sorts by `startedAt` in UTC.

| Run start (UTC) | Passed calls | Mean (ms) | Nearest-rank p50 (ms) | Nearest-rank p95 (ms) | Maximum (ms) | Session creation (ms) | First checked result (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|
| 20:02:50.184 | 111/111 | 6.187 | 5.826 | 7.742 | 8.856 | 109.643 | 131.565 |
| 20:26:53.718 | 111/111 | 9.713 | 10.385 | 12.386 | 13.840 | 107.353 | 128.278 |
| 20:27:17.696 | 111/111 | 6.436 | 6.545 | 7.376 | 7.834 | 57.647 | 76.379 |

**Verification:** all three raw arrays contain 100 finite, nonnegative durations, and each supplied mean, nearest-rank p50/p95, minimum and maximum reproduces. The common ONNX/fixture hashes, input stage, provider, thread settings and recorded runtime version match. Every run reports 111 attempted/successful calls, zero parity/runtime failures, complete/PASS and no cancellation. Across runs, the maximum Python-output differences remain 0.000030517578125 SBP and 0.000003814697265625 DBP mmHg, below the 0.01 tolerance. This totals 333 successful invocations of one repeated fixture, not 333 different physiological examples.

**Observed variation:** the 20:26 run is clearly slower. Its trace moves from approximately 5–8 ms to approximately 10–14 ms around measured call 39, while the subsequent run returns to approximately 5–8 ms. The records do not identify a cause. Background work, scheduler behavior, power/thermal state or debugger/instrumentation are possible influences, not established diagnoses. Do not discard that run as an outlier or claim consistent 6 ms behavior. Nor does the following faster run establish that the underlying cause is resolved.

Each run uses a fresh model session, but its report does not verify a fresh app process. The last two start about 24 seconds apart; that neither proves nor disproves the requested app restart. Session creation varying from 57.647 to 109.643 ms also cannot be called a cold-start improvement because OS cache state is uncontrolled. All three report `memoryMeasured: false` and `energyMeasured: false`.

**Deployment boundary:** these reports measure the original installed cBP-Tnet ONNX artifact. They do not benchmark either newly trained candidate, establish CNN phone speed, or measure new candidate BP accuracy. A future candidate needs a separate export using its matched model wrapper, numerical parity and on-device tests before any artifact replacement.

New preserved evidence files:

- `iphone_profile_20260924T202653718Z.json`
- `iphone_profile_20260924T202717696Z.json`

The initial memory follow-up has now produced a labeled automatic report (Section 5.13). Priority shifts to recorded-input/preprocessing coverage and model development, with remaining run-context, energy and app-launch evidence tracked separately. Full device-performance acceptance criteria remain only partly complete.


### 5.11 Initial manual Xcode memory observation

The user supplied three Xcode Memory report screenshots for `cddapp`, all displaying PID **31290**, supporting a same-process sequence. The screenshots are labeled `before`, `during`, and `10secafter`; the wait duration is supplied by that label rather than independently timed in these images.

| Observation | Displayed app memory |
|---|---:|
| Before the benchmark | 30.6 MB |
| During the benchmark: current value | 67.7 MB |
| Highest value shown by the later graph | 70.3 MB |
| Image labeled ten seconds afterward | 58.8 MB |
| Displayed high minus baseline | Approximately +39.7 MB |
| Afterward minus baseline | Approximately +28.2 MB |
| Displayed high minus afterward | Approximately 11.5 MB decrease |

The differences use rounded screenshot values. This measures the **whole application under Xcode**, including React Native, runtime allocations, code/data and any other app activity. It does not isolate model tensors or establish an exact instantaneous peak. The screen labels do not independently prove the session-release time or whether another retained session existed.

This is **one sequence**, not the requested five equivalent cycles. The remaining 28.2 MB does not by itself demonstrate a leak. First-use loading, caches and allocators may retain memory; repeated settled values and allocation investigation are needed to distinguish these from unintended growth. The screenshots' **Energy Impact: High** label is not a measured energy quantity and cannot supply a battery-life estimate.

### 5.12 Automatic five-cycle memory add-on — implementation and reproduction

Deliverable: **`cdd-memory-automation.zip`**, with `README.md`, guarded installer, native sampler, controller, screen and local tests. It retains the current model and synthetic fixture. It adds a button to the existing profiling screen and a local Expo module; there is no calibration, health-journal or dataset change.

The default protocol is:

1. Capture a two-second baseline on the automatic-memory screen.
2. Run the existing synthetic profile: one first inference, ten warm-ups and 100 measured calls, each checked against Python.
3. Wait ten seconds after that profile returns from session/tensor cleanup.
4. Repeat steps 2–3 for five cycles in the same app process.
5. Offer a compact summary JSON and a separate full trace through an explicit Share action.

Five successful cycles mean **555 successful calls of the same fixture**, not new physiological coverage. Inference pass and memory-capture completeness are separate fields; the app does not display a leak-detection pass/fail claim.

**Memory definition:** native `task_vm_info.phys_footprint` is sampled on a serial queue at a nominal 50 ms interval, plus phase boundaries. Bytes are authoritative; the screen displays decimal MB. `resident_size` is a separate secondary field. The largest observed sample can miss shorter peaks and is not a lifetime high-water mark. Baseline and settled values are medians of the last one second of their respective phases. The report retains per-cycle observed peaks, settled values, and final-settled minus first-settled memory. [R18–R20]

The entire process is measured, including the sampler, sample buffer, progress UI and retained result objects. Instrumented timings must remain separate from the earlier uninstrumented latency runs. The primary metric may differ from an allocation total or another tool's memory definition; do not pool them without establishing equivalence.

**Bounds and failure handling:** five serial cycles only; concurrent starts are refused. Leaving/backgrounding the app or requesting Stop cancels the protocol. The sampler stops independently after six minutes or 8,000 samples and restores the previous auto-lock setting. A JavaScript cancellation cannot forcibly interrupt a native ONNX operation already in progress. Sample errors, native timeout, a sample gap greater than 250 ms, or inadequate final-window coverage mark memory capture incomplete. These are engineering completeness rules, not physiological or leak thresholds. Partial traces and failures are retained when available.

The sampler captures hardware model code, OS/app build fields, and start/end thermal and Low Power Mode states. It does not collect a device name, serial number, UDID or health readings. System-uptime access is used only for elapsed duration, with the native required-reason declaration; no uptime origin or boot time is exported. [R21] Reports stay in memory until the user explicitly shares them.

**Local verification:** 11 protocol/summary tests and 7 installer tests passed, using a simulated clock, synthetic memory samples and temporary projects. They cover exact cycle/wait behavior, cancellation, parity/runtime failures, native timeout, sparse/invalid samples, concurrency, dry-run, repeat installation, guarded rollback, source/model conflicts and symlinks. JavaScript syntax, TypeScript bridge parsing, native-module configuration and privacy-manifest structure were also checked. At preparation time, Swift/CocoaPods integration and phone execution could not be checked in this Linux workspace. **The later user-supplied report in Section 5.13 now demonstrates the native sampler and screen working through the normal five-cycle path on the physical iPhone.** This is device execution evidence, not local compilation by the document author or physical-device verification of every cancellation/failure path.

The installer preflights the known profiling source and artifact hashes, refuses conflicting edits, and creates a backup for its single existing-screen edit. It leaves the working Podfile intact. CocoaPods integration and a native app rebuild are required once; a JavaScript reload alone cannot add the sampler. [R18]

Download the ZIP to the Mac's Downloads folder, then run:

```bash
unzip -n "$HOME/Downloads/cdd-memory-automation.zip" -d "$HOME/Downloads/cdd-memory-automation"
(
set -e
node "$HOME/Downloads/cdd-memory-automation/install_memory_automation.cjs" \
  --project /Users/rithika/Desktop/cddapp --apply
cd /Users/rithika/Desktop/cddapp
npx pod-install
open -a Xcode /Users/rithika/Desktop/cddapp/ios/cddapp.xcworkspace
)
```

Use a new extraction directory if an older bundle already occupies that folder. Connect the iPhone for installation, use the working signing settings and Release configuration, and build/run the existing workspace. After installation, stop Xcode's run and launch from the phone icon. A USB connection is not required for the automatic test itself.

Start a fresh app process and go directly to **Test ML model → Profile synthetic inference → Automated memory test** without first running the old tests. Tap **Run automated memory test**, keep the app foregrounded, and wait about one minute. Share the summary JSON; retain a full trace for deeper analysis. Document charging/debugger conditions. Incomplete results should be preserved and investigated rather than repeatedly rerun to obtain a favorable number. The README also documents guarded rollback.


### 5.13 First automatic five-cycle device report — September 24, 21:10 UTC

Evidence file: **`iphone_memory_20260924T211021497Z.json`**, preserving the user-supplied compact summary. The interval is 2026-09-24T21:10:21.497Z to 21:11:23.246Z. The report identifies physical hardware `iPhone17,1`, iOS 26.6.2/build 23G90, app version 1.0.0/build 1 and `developmentBuild: false`. Earlier supplied Settings evidence names the device iPhone 16 Pro.

**Outcome:** `complete`, `inferencePassed` and `memorySamplingComplete` are true, with no cancellation or reported failure. Each of the five cycles reports 111 attempted/successful calls, zero parity failures and zero runtime failures: **555/555 successful calls**. These repeat the same normalized synthetic fixture. The app reports 1,251 memory samples, no kernel/sampling errors, a largest sampling gap of 54.962 ms and normal completion. Total test wall time is 61.748 seconds.

All memory values below use decimal MB = 1,000,000 bytes and describe whole-app physical footprint.

| Stage | Before cycle (MB) | Largest observed sample in cycle (MB) | Immediately after release (MB) | After ten-second wait: median (MB) | Settled minus baseline (MB) |
|---|---:|---:|---:|---:|---:|
| Baseline | — | — | — | 35.145 | — |
| Cycle 1 | 35.227 | 72.091 | 71.943 | 70.714 | +35.570 |
| Cycle 2 | 70.714 | 70.714 | 68.617 | 68.503 | +33.358 |
| Cycle 3 | 68.503 | 68.503 | 56.362 | 56.362 | +21.217 |
| Cycle 4 | 56.362 | 58.295 | 58.213 | 54.593 | +19.448 |
| Cycle 5 | 54.593 | 54.593 | 50.234 | 50.169 | +15.024 |

The largest sampled footprint is **72.090592 MB**, approximately **36.945944 MB above baseline**. Settled memory decreases at every cycle, ending **20.545512 MB below the first settled value** and **15.024200 MB above baseline**. The reported waits range from 10.01394 to 10.01643 seconds. Baseline has 20 samples spanning 950.012 ms in its final window; settled windows have 20–21 samples spanning approximately 950–1,000 ms. These reported coverage/gap values meet the controller's predefined completeness checks.

**Interpretation:** this run shows no progressively increasing series of settled memory values across five load/run/release cycles. It supports completion of the initial automated memory observation. It does not prove that no allocations leak, identify the origin of remaining memory, establish an acceptable memory budget, or describe hour-long/production behavior. Preserve `leakAssessment: not_determined`. Whole-app caches, allocators, first-use code/data, instrumentation and retained reports remain part of the measurement. Declining footprint alone cannot identify which component released or reclaimed memory. The 50 ms sampling interval can miss short peaks; some cycles' largest observed value equals their starting sample without implying that session creation needed no memory.

**Timing from this instrumented run:**

| Cycle | Measured calls | Mean (ms) | Nearest-rank p50 (ms) | Nearest-rank p95 (ms) | Maximum (ms) | Session creation (ms) | Release (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | 100 | 10.653 | 11.124 | 12.131 | 13.133 | 107.421 | 2.311 |
| 2 | 100 | 6.058 | 6.476 | 6.986 | 7.216 | 52.164 | 1.445 |
| 3 | 100 | 11.058 | 11.259 | 12.306 | 12.870 | 49.991 | 3.053 |
| 4 | 100 | 11.004 | 11.416 | 12.225 | 13.398 | 54.610 | 3.357 |
| 5 | 100 | 10.976 | 11.160 | 12.183 | 12.756 | 55.590 | 3.073 |

Keep these distributions separate from the three earlier inference-only profiles: the report explicitly states that their timings are not comparable. The first session is slower to create than the next four, but OS file-cache state is uncontrolled; do not identify a true cold app launch. Low Power Mode is false and thermal-state code is 0 at both recorded endpoints. Endpoint readings do not establish conditions throughout the test or explain why cycle 2 has lower inference latency. Debugger attachment, charging/USB state, background workload, confirmed fresh-process launch, Xcode version and Git commit are not established by this report.

**Verification performed here:** the 555-call total, per-cycle deltas, final-minus-first settled delta, decreasing settled sequence, and summary peak consistency reproduce. Counts, reported sampling coverage, waits, error/completion flags and latency ordering are internally consistent. Model/fixture identifiers and ONNX Runtime version match the previously supplied phone report. Source hashes match the local delivered native sampler and controller:

```text
nativeSourceSha256:
9eb9c09a97a4f424405d65548859cbdd78f5c8f25d3e8b63b05967c173079937
protocolSourceSha256:
7f6451f394599f17d7449b77989e57fa8676c5ebf58d21740a690af6625d1e30
```

These identifiers originate from installer metadata; they are not a new runtime hash of the installed binary or model. The supplied report has `fullTraceOmitted: true`. Consequently, the memory medians, largest sample, sampling-gap maximum and latency percentiles **cannot be independently recomputed from raw samples here**. The checks above verify summary consistency, not independent phone execution. The native first sample separately reports resident size of 97,533,952 bytes; resident size must not be substituted for the primary physical-footprint metric.

**Status change:** native integration and the normal five-cycle device path are now demonstrated by a user-run result. Initial synthetic execution, timing observations and repeated-cycle memory observations can be marked complete at this scope. Energy, actual app-launch duration, long-session/multi-device coverage, raw-PPG preprocessing, real-input coverage, calibration integration and predictive accuracy are separate remaining work. No further manual memory screenshots or repeated identical runs are needed simply to confirm this milestone. Retain the full trace if already available for future investigation; do not rerun only to obtain a lower peak. The original phone model remains unchanged, and these numbers are not a phone benchmark of the new CNN candidate.

## 6. Current experiment and model-selection recommendation

### 6.1 Augmentation inconsistency

The reviewed training code normalizes all three channels, then `augment_beat` takes the normalized PPG channel and reconstructs its first and second derivatives. Those reconstructed channels do not receive their original derivative-channel normalization. Validation and the phone use the separately normalized cached derivatives.

A synthetic-waveform check with every random transformation disabled confirmed that this still changes the derivative inputs while leaving PPG unchanged. Away from padding/boundary effects, the scale discrepancy is approximately 30.48-fold for dPPG and 199.61-fold for d²PPG, derived from the saved channel standard deviations. Padding, masking, stretching, and timing-feature consistency add further questions.

This establishes an input inconsistency. It does not establish that it is the sole cause of near-constant predictions.

### 6.2 Completed augmentation comparison

| Item | Setting |
|---|---|
| Array job | `43160017` |
| Task 0 / task 1 | Original augmentation on / augmentation off |
| Concurrency | Sequential, one GPU task at a time |
| Initialization | Seed 125; initial state hashes compared |
| Data | Existing train and validation caches only |
| Model/loss/optimizer | Same reviewed definitions in both arms |
| Training limit | Up to 500 epochs, patience 80; scheduler follows the reviewed code |
| Slurm limit | Two hours per task; queue time separate |
| Selection/evaluation | Validation only; no new test-set evaluation |
| Output isolation | New experiment folder; original checkpoint, caches, and phone package preserved |
| Status at writing | Both validation reports supplied; starting weights and cache hashes confirmed identical |

Experiment directory:

```text
/orange/xiangyan/rithika/cdd/outputs/iphone_inference/augmentation_comparison_20260924T034651067153Z
```

This is a diagnostic comparison of the entire augmentation pipeline. Disabling augmentation helped, but this does not isolate which operation caused the benefit. A single seed is not sufficient for a final superiority claim. The two arms share starting weights, but are not promised to be bitwise identical in GPU execution.

### 6.3 Observed validation results

All results in this table use the existing validation split. They are distinct from the original checkpoint's test results in Section 2.

| Method | SBP MAE (mmHg) | DBP MAE (mmHg) | SBP Pearson r | DBP Pearson r | SBP prediction SD (mmHg) | DBP prediction SD (mmHg) |
|---|---:|---:|---:|---:|---:|---:|
| Training-mean baseline | 13.8758 | 9.6640 | Undefined | Undefined | 0.000 | 0.000 |
| Training-median baseline | 13.8099 | 9.6142 | Undefined | Undefined | 0.000 | 0.000 |
| Augmentation on | 13.9589 | 9.6288 | 0.0288 | 0.1637 | 1.957 | 0.952 |
| Augmentation off | **13.2848** | **8.8738** | **0.2953** | **0.3478** | **8.974** | **4.638** |

The augmentation-on run selected epoch **6** and completed **86** epochs. The augmentation-off run selected epoch **12** and completed **92** epochs. These are validation-selected checkpoints, not the final epoch weights. Constant predictions have undefined Pearson correlation because their variance is zero.

- Against augmentation on, disabling augmentation reduces SBP MAE by **0.6741 mmHg (4.83%)** and DBP MAE by **0.7550 mmHg (7.84%)**.
- Against the training-median baseline, the reductions are **0.5251 mmHg (3.80%)** and **0.7404 mmHg (7.70%)**, respectively.
- The higher correlations and wider prediction distributions are consistent with learning more waveform-related variation. Wider predictions alone do not demonstrate accuracy; assess them alongside error, correlation, and calibration.
- No multi-seed uncertainty estimate, new test-set evaluation, personal-calibration evaluation of this candidate, or on-device test of these new weights has been supplied.

**Decision:** use augmentation off as the working research configuration while investigating labels and optimization. Preserve both experiment arms. Do not replace the phone bundle merely because a candidate wins this one comparison. A later candidate export must use that candidate's own saved normalization and manifest, followed by fresh conversion/device parity tests.

Candidate files are under the experiment directory:

```text
augmentation_off/best_model.pth
augmentation_off/normalization.json
augmentation_off/validation_report.json
augmentation_off/training_history.json
augmentation_off/run_manifest.json
```

### 6.4 What “SOTA” means and what to try next

If “SOA” meant **SOTA**, it means *state of the art*. There is no single universally best PPG-to-BP model independent of input sensors, subject split, calibration assumptions, dataset, and deployment conditions.

A published benchmarking study compared five models and found XResNet1d101 strongest in its setting, while external-dataset errors worsened substantially. Its reported uncalibrated PulseDB MAEs were 14.0/8.5 mmHg, and external SBP errors ranged from 15.0 to 25.1 mmHg. These are context, not directly comparable scores for this project’s beat-level MIMIC-BP labels. [R8]

A February 2026 preprint benchmarks models under another dataset/protocol and explores demographic inputs. It is useful as a candidate research direction, not proof that its reported best method will transfer to a wrist device or this dataset. [R9]

Recommended sequence, based on the audit and code review:

1. **Retain augmentation off as the research starting point.** The comparison now supports this choice. Review its learning curve and repeat the selected protocol across seeds before a final superiority claim. Keep the original test results as historical evidence; do not repeatedly tune candidates against that test set.
2. **Act on the completed audits.** Endpoint saturation is confirmed, but masking produced only a small, mixed validation change. The history rows show late divergence, and the fixed-checkpoint audit shows modest fitting and reduced baseline-relative gains on validation (Sections 6.7–6.8). Review waveform examples before any segmentation or label change. Filter initialization is a lower-priority explanation in this sample. Label corruption has not been established.
3. **Use the completed small-set capacity result.** The probe in Section 6.9 fitted all 128 selected training examples closely under the simplified recipe. This addresses basic small-set fitting capacity, while leaving label validity, the original optimization recipe, and generalization unresolved. Do not report it as held-out accuracy.
4. **Build on the completed CNN-only/cBP-Tnet comparison.** The two new arms have nearly identical validation errors, with 91.1% fewer parameters for CNN-only (Section 6.13). Use CNN-only as the provisional smaller development candidate. Repeat both matched arms under two additional predeclared seeds before claiming an architecture advantage; preserve the recipe, stopping/selection rule and data contracts. Three seeds are a practical initial variability check, not proof of equivalence or sufficiency for clinical validation. Do not pick only the best seed or tune against the test set.
5. **Evaluate multi-beat context if labels and acquisition support it.** Several consecutive beats may support more stable recording estimates, but require redesigned fixtures/input contracts and fair comparison at the same prediction unit.
6. **Use a published benchmark model as a reference experiment.** The XResNet benchmark’s code is available [R10]; its input length, preprocessing, data, license, and computational cost need review before adoption. It is not a drop-in replacement for `[1,3,250]`.
7. **Validate deployment-domain performance.** Hospital-recorded PPG and the eventual wearable signal can differ. Collect approved sensor-specific paired data and compare calibration-dependent and calibration-free modes before making a wearable claim.

If demographic features are explored, report a demographics-only baseline alongside PPG-plus-demographics. If calibration is used, report a reference-only baseline. Otherwise, improved aggregate accuracy can hide the absence of useful information from the waveform.

Do not prioritize quantization or pruning solely from the synthetic phone timings; fewer parameters also do not establish a measured speed, memory or battery improvement. First establish useful prediction; then compare size, memory, latency, energy, and accuracy under the same protocol. Any optimization needs fresh numerical and device checks.

### 6.5 Completed diagnostic: label windows and filter context

The script `audit_cbp_label_alignment.py` ran as CPU job **43161373**, with a 20-minute limit, two CPUs, and 4 GB RAM. The supplied log reports eight subjects and 24 segments from each of the training and validation splits. It did not open the test split or retrain a network, and reported that existing labels, caches, and models were unchanged. Six local waveform examples were generated; their actual recorded waveforms have not been inspected by the document author.

Report directory:

```text
/orange/xiangyan/rithika/cdd/outputs/iphone_inference/label_alignment_audit_20260924T042620949560Z
```

The aggregate file is `label_alignment_report.json`; the job log is `/orange/xiangyan/rithika/cdd/logs/cbp_labels_43161373.log`.

The audit checks the reviewed preprocessing functions against a source fingerprint before executing only those definitions. It checks that train/validation subject lists are disjoint, records source/input fingerprints, and verifies exact float32 label reproduction against the original generator for the first usable segment in each split.

The report includes:

- Accepted/rejected beat counts and processing errors.
- How often the ABP label window contains multiple later PPG peaks, and whether the chosen ABP peak falls outside the input PPG beat interval.
- Changes in labels when the ABP filter is applied with full-segment context rather than reset at every label window.
- Raw-window extrema versus current selected labels, and median generated labels versus the dataset-provided segment labels.
- PPG maxima at interval boundaries and timing-proxy clipping, to inspect whether the peak-to-peak segmentation makes the timing feature uninformative.
- Up to six local waveform plots illustrating the current window and filter behavior.

These are diagnostic comparisons, **not corrected ground truth**. PPG and ABP peaks need not share the same timestamp, and a segment-level label need not equal one beat's pressure. Some audit windows may differ from the original cached rows because the training generator randomly caps beats per subject and does not save a row-to-source mapping. A difference therefore motivates inspection; it does not by itself justify changing labels or declaring them wrong.

**Observed results:** the actual HiPerGator execution reported source-label reproduction checks passing for both splits. The parity check applies to the first usable segment in each split, not every cached row. Earlier local synthetic checks used a SciPy peak-finder stand-in; the actual job used the configured `pyampd` preprocessing implementation.

| Diagnostic | Train sample | Validation sample |
|---|---:|---:|
| Subjects / segments | 8 / 24 | 8 / 24 |
| Candidate beats | 1,069 | 971 |
| Accepted beats | 1,056 | 953 |
| Short PPG interval or ABP window (original combined counter) | 13 | 18 |
| Chosen ABP peak outside input PPG interval | 51.14% | 43.34% |
| ABP window contains at least two later PPG peaks | 98.96% | 94.75% |
| Label-selection fallback | 0% | 0% |
| PPG maximum at first or last sample | 99.905% | 99.895% |
| Upstroke proxy equals zero | 55.68% | 55.30% |
| Upstroke proxy clipped at 3 | 44.22% | 44.60% |

Only one accepted beat in each sampled split had an upstroke proxy between the endpoints. The code computes `clip((argmax(beat) / 125) / 0.15, 0, 3)` on a beat cut between successive PPG peaks. If its maximum is the first sample, the result is zero. If the maximum is near the end of an 80-sample interval, the result is approximately `(79 / 125) / 0.15 = 4.21`, which clips to 3. This is not behaving as a useful continuous upstroke-duration measurement in this sample. It may still encode endpoint/amplitude information; these results do not prove that removing it will improve predictions.

Absolute differences when changing only ABP filter context (mmHg):

| Split / output | Mean | Median | 95th percentile | Maximum |
|---|---:|---:|---:|---:|
| Train SBP | 0.00308 | 0.00130 | 0.01108 | 0.02226 |
| Train DBP | 0.02969 | 0.000008 | 0.21647 | 0.58399 |
| Validation SBP | 0.00293 | 0.00064 | 0.01795 | 0.04588 |
| Validation DBP | 0.000029 | 0.000015 | 0.000076 | 0.00338 |

These small differences make filter resetting a lower-priority explanation for the observed model errors, within this sample. They do not establish filter behavior on every recording.

Other absolute label comparisons (mmHg):

| Comparison / split | SBP mean / 95th percentile / maximum | DBP mean / 95th percentile / maximum |
|---|---:|---:|
| Raw-window extrema vs current labels, train | 0.980 / 4.054 / 8.825 | 0.882 / 3.464 / 13.939 |
| Raw-window extrema vs current labels, validation | 0.750 / 2.963 / 7.006 | 1.264 / 5.247 / 9.643 |
| Per-segment median current label vs provided label, train (24 segments) | 1.305 / 2.768 / 4.027 | 0.661 / 1.736 / 4.526 |
| Per-segment median current label vs provided label, validation (24 segments) | 1.236 / 3.424 / 4.429 | 0.535 / 1.226 / 1.732 |

The modest aggregate disagreement with provided segment labels does not suggest a large systematic label-scale error in this sample. It also does not certify beat-level alignment: aggregation can hide individual differences, and neither alternative is established ground truth for the input beat.

**Interpretation and decision:** investigate the timing feature directly. Keep the current labels and caches during that experiment. Review the six recorded waveform examples within the dataset environment before proposing a revised beat definition. A selected ABP peak outside a PPG interval is a window diagnostic, not a measured percentage of wrong labels; the signals' peaks need not coincide. A subsequent preprocessing redesign should define corresponding signal intervals and feature semantics explicitly, preserve traceability to raw segments, and receive its own versioned caches and evaluation.

### 6.6 Completed experiment: keep versus mask the upstroke proxy

`compare_cbp_upstroke.py` used the reviewed model/trainer definitions and the same cached training/validation data. It did not run the original training `main`, regenerate caches, access the test cache, or update phone assets. This experiment trained two new models in a separate experiment directory; both supplied logs report `ARM COMPLETE`.

| Item | Setting |
|---|---|
| Control arm | `keep_upstroke`: retain both normalized timing inputs |
| Masked arm | `mask_upstroke`: set normalized timing column 0 to zero for every training and validation example |
| Retained inputs | All three waveform channels and normalized beat-interval timing column 1 |
| Augmentation | Off in both arms |
| Starting point | Fresh, identically seeded weights; seed 125; initial weight hashes compared |
| Architecture / loss / optimizer | Same definitions as the completed augmentation comparison |
| Training budget | Up to 500 epochs, patience 80, learning rate 0.0003, batch size 256, 30 beats per subject per epoch |
| Resources | Two sequential Slurm array tasks; one B200 GPU, four CPUs, 16 GB RAM, two-hour limit per task; queue time separate |
| Selection and reporting | Validation only; MAE, Pearson correlation, prediction SD, constant baselines, selected epoch, and completed epochs |
| Isolation | New timestamped folder; existing checkpoint, caches, completed experiments, and app assets retained |
| Status | Both arm reports supplied; matching initial-weight, cache, source, and normalization fingerprints |

Masking occurs **after normalization**, so zero represents the standardized mean rather than raw timing zero. Both arms retain timing input shape `[B,2]`; keeping architecture and parameter count unchanged isolates access to the feature. This is a retraining comparison, not an inference-only perturbation of a model trained to expect a varying input. It does not repair the timing definition or remove waveform information correlated with that feature.

The new control deliberately repeats the existing augmentation-off configuration so the two arms share one experiment manifest and can be checked together. It produced 13.3956/9.0524 mmHg, compared with the earlier 13.2848/8.8738 mmHg. This difference must be recorded rather than silently treating the old result as the matched control. GPU execution was not configured to guarantee bitwise reproducibility; the supplied outputs do not isolate the reason for this repeat difference or estimate a variance distribution. Small effects require further seeds before a strong conclusion.

Experiment directory:

```text
/orange/xiangyan/rithika/cdd/outputs/iphone_inference/upstroke_comparison_20260924T044100934260Z
```

Both arms used Python 3.13.5, PyTorch 2.10.0+cu128, NumPy 2.2.6, and an NVIDIA B200. The result excerpt did not include the Slurm job ID. Each validation report covers 39,000 beats.

| Method | SBP MAE (mmHg) | DBP MAE (mmHg) | SBP r | DBP r | SBP prediction SD | DBP prediction SD | Best epoch / completed epochs |
|---|---:|---:|---:|---:|---:|---:|---:|
| Training-median baseline | 13.8099 | 9.6142 | Undefined | Undefined | 0 | 0 | — |
| Keep upstroke | **13.3956** | 9.0524 | 0.2814 | 0.3424 | 8.7209 | 4.3873 | 13 / 93 |
| Mask upstroke | 13.4363 | **8.8478** | 0.2864 | 0.3476 | 9.7344 | 5.4954 | 28 / 108 |

The shared validation target SDs are 17.1836 mmHg for SBP and 12.2257 mmHg for DBP. Wider masked predictions alone do not establish better accuracy.

- Masking worsened SBP MAE by **0.0407 mmHg (0.30%)**, while improving DBP MAE by **0.2046 mmHg (2.26%)**.
- The sum of SBP and DBP MAEs fell from **22.4480 to 22.2841 mmHg**, a reduction of 0.1639. This is the model-selection objective's general form, not a claim that both outputs improved. The trainer selects epochs using its logged batch-average SBP-plus-DBP MAE; the report recomputes metrics over all examples.
- Correlations rose only slightly, by approximately 0.0051 for SBP and 0.0052 for DBP.
- The repeated keep-upstroke configuration was worse than the earlier augmentation-off run by **0.1108 SBP / 0.1786 DBP mmHg**. These differences are a caution when interpreting the masking result, not a statistical uncertainty estimate.
- The suspect feature's name and physiological interpretation remain problematic, but this experiment does not show that masking it solves the model's limited predictive value. Both configurations still provide only modest gains over constant population predictions.

**Decision:** retain both research checkpoints and stop treating the upstroke proxy as the leading demonstrated cause. Keep augmentation off for development. The subsequent history review supports retaining the earlier selected epochs; the completed fixed-checkpoint audit in Section 6.8 motivated the successful capacity probe in Section 6.9 and the prepared architecture comparison in Section 6.10. Avoid selecting a deployable winner from these small, single-seed differences. No fresh test-set or device validation of these checkpoints is reported.

Recorded fingerprints:

| Item | SHA-256 |
|---|---|
| Shared initial weights | `975d965aedc3e79b477182ce4168e79d9b400bc8c8ae295989732ac3f81a02c3` |
| Training cache | `3442299cb3996386916707cd88f89e5bc5cbdf08077d3e8d94ed181b5fdb4940` |
| Validation cache | `219dec34b415dce41e27c9ab4a8e9727024877987295f65f63adfa550e8ed4df` |
| Source snapshot | `18658a5309d85b9875251a705d091b133fc678bfe33bdd6160d6c8f23d82597e` |
| Normalization snapshot | `bc8a28b7ca84faa00644fa7d13ae706705ecd47b9543296753273555be3aba41` |
| Keep-upstroke checkpoint | `d5689556e2ed6e22df2af4f6a2586e2b039f0c7eef7aef860dcd9d87919c5391` |
| Mask-upstroke checkpoint | `5e29bded0744941b0dc99daf30d5b79327194e32517b60400fbf9ecec3d5b6fc` |

Each arm saves `best_model.pth`, `validation_report.json`, `training_history.json`, `run_manifest.json`, `normalization.json`, and `input_policy.json`. The masked checkpoint requires the saved post-normalization mask `[0,1]` in any future inference/export path. The current phone exporter must not be assumed to implement that policy; neither arm is deployment-ready. Changing the app to send raw zero in that slot would not reproduce this experiment.

**Verification:** local checks covered Python 3.9-compatible syntax, rejection of changed reviewed model definitions, correct masking with untouched beat interval and raw input, disabled augmentation, train/validation scope, mocked Slurm submission with unchanged existing files, and summary rejection of unequal starting weights. PyTorch/CUDA were unavailable in the document author's workspace; the supplied HiPerGator logs provide the completed training evidence. The posted reports have matching recorded fingerprints; the summary command below can additionally check the saved checkpoint bytes against those reports.

### 6.7 Observed training histories: late divergence

The user supplied the following logged history values. These are two points per arm, not the full learning curves; all errors are MAE in mmHg.

| Arm | Point | Epoch | Train SBP | Validation SBP | Train DBP | Validation DBP |
|---|---|---:|---:|---:|---:|---:|
| Keep upstroke | Selected | 13 | 15.796 | 13.379 | 9.562 | 9.043 |
| Keep upstroke | Last | 93 | 13.978 | 15.524 | 8.468 | 9.092 |
| Mask upstroke | Selected | 28 | 15.220 | 13.420 | 9.193 | 8.845 |
| Mask upstroke | Last | 108 | 13.677 | 15.979 | 8.363 | 9.379 |

From selected epoch to last epoch:

- **Keep:** training SBP/DBP MAE fell by 1.818/1.094, while validation SBP/DBP MAE rose by 2.145/0.049.
- **Mask:** training SBP/DBP MAE fell by 1.543/0.830, while validation SBP/DBP MAE rose by 2.559/0.534.

The consistent SBP pattern is evidence of late deterioration in validation performance despite lower logged training error, consistent with overfitting. More epochs alone did not improve the selected validation objective in these runs. This supports the existing checkpoint selection at epochs 13 and 28; the successful model reports in Section 6.6 already use those selected weights. Nothing needs to be rolled back from the phone based on this history.

The higher training errors at the selected epochs do not mean validation data were necessarily easier or training failed. Training used dropout, batch-normalization training behavior, changing parameters, and up to 30 sampled beats per subject per epoch; validation used evaluation mode and all 39,000 validation beats. Logged epoch MAEs average batches, whereas the final report averages examples. Subject/target distributions can also differ. These conditions prevent treating the displayed train-minus-validation numbers as a precise generalization gap from one fixed model. The two selected history points also cannot identify the physiological or optimization cause of limited accuracy.

**Recommendation:** preserve early selection and augmentation-off settings. The matching-condition results are now available below and show both limited training fit and reduced benefit on validation. A small 1D CNN remains the next architecture baseline to consider after the bounded capacity probe; increasing model size is not supported by the current results.

### 6.8 Completed fixed-checkpoint train/validation audit

`audit_cbp_generalization.py` evaluates the exact keep-upstroke and mask-upstroke checkpoint hashes listed in Section 6.6. It runs each model on **all 220,000 training beats and all 39,000 validation beats**, with evaluation mode, dropout disabled, augmentation disabled, frozen parameters, the saved normalization, and the correct post-normalization timing mask. It computes per-example aggregate MAE, Pearson correlation, prediction/target spread, and training-mean/training-median baselines on each split.

The audit loads only the two reviewed architecture class definitions from the fingerprinted experiment source. It does not execute the training main, create an optimizer, train, recalibrate, rebuild caches, export a model, or access the test cache. It creates a new timestamped audit folder containing small metadata/source snapshots and an aggregate `generalization_report.json`. Existing checkpoint/cache bytes are fingerprinted before and after evaluation; in-memory weights and buffers are checked for changes as well. Raw inputs and per-beat predictions are not written into the report.

The validation rerun must reproduce each existing report within **0.01 mmHg MAE** and **0.002 Pearson r**. These are numerical reproduction tolerances, not BP-accuracy criteria. A mismatch is recorded and causes an explicit error so the new train/validation gap is not treated as settled evidence before the discrepancy is resolved.

This uses the **selected epoch-13 and epoch-28 weights**. The comparison trainer saved only its best checkpoint; the last-epoch weights from epochs 93 and 108 were not retained by that script. This audit therefore assesses the available selected models' training fit and generalization. It cannot reconstruct the exact final models or alone prove the mechanism behind their late deterioration.

Resource request: one B200 GPU, four CPUs, 16 GB RAM, and a **20-minute limit**, with queue time separate. Unlike the preceding comparison, it submits one evaluation task and performs no optimization steps.

**Execution status:** the supplied HiPerGator log reports completion on Python 3.13.5, PyTorch 2.10.0+cu128, and NumPy 2.2.6. Both validation reproduction checks passed. Model state and input-file hashes remained unchanged. Earlier local tests used synthetic stand-ins to check controller behavior; the following results come from the actual user-run audit.

Aggregate report:

```text
/orange/xiangyan/rithika/cdd/outputs/iphone_inference/generalization_audit_20260924T155422354621Z/generalization_report.json
```

| Method / split | SBP MAE (mmHg) | DBP MAE (mmHg) | SBP r | DBP r |
|---|---:|---:|---:|---:|
| Training mean / train | 14.5737 | 9.7393 | Undefined | Undefined |
| Training median / train | 14.5300 | 9.6729 | Undefined | Undefined |
| Keep upstroke / train | 13.3674 | 8.7216 | 0.4050 | 0.4643 |
| Mask upstroke / train | 12.7420 | 8.1336 | 0.4783 | 0.5209 |
| Training mean / validation | 13.8758 | 9.6640 | Undefined | Undefined |
| Training median / validation | 13.8099 | 9.6142 | Undefined | Undefined |
| Keep upstroke / validation | 13.3956 | 9.0524 | 0.2814 | 0.3424 |
| Mask upstroke / validation | 13.4363 | 8.8478 | 0.2864 | 0.3476 |

Validation-minus-training MAE is **+0.0282 SBP / +0.3308 DBP** for keep-upstroke and **+0.6943 / +0.7142** for mask-upstroke. These selected models do not exhibit a large raw gap of near-zero training error versus large validation error. Their training fit is itself modest.

However, the training-median SBP baseline has **0.7201 mmHg lower error on validation than on training**. Comparing gains over that same training-derived constant helps reveal what the raw gap hides:

| Model | SBP gain over median: train / validation | DBP gain over median: train / validation |
|---|---:|---:|
| Keep upstroke | 1.1626 / 0.4143 mmHg | 0.9513 / 0.5618 mmHg |
| Mask upstroke | 1.7880 / 0.3736 mmHg | 1.5393 / 0.7664 mmHg |

Both models learn more useful variation on training subjects than on validation subjects, as also reflected in their lower validation correlations. The masked model fits training better than the keep model, but its SBP validation result does not improve. This is evidence of limited transfer of the learned benefit; the small raw MAE gaps should not be interpreted as proof that generalization is solved. Conversely, late overfitting does not by itself explain the relatively high training errors at the selected checkpoints. These results do not distinguish optimization, loss/regularization choices, limited information in the inputs, or label ambiguity.

**Decision:** finish the saved-checkpoint audits here. The subsequent bounded capacity probe passed; proceed to the prepared model comparison. The next architecture candidate remains a small 1D CNN evaluated against cBP-Tnet under one explicit, shared training/evaluation protocol. Continue to keep model selection on development/validation data and reserve any new final evaluation appropriately.

### 6.9 Completed training-only capacity probe

`check_cbp_tiny_fit.py` asks: **can a fresh cBP-Tnet fit 128 fixed training examples when the training recipe is simplified?** It samples 16 training subjects and eight cached beats per subject without replacement, with seed 125. It reads only the existing training cache plus the reviewed experiment source and normalization snapshots. It never reads validation/test caches, saved checkpoint weights, or phone assets.

This is intentionally a memorization diagnostic. The same 128 beats are used for parameter updates and measurements; there is no held-out performance estimate.

| Setting | Probe choice |
|---|---|
| Network | Existing cBP-Tnet architecture, fresh weights, dropout set to zero |
| Inputs | Saved training-input normalization; upstroke slot masked after normalization; beat interval retained |
| Target transform | Separate SBP/DBP mean and SD fitted on the 128 selected labels; predictions converted back to mmHg for reporting |
| Objective | Unweighted MSE on standardized targets, replacing the production weighted Huber loss |
| Optimizer | AdamW, learning rate 0.0003, weight decay zero, gradient-norm limit 4 |
| Batch | All 128 fixed examples on every update; no augmentation or epoch resampling |
| Batch normalization | Running statistics held at their initial values; affine parameters remain trainable |
| Training budget | At most 2,000 updates or 20 minutes of fitting; check at step 0, step 1, every 50 updates, and at termination |
| Early stop | SBP and DBP training MAE each at most 1 mmHg at three consecutive checks |
| Resources | One B200 GPU, four CPUs, 16 GB RAM; 30-minute job limit, queue time separate |
| Outputs | Aggregate report/history, local selected-row indices and metadata; no trained weights saved |

The 1 mmHg threshold is an engineering target for fitting these same examples, **not a clinical acceptance threshold**. A budget-limited failure to meet it is inconclusive rather than proof of incorrect labels or a broken model. Several training choices change together, so this probe does not identify which original component needs adjustment.

Implementation uses `model.eval()` to hold module behavior fixed while leaving parameter gradients enabled. Evaluation mode and autograd control are separate in PyTorch. [R11] The simplified squared-error objective follows `MSELoss` semantics. [R12] The Transformer inference fast path is disabled for consistent paths during fit checks. [R13]

The script checks for finite, nonzero first-step gradients in the CNN, Transformer, and both output heads. It also reports exact duplicate normalized inputs and the minimum achievable MAE caused by conflicting labels within such duplicate groups. This only addresses exact duplicates; it does not characterize near-duplicates or certify label correctness. Model buffers and the training-cache fingerprint must remain unchanged. No trained parameters are saved, so the probe cannot silently become the app's inference model.

**Completed result:** HiPerGator job **43223464** reached the fitting target at step 300. The same 128 training beats were used throughout; there was no validation or test access.

| Measurement | SBP MAE (mmHg) | DBP MAE (mmHg) |
|---|---:|---:|
| Subset-median constant baseline | 14.1264 | 9.1022 |
| Initial model, step 0 | 14.3676 | 9.1905 |
| Step 50 | 11.6022 | 7.3141 |
| Step 100 | 6.3133 | 4.6571 |
| Step 150 | 1.8429 | 1.1496 |
| Step 200 | 0.4768 | 0.3097 |
| Best observed combined MAE, step 250 | 0.2588 | 0.1460 |
| Last, step 300 | 0.2592 | 0.3482 |

The first update briefly increased MAE to 15.5587/10.0693; subsequent checks decreased substantially. The step-300 DBP increase does not invalidate the stop rule: both outputs were below 1 mmHg at all three consecutive checks 200, 250, and 300. The best observed step is based on the combined MAE at measurement checkpoints, not a guarantee of the absolute best intermediate update.

All 128 normalized input pairs were unique at exact byte equality. The exact-duplicate conflict lower bound was therefore zero for both outputs. This is not evidence that labels are correct or that near-duplicates are absent.

Finite, nonzero initial gradient norms were reported for CNN **2.125725**, Transformer **2.215798**, SBP head **1.419824**, and DBP head **0.523122**. The script completed without its input-hash or frozen-buffer guards failing. It saved no trained weights and changed no existing assets.

```text
Log: /orange/xiangyan/rithika/cdd/logs/cbp_tiny_fit_43223464.log
Report: /orange/xiangyan/rithika/cdd/outputs/iphone_inference/tiny_fit_20260924T191057074396Z/tiny_fit_report.json
```

**Interpretation and decision:** the model can fit these examples under the simplified recipe. The result does not show that the original optimizer/loss settings work, that labels are physiologically correct, or that the learned mapping generalizes. A large model can memorize finite examples, including imperfect labels. Multiple settings changed together, so this is not an ablation identifying the original cause. No repeat of this capacity probe is needed now. Proceed to the architecture comparison below, keeping future test evaluation separate from development.

**Verification provenance:** earlier local checks used synthetic stand-ins for controller behavior. The result above is actual optimization reported in the user-run HiPerGator log. Runtime duration and peak GPU memory were not supplied in this excerpt; they must not be inferred from the 300-update count.

### 6.10 Prepared CNN-only versus cBP-Tnet comparison

The next script is `compare_cbp_cnn.py`. It asks whether the Transformer and positional encoding add development-set predictive benefit when both models receive the same data and training recipe.

**Architecture arms:**

- `cnn_only`: retain the original four residual convolution blocks, pooling, LayerNorm, timing embedding, and separate SBP/DBP heads; remove all Transformer encoder layers and positional encoding. Pool the normalized CNN features over time. The reviewed dimensions imply 464,962 trainable parameters; the run prints its instantiated count.
- `cbp_tnet`: retain the full reviewed architecture with 5,219,394 trainable parameters.

Each process instantiates the original architecture with the same seed before the CNN arm deletes the Transformer components. Consequently, shared initial weights match even though whole-model shapes differ. The summary checks their fingerprints. The data sampler uses its own per-epoch random generator and records row-order fingerprints, independent of model/dropout randomness; overlapping epoch schedules must match.

| Setting | Shared development protocol |
|---|---|
| Data | Existing fingerprinted 220,000 training beats and 39,000 validation beats; no test cache opened |
| Split guard | Current actual patient-name lists must be disjoint; 1,100/195 counts and cache local-index structure checked. Historical cache identity remains reconstructed; see Section 6.11. |
| Input preparation | Existing channel/timing normalization; upstroke slot zeroed after normalization; beat interval retained; augmentation off |
| Training examples | 30 cached beats per training subject without replacement each epoch, 33,000 per epoch; shuffled identically across arms |
| Target transform | SBP and DBP mean/SD fitted only on all training labels |
| Loss | Mean squared error on standardized targets; no clinical-range weighting |
| Network output | Wrapper converts outputs back to mmHg inside `forward`; saved output mean/SD are model buffers |
| Optimizer | AdamW, constant learning rate 0.0003, weight decay 0.0001, gradient-norm limit 4 |
| Regularization | Architecture dropout argument 0.1; existing CNN dropout uses one quarter of that; ordinary train-mode BatchNorm updates |
| Batch/seed | Batch size 256; seed 125; full FP32, TF32 off |
| Validation/selection | All validation beats each epoch; lowest arithmetic mean of SBP/DBP MAE in mmHg; retain an initial epoch-0 reference checkpoint if nothing improves |
| Stop | Maximum 120 epochs, or 25 consecutive epochs without a lower selection score, or 75-minute training/epoch-validation budget |
| Final measurements | Reload selected checkpoint; reproduce saved validation MAE within 0.0001 mmHg; evaluate all training beats under the same evaluation mode |
| Resources | Two sequential Slurm array tasks, one B200 GPU/four CPUs/16 GB each; 90-minute limit each, at most three hours running time plus queue time |

This is a **new shared recipe**, not the old weighted-Huber experiment with architecture as its only change. Directly compare these two new arms. Differences from historical runs cannot be assigned solely to architecture, target scaling, dropout, weight decay, or BatchNorm behavior. The tiny-fit probe had frozen BatchNorm statistics, no dropout, and no weight decay; this development comparison intentionally restores ordinary training behavior and modest regularization. Hyperparameters are practical starting choices, not established optima.

Early stopping may give the arms different epoch counts. A time-budget stop, partial epoch, or epoch-0 selection is flagged by the summary and must be considered before ranking. This is one seed and provides no seed-variability estimate or statistically established superiority. Both models still see the current beat segmentation and label construction; removing the Transformer does not repair those inputs. PyTorch seeds/settings improve reproducibility but do not guarantee bitwise equivalence across environments. [R14]

**Artifacts and deployment boundary:** every submission creates a new `cnn_comparison_<UTC timestamp>` folder. It snapshots source, input normalization, controller and experiment settings, and writes each arm's `research_checkpoint.pt`, `model_contract.json`, `training_history.json`, and `validation_report.json`. The report includes baselines, correlations, prediction spread, full selected-checkpoint train/validation metrics, parameter count, elapsed training/validation time, and peak allocated training-GPU tensor memory. That memory measurement is not phone inference memory. Cache fingerprints are checked again after training.

The checkpoint is a structured research payload. Reconstruct it with this script's matching `build_model`, load its `state_dict`, and apply saved input normalization/masking externally; output de-standardization is already inside the wrapper and must not be applied twice. The old exporter is not compatible without explicit changes. Existing caches, production models, calibration state, and phone assets are untouched. No new mobile or clinical claim follows automatically.

**Preparation status:** local tests passed for Python 3.9 syntax, pinned architecture extraction, balanced/reproducible sampling independent of model RNG, normalization/masking, numerical metric fixtures, output-wrapper shape and units using stand-ins, mocked bounded Slurm submission, unchanged protected files, and summary guards rejecting mismatched epoch samples. GPU execution occurred on the user’s HiPerGator environment; completed reports are now recorded in Section 6.13. It was not remotely executed by the document author.

### 6.11 CNN comparison failure and identity-guard repair

The user reported both workers failing in `cnn_comparison_20260924T192638102205Z` at `np.intersect1d(subjects['train'], subjects['val'])`. This was a defect in the supplied comparison script. The pinned preprocessing source appends `subj_idx` from `range(len(PPG_list))` in each call to `generate_features`; these are **split-local array positions**, not globally unique patient identities. Repeated numeric positions across splits do not themselves establish patient leakage.

Both failures occurred before network construction/optimization in the comparison worker, so the failed attempt supplies no model comparison results. Existing phone assets and earlier checkpoints were not targets of these workers. Preserve the failed directory/logs; repaired submission uses a fresh timestamped experiment.

The repaired `--submit` now performs CPU preflight before requesting GPUs. It uses the exact reviewed subject-list parser, rejects duplicate patient names and real train/validation name overlap, verifies expected counts, checks raw-file presence and numeric array headers against the reviewed loader shapes, and checks ordered local cache IDs with 200 beats per subject. Only current patient lists, raw-array headers and cached subject-index arrays are inspected; no waveform preprocessing or test cache is used. `--preflight` performs these checks without creating files/jobs.

Successful submission snapshots the lists and audit; workers check their hashes and cache structure. The report now uses explicit evidence fields, including `current_patient_lists_disjoint` and `historical_cache_patient_identity_verified: false`, rather than the previous unconditional disjointness claim.

**Provenance limitation:** the old caches store no patient names or original split-list hashes. Current-list reconstruction and compatible cache structure cannot independently prove the historical lists were unchanged. This limitation must remain visible in accuracy reporting; a future definitive evaluation needs preserved patient identities/split manifests. The current error alone does not invalidate prior results or demonstrate leakage, but neither does fixing the programming error certify historical separation.

Local regression fixtures passed: harmless numeric collisions accepted; true name overlap, duplicate names, ambiguous file keys, missing/malformed headers, cache index gaps/order changes, and changed list/snapshot hashes rejected. Read-only preflight and mocked bounded Slurm submission were checked. The repaired preflight subsequently passed on the user's actual files and submitted array 43230748 (Section 6.12). The completed replacement comparison metrics are now recorded in Section 6.13.

### 6.12 Repaired comparison submitted — array 43230748

The user-supplied terminal output confirms 1,100 training patients with local indices 0–1099 and 195 validation patients with local indices 0–194. Current named lists passed the disjointness checks. The historical cache-to-patient mapping remains reconstructed, as explicitly printed by the script.

| Item | Value |
|---|---|
| Array job ID | 43230748 |
| Task 0 | `cnn_only` |
| Task 1 | `cbp_tnet` |
| Concurrency | One task at a time |
| Maximum run allocation | 90 minutes per task; queue time separate |
| Experiment | `/orange/xiangyan/rithika/cdd/outputs/iphone_inference/cnn_comparison_20260924T200054145651Z` |
| Standard-output logs | `/orange/xiangyan/rithika/cdd/logs/cbp_cnn_43230748_0.log` and `cbp_cnn_43230748_1.log` |
| Evidence received | Successful preflight and submission, followed by both completed arm reports with early-stopping outcomes (Section 6.13) |

The subsequent summary supplies both selected-checkpoint reports and early-stopping outcomes. There is no need to repeat this submission or add a CPU submission wrapper. A future seed replication must use a new, separately identified experiment and preserve these results.

### 6.13 Completed CNN-only / cBP-Tnet result — array 43230748

The user supplied the summary from `cnn_comparison_20260924T200054145651Z`. It confirms shared initial weights, target scaling, cache contracts and matching sample orders for overlapping epochs. Both runs stopped by early stopping, with no time-budget or partial-epoch warning in the supplied summary. This remains one seed (125) on the development/validation split.

| Method | Validation SBP MAE | Validation DBP MAE | SBP r | DBP r | SBP prediction SD | DBP prediction SD |
|---|---:|---:|---:|---:|---:|---:|
| Training mean | 13.8759 | 9.6640 | n/a | n/a | 0.000 | 0.000 |
| Training median | 13.8099 | 9.6142 | n/a | n/a | 0.000 | 0.000 |
| CNN-only | 13.0077 | 8.6517 | 0.3054 | 0.3878 | 5.706 | 5.236 |
| cBP-Tnet | 13.0071 | 8.6811 | 0.2962 | 0.3773 | 6.997 | 5.322 |

MAE and prediction SD are in mmHg. The baseline values above are taken from this run's supplied summary, including its printed rounding.

| Model | Parameters | Selected epoch | Epochs completed | Selected train SBP / DBP MAE | Selected validation SBP / DBP MAE |
|---|---:|---:|---:|---:|---:|
| CNN-only | 464,962 | 8 | 33 | 13.2963 / 8.3638 | 13.0077 / 8.6517 |
| cBP-Tnet | 5,219,394 | 4 | 29 | 13.1596 / 8.2912 | 13.0071 / 8.6811 |

**Interpretation:** the CNN-only model uses 91.0916% fewer trainable parameters; the larger model has 11.2254 times as many. SBP MAE is only 0.0006 mmHg higher for CNN-only, while DBP MAE is 0.0294 mmHg lower. Their mean SBP/DBP validation MAEs are 10.8297 and 10.8441 mmHg, respectively. These small observed differences do not establish a statistically supported accuracy advantage or equivalence. Slightly higher CNN correlations do not change that limitation.

Against the current validation training-median baseline, CNN-only lowers MAE by 0.8022 mmHg for SBP and 0.9625 for DBP. This is learning beyond constant prediction, but modest errors relative to the baseline and absolute errors near 13/8.65 mmHg remain unresolved. Smaller architecture does not fix the audited timing feature or labeling/segmentation concerns.

The selected checkpoints have lower SBP MAE on validation than on training. Different subject/target distributions and baseline difficulty mean that ordering alone is not evidence of leakage, a bug, or absence of a generalization problem. Both fixed-checkpoint sets should be interpreted relative to their split baselines, not just their raw train/validation gap.

**Implementation recommendation:** retain CNN-only as the provisional simpler candidate for follow-up. The two additional predeclared seeds have now completed under the unchanged protocol (Section 6.15), retaining every result and seed variability. Paired subject-level uncertainty on saved validation predictions remains a separate possible evaluation. Keep final evaluation separate from model selection, and preserve the historical cache-identity caveat. Do not compare these gains to older runs as an architecture-only effect because the shared training recipe also changed.

No new test-set, calibrated, wearable or phone-CNN result is provided. Fewer parameters do not imply an 11-fold speedup or 91% reduction in total app RAM. The new checkpoint uses the comparison's standardized-target output wrapper and must be exported with the matching construction and normalization/masking contract. Its physical-device memory/latency and numerical parity require direct measurement before replacing the phone artifact.


### 6.14 Additional seed replication — protocol and completed execution

Deliverables: **`run_cbp_multiseed.py`** (standalone) and **`cdd-next-stage.zip`** (runner, tests, README and reference controller). The runner uses the already completed seed-125 experiment at `cnn_comparison_20260924T200054145651Z` and creates a new timestamped `cnn_multiseed_...` suite. It reuses the exact original comparison controller with SHA-256 `1435d394be538b088b0581192d130ea5e39a6c9ccae3470eff27cc5c760c1a29`. A mismatch stops the process; no source patch is attempted.

The predeclared seeds are **125, 126 and 127**. Seed 125 is existing evidence and is not retrained. New training consists of CNN-only and cBP-Tnet at each of seeds 126 and 127. The controller is loaded from verified bytes without writing bytecode into the original experiment; its in-memory configuration changes only the seed. Architectures, normalization, upstroke mask, augmentation OFF, standardized-target loss, optimizer, dropout, batch size, per-subject sampling, checkpoint selection, patience and time budget are unchanged.

| Stage | Resources and limit | Dependency / output |
|---|---|---|
| CPU preflight | hpg-default, EL9, two CPUs, 8 GB, 20 minutes | Checks original artifacts and current identity/cache contract; creates isolated child snapshots and ready marker |
| Four GPU tasks | One B200, four CPUs, 16 GB, 90 minutes each; array concurrency one | Runs only after successful preflight; two architectures at each new seed |
| Automatic summary | hpg-default, EL9, one CPU, 4 GB, 10 minutes | Runs after the array terminates, including failed runs; writes `multiseed_summary.json` |

Maximum new GPU allocation is six hours across four tasks; early stopping may finish sooner, and queue time is additional. Array concurrency one does not guarantee numeric execution order. Once accepted, Slurm jobs do not depend on keeping the terminal open. Submission prints the IDs and exact log/summary commands. Partial submission records already accepted IDs and stops without silently retrying. [R22, R23]

The CPU check reuses the reviewed identity preflight, requires the same current patient lists/order as seed 125, validates cache/source/normalization fingerprints and original checkpoints, and snapshots per-seed manifests. Workers require the seed-125 software versions and GPU model before training. Original results, caches, production checkpoints and phone assets remain untouched. No test cache is opened, and no model is exported or deployed.

The final summary checks paired shared-weight hashes, overlapping epoch sample orders, target scaling, baselines, software/hardware and artifact contracts. Initial weights and first-epoch sampling orders must differ across seeds. It lists every seed, selected epoch and stopping reason, then computes three-seed mean/sample SD and paired CNN-minus-Tnet MAE differences. Negative differences favor CNN for MAE. A missing or invalid arm prevents aggregate ranking. Time-budget, partial-epoch and epoch-zero warnings remain visible rather than excluding unfavorable results. Three-seed sample SD measures training-run variability, not patient-level uncertainty; no superiority or equivalence claim is made.

**Replay prerequisite work:** preflight also writes `preprocessing_review_source.txt` containing source imports and the exact Kalman/filtering, fixed-length-vector and feature-generation definitions, plus `replay_readiness.json`. These contain source/metadata only, with no recorded waveforms, labels or patient identifiers. They are a review handoff, not executed raw-PPG replay. The reviewed label audit shows ABP-dependent label/acceptance selection in training; phone-time PPG-only extraction must be defined separately. Numerical replay of legacy behavior and correction of the timing/segmentation design need distinct, versioned contracts. That source handoff has since completed. The reviewed padding, derivatives and filter state informed the reference in Section 6.16; its completed user-run recording audit is recorded in Section 6.17.

**Verification:** twelve local tests passed using synthetic report fixtures, temporary experiments, fake Slurm responses and a stubbed CPU preflight. They cover seed-only changes, controller tampering, paired sample/checkpoint mismatch, complete/incomplete aggregation, seed reuse, environment mismatch, sample-SD/delta arithmetic, budget warnings, task-ID restoration, Slurm dependencies/resources, partial-submission records, isolated snapshots and preservation of original files. Python 3.9 syntax was checked. Actual GPU execution was later performed by the user on HiPerGator; the supplied results are recorded in Section 6.15. Cluster execution was not performed from this workspace. Recorded-signal model replay remains pending; sampled preprocessing parity is recorded in Section 6.17 and the later synthetic connected phone pass in Section 6.22.


### 6.15 Completed three-seed comparison — seeds 125, 126 and 127

The user supplied the final summary and the four new arm logs from:

```text
/orange/xiangyan/rithika/cdd/outputs/iphone_inference/cnn_multiseed_20260924T221508227477Z
```

The original aggregate file is `multiseed_summary.json` in that folder. The locally preserved **`cnn_multiseed_20260924T221508227477Z_supplied_results.json`** is a transcription of the supplied metrics, explicitly distinguished from that full original JSON. It preserves full-precision train/validation metrics for the four new arms and exact paired differences; seed-125 individual MAEs are available in this submission only as rounded table values.

| Seed | Model | Validation SBP MAE | Validation DBP MAE | Selected epoch | Epochs completed | Stop |
|---|---|---:|---:|---:|---:|---|
| 125 | CNN-only | 13.0077 | 8.6517 | 8 | 33 | Early stopping |
| 125 | cBP-Tnet | 13.0071 | 8.6811 | 4 | 29 | Early stopping |
| 126 | CNN-only | 13.0932 | 8.6408 | 27 | 52 | Early stopping |
| 126 | cBP-Tnet | 12.8844 | 8.7352 | 3 | 28 | Early stopping |
| 127 | CNN-only | 13.0297 | 8.6084 | 12 | 37 | Early stopping |
| 127 | cBP-Tnet | 13.0818 | 8.6399 | 2 | 27 | Early stopping |

The seed-125 completed-epoch counts are retained from Section 6.13; the new counts and selected checkpoints are present in the supplied logs. Each new run stops after 25 non-improving epochs following its selected epoch, consistent with the declared patience. No time-budget stop is reported.

| Model | SBP validation MAE: mean ± sample SD | DBP validation MAE: mean ± sample SD | Parameters |
|---|---:|---:|---:|
| CNN-only | 13.0435 ± 0.0444 | 8.6337 ± 0.0226 | 464,962 |
| cBP-Tnet | 12.9911 ± 0.0997 | 8.6854 ± 0.0478 | 5,219,394 |

All MAEs and paired differences are in mmHg. These sample SDs describe three training seeds on the same development split; they are not patient-level confidence intervals or an independent final validation.

| Output | Mean CNN-minus-Tnet MAE | Sample SD of paired difference | Seed 125 | Seed 126 | Seed 127 |
|---|---:|---:|---:|---:|---:|
| SBP | +0.052447 | 0.137949 | +0.000628 | +0.208803 | −0.052089 |
| DBP | −0.051766 | 0.036933 | −0.029359 | −0.094395 | −0.031545 |

Positive differences favor Tnet for MAE; negative differences favor CNN. Tnet has lower SBP MAE in two seeds, while CNN has lower DBP MAE in all three. Averaging the two outputs with equal weight gives a CNN-minus-Tnet difference of **+0.00034049 mmHg** across seeds. That numerical near-tie is consistent with retaining the smaller CNN for development; it is not a formal equivalence or superiority result. Three seeds do not justify a clinical conclusion.

**Decision:** use CNN-only as the architecture for the next preprocessing/model-development experiments because it uses **91.09% fewer parameters** and has nearly the same observed two-output validation MAE under this recipe. No new checkpoint is selected for deployment here. Keep every seed result, and do not promote a model solely because it was the best of these validation seeds. Fewer parameters alone do not establish phone speed, RAM or energy savings; none of these CNN checkpoints has yet been exported and profiled on the iPhone.

The remaining accuracy issue is substantial relative to the simple baselines: against the reported training-median validation baseline of 13.8099/9.6142, the CNN's mean improvement is approximately **0.7664 SBP / 0.9805 DBP mmHg**. Its absolute errors remain approximately 13.04/8.63 mmHg. This is a modest development improvement, not evidence that the BP application is ready for real readings.

**Selected-checkpoint train results for the new arms:**

| Seed | Model | Train SBP MAE | Train DBP MAE | Validation SBP r | Validation DBP r |
|---|---|---:|---:|---:|---:|
| 126 | CNN-only | 12.9571 | 8.2048 | 0.2920 | 0.3790 |
| 126 | cBP-Tnet | 13.3981 | 8.5097 | 0.3157 | 0.3790 |
| 127 | CNN-only | 13.1482 | 8.2717 | 0.2866 | 0.3733 |
| 127 | cBP-Tnet | 13.4762 | 8.4937 | 0.2915 | 0.3909 |

Different split distributions/baseline difficulty still limit interpretation of raw train/validation gaps. Very early selected Tnet epochs do not by themselves prove that the architecture is broken. The selection score is the **mean of SBP and DBP MAE at the same epoch**. For example, CNN seed 127 has lower SBP error at epoch 16 and lower DBP error at epoch 26, but epoch 12 has the better joint score. The checkpoint is not assembled from different epochs for different outputs.

**Verification boundary:** the exact supplied paired means, sample SDs, minima/maxima and new-seed arm differences reproduce. Three-seed per-model means/SDs agree with the available individual values within their printed precision; seed-125 full-precision individual metrics were not supplied here. The logs report Python 3.13.5, PyTorch 2.10.0+cu128, NumPy 2.2.6 and NVIDIA B200. The runner's printed complete summary is consistent with its programmed contract checks, but the original manifests/checkpoints/cache hashes were not re-read in this workspace. The supplied terminal logs are actual user-run training evidence, not locally executed training.

**Next action:** stop repeating this unchanged architecture comparison for now. The source review, first PPG-only reference and sampled recording-parity audit are now complete (Sections 6.16–6.17). The generated fixture and full report have since been verified, and the first JavaScript port is ready for the iPhone test in Section 6.18. Preserve the original model on the phone while that work proceeds. No new test-set evaluation, calibration experiment, model export, phone update or recorded-PPG replay occurred in this suite. Historical cache-to-patient identity remains reconstructed rather than certified.

### 6.16 Exact preprocessing review and PPG-only reference — implementation and sampled audit complete

The user supplied the generated source packet identified with full-source SHA-256 `18658a5309d85b9875251a705d091b133fc678bfe33bdd6160d6c8f23d82597e`. The packet includes the adaptive Kalman recurrence, fixed-length-vector routine and full feature-generation function. This is code evidence; the audit checks the full file hash on HiPerGator. Its subsequently supplied successful terminal result is recorded in Section 6.17.

| Operation | Confirmed behavior | Consequence for inference |
|---|---|---|
| Filter | Adaptive Kalman state, covariance and both variances reset per recording | Continuously carrying state would change the features |
| PPG peaks | `pyampd.find_peaks(filtered, scale=125)` | The detector must also be reproduced, not replaced silently |
| Intervals | Start at the second detected peak; skip the first interval; slice ends before the next peak | Preserve indexing for parity; this is peak-to-peak segmentation |
| Gradients | `np.gradient(seg)` followed by `np.gradient(d1)` on the complete unpadded interval | Unit sample spacing and first-order endpoint differences; not derivatives per second [R24] |
| Length | Zero-pad or truncate each channel to 250 samples | No interpolation/resampling occurs; derivatives are computed before truncation/padding |
| First scalar | Clipped location of `argmax(seg)` divided by sampling rate and 0.15 seconds | Not a verified physiological upstroke or pulse-transit time |
| Second scalar | Clipped peak interval in seconds divided by 1.2 | Calculated from the original interval, before truncation |
| Training selection | Segment BP range, available ABP window, ABP-derived BP range and pulse-pressure gates | These cannot be applied from PPG alone at inference |
| Random cap | Up to 200 accepted beats per subject | Dataset sampling, not part of inference |

The fixed ABP label window is 250 samples (two seconds at 125 Hz), regardless of the PPG interval length. The existing alignment audit documents how this can cover multiple PPG beats. Reproducing this label-selection code verifies legacy behavior; it does not certify that the selected ABP beat corresponds physiologically to the PPG input.

**Delivered implementation:** `audit_cbp_ppg_reference.py`, contract `legacy_ppg_candidates_v1`. Its reusable `extract_ppg` function accepts only one finite 3,750-sample PPG recording at 125 Hz and returns float32 `(N,3,250)` waves, `(N,2)` timing and recording-local interval indices. The explicit float32 input conversion follows the earlier inspected raw-data audit. Features are **unnormalized**. The reference has no BP/ABP input or reference-label acceptance rules, and does not implement a validated signal-quality gate.

A separate audit-only function reproduces ABP-dependent acceptance. For the same accepted intervals, the worker requires exact equality with the original `generate_features` function for wave channels, timing and reference labels. It counts PPG candidates excluded by segment labels, ABP-window length or beat labels separately. Those rejection counts are disjoint and must account for every extra PPG candidate. The legacy random beat cap is disabled for this ordered comparison; no correspondence with historical randomly retained cache rows is asserted.

The reference preserves finite valid-input legacy calculations, but fails explicitly on invalid size/rate, nonfinite inputs/features, invalid peak indices and detector exceptions. The original silently skips some failures. Fewer than three peaks gives typed empty outputs. The audit does not silently skip a failing sampled recording or claim successful parity after a processing exception.

**Scheduled experiment:** one CPU batch job on `hpg-default`/EL9, two CPUs, 4 GB, twenty-minute limit; queue time is separate. It samples up to eight subjects and three recordings per subject in each current training/validation split using seed 125. Submission snapshots and fingerprints the script, source and current split lists. The worker requires NumPy 2.2.6, records SciPy/pyampd versions and AMPD source hash, loads only the selected raw arrays, and checks source/list/raw-file hashes again after use. It compiles only named function definitions from the hash-checked source rather than importing or running the training program. No feature cache, model checkpoint or test waveform is opened. Current named train/validation lists must be disjoint; historical cache identity remains uncertified.

All writes are new experiment snapshots, logs and reports. `ppg_reference_report.json` contains aggregate counts, exact comparison status and fingerprints. `synthetic_ppg_reference.json` contains a generated toy PPG recording and its first four expected unnormalized inputs for future port testing; it has no BP truth label and contains no recorded dataset waveform. A failure writes `failure.json`; previously attempted result directories are not reused. The user subsequently supplied its successful terminal output; the completed recording audit is documented in Section 6.17.

**Local verification:** thirteen tests passed with NumPy 2.2.6, SciPy 1.17.0 and pyampd 0.0.1. These cover actual AMPD on generated signals, exact filter/gradient behavior, derivative-before-padding/truncation, skipped/short intervals, ABP tail length and reference gates, fallback/empty/error cases, deterministic fixtures, no random cap/input mutation, source tampering and a full worker run on temporary synthetic data with a mocked Slurm submission. The test oracle is a labeled transcription of the user-supplied definitions; the actual scheduled job checks the real full source hash. An initial local test attempt used NumPy 2.3.5 and correctly stopped at the required-version guard; all thirteen passed after using the isolated NumPy 2.2.6 test dependency. No cluster or phone execution was performed here.

**Remaining boundary:** this is preprocessing parity, not a new BP accuracy result or mobile port. Normalization must be applied exactly once using the selected model's contract. Padded zeros usually become nonzero after standardization; changing the order is not equivalent. The research CNN recipe additionally masks the first timing scalar after standardization, while the original deployed model has its own input contract. Neither model should receive these unnormalized outputs directly. The full-recording AMPD and filter-reset behavior also means this is not yet a continuously streaming pipeline. Subsequent work needs PPG-only quality criteria, a versioned segmentation/labeling decision, candidate-specific normalization/output scaling, recording-level aggregation, and phone/Python parity before deployment.

### 6.17 Completed recorded-PPG reference audit — exact legacy parity on the sampled accepted beats

The user supplied the successful terminal output from:

```text
/orange/xiangyan/rithika/cdd/outputs/iphone_inference/ppg_reference_audit_20260925T022129409190Z
```

The directory timestamp is September 25 at 02:21 UTC, or September 24 at 22:21 EDT. The supplied result is actual user-run HiPerGator evidence. It is preserved as `ppg_reference_audit_20260925T022129409190Z_supplied_results.json`, explicitly a transcription of the terminal output rather than the original full `ppg_reference_report.json`.

| Quantity | Train | Validation | Combined |
|---|---:|---:|---:|
| Sampled subjects | 8 | 8 | 16 |
| Recordings checked | 24 | 24 | 48 |
| Detected peaks | 1,117 | 1,019 | 2,136 |
| PPG candidate intervals | 1,069 | 971 | 2,040 |
| PPG intervals rejected as too short | 0 | 0 | 0 |
| Legacy-accepted beats | 1,056 | 953 | 2,009 |
| Extra PPG candidates excluded for insufficient ABP length | 13 | 18 | 31 |
| Maximum absolute channel-feature difference | 0 | 0 | 0 |
| Maximum absolute timing-feature difference | 0 | 0 | 0 |

Both splits report `exact_feature_parity`, `exact_timing_parity` and `exact_legacy_label_parity` as true. All 2,009 accepted beats match; comparison is at the **unnormalized input-feature stage**. The script does not invoke a BP model in this audit. Label parity means reproducing the legacy ABP label calculation, not independent validation of physiological beat alignment.

Count arithmetic was independently checked from the supplied numbers: candidate count equals detected peaks minus two per recording; candidate minus accepted count equals the reported extra-candidate and ABP-length exclusion counts in each split. The 31 additional candidates are 1.5196% of 2,040 PPG candidates. No additional segment-reference or beat-reference exclusions were reported in this sample. The gates still exist in the source and could exclude other recordings; this sample does not establish their general irrelevance.

**Interpretation:** extracting these PPG features does not require ABP. ABP affects which training examples are retained and how reference BP labels are assigned. The separate PPG-only extractor reproduces the features of the legacy-retained sample exactly. The earlier label audit's combined “too short” counts of 13/18 now have a more specific explanation: in this supplied sample they came from the minimum ABP-window length, with zero short-PPG-interval rejections. That is a recording-tail/reference-availability issue, not evidence that those PPG candidates were invalid.

**Completion boundary:** this establishes numerical agreement with the legacy implementation on the sampled recordings. It does not validate the legacy labeling/segmentation design, create a signal-quality rule, certify historical cache identities, evaluate normalization/model outputs, establish BP accuracy, or show that the raw-preprocessing code runs on iPhone. No training, test-set inference, model replacement or phone update occurred. The reported artifact preservation and final PASS are consistent with the delivered worker's checks. The full report has since been supplied and inspected (Section 6.18). Its controller, detector and fixture hashes match available local bytes; the actual HPG raw files were not reread here.

**Completed handoff:** the user supplied `ppg_reference_report.json` and `synthetic_ppg_reference.json`. The first records the actual NumPy/SciPy/pyampd versions, detector source hash and synthetic-fixture hash; the second carries generated raw PPG and expected unnormalized outputs. These now anchor the local mobile-port verification and detector-provenance check in Section 6.18. The synthetic fixture does not contain recorded MIMIC waveforms. No audit rerun or new training job is needed for this handoff. Instructions are in Section 7.13.

### 6.18 Verified fixture and mobile preprocessing port — implementation and local checks

The user attached the full `ppg_reference_report.json` and `synthetic_ppg_reference.json` from the completed audit. Their metadata agrees with the prior supplied terminal counts. Sixteen subject-level input-fingerprint entries are present; inspecting these recorded hashes is not equivalent to rereading the HPG raw data.

| Artifact or environment | Verified value / interpretation |
|---|---|
| Synthetic fixture SHA-256 | `db0eae6bdc76c8ce73a3c03e9476356f9eb9e9db25ee39a0bc6836c7a89461f0`; actual attached file matches report |
| Audit-controller SHA-256 | `affe831b8d7bf49808c36575931ab243b2a39d21df20f99a78db3f292b637e30`; matches delivered controller bytes |
| AMPD implementation SHA-256 | `bf13c9bdc3745adf91738e9b90fba6854e6a8f14b1779cf120a9ab6cf1396fc5`; matches the local installed pyampd source |
| HPG runtime reported | Python 3.13.5, NumPy 2.2.6, SciPy 1.17.0, pyampd 0.0.1 |
| Fixture contract | `legacy_ppg_candidates_v1`; synthetic, 3,750 raw samples at 125 Hz; unnormalized outputs |
| Expected candidate count | 31 |
| Saved candidate intervals | `[135,248]`, `[248,362]`, `[362,476]`, `[476,589]` |
| Saved expected values | First four candidates: 3,000 channel values and 8 timing values |

Local Python with NumPy 2.2.6/SciPy 1.17.0/pyampd 0.0.1 regenerates the entire fixture's data exactly, including raw samples, count, intervals and saved features. The existing supplied report still explicitly marks normalization, model evaluation and historical cache identity as unverified by this audit.

**Delivered package:** `cdd-mobile-preprocessing.zip`, including `services/bpPpgPreprocess.js`, TypeScript declarations, `app/ml-ppg-test.tsx`, a link component, the exact synthetic fixture, provenance metadata, a guarded installer, tests and a README. The pure JavaScript reference can run in Node or React Native. It uses no ONNX call and adds no native module/dependency.

The port preserves float32 input conversion and NumPy 2.2.6 scalar arithmetic through explicit `Math.fround` operations. The first Kalman update retains the original Python-scalar covariance calculation before subsequent float32 operations. It then preserves gradient-before-padding/truncation, peak interval indexing and clipped timing proxies. NumPy's scalar-promotion behavior is relevant to this implementation [R27].

The AMPD implementation preserves the reviewed pyampd edge comparisons, weighted scale selection, first-maximum tie rule and exclusive scale slice. It counts rows and recomputes the selected comparisons without retaining the complete scalogram matrix. Linear detrending uses a centered least-squares formula rather than SciPy's LAPACK reduction; rounding can differ near ties. Synthetic agreement does not establish agreement for every possible signal. The unusable-scale case fails explicitly, with no invented fallback peaks. The upstream MIT license and attribution are included.

**Local numerical result:** Node 24.19.0 produces 31 candidates, matches all four supplied intervals, and has maximum channel/timing errors of zero against the uploaded fixture. A separate predefined ten-case synthetic corpus varies frequency, amplitude, offset, polarity, noise and drift. For all 349 generated candidates, full filter-output hashes, detected peaks, selected scale, intervals, channel values and timing values match Python exactly. These are local Node/V8 results; no physical-phone or Hermes result is inferred.

**Device-test acceptance:** exact candidate count and first-four interval indices, absolute channel-feature difference at most `1e-6`, and absolute timing-feature difference at most `1e-7`. These are feature-unit engineering tolerances, not mmHg or clinical limits. An additional `exactMatch` flag requires both numeric differences to be zero. The device fixture has numerical references for only its first four candidates; its PASS must not be described as a comparison of all 31 candidate tensors. The local ten-case tests compare every candidate.

**Testing completed:** sixteen core tests and eight installer tests pass. Coverage includes the actual uploaded fixture, ten Python-generated comparison cases, gradient/order/padding/truncation, empty/error cases, input immutability, invalid fixture metadata, deliberate expected-output/count/interval corruption, dry-run, additive installation and backup, idempotence, existing-file conflicts, unfamiliar layout, incomplete marker, symlink rejection, payload corruption and rollback after a simulated write failure. TypeScript 5.9.2 transpilation/syntax checks pass for both TSX files; this is not a full application typecheck or iOS build. `LOCAL_VERIFICATION.json` preserves the local verification scope and hashes.

**Installation behavior:** the default command is dry-run; `--apply` checks payload hashes and runs local fixture parity before writes. It adds six payload files and one import/link to the known ScrollView opening in `app/ml-test.tsx`, with a timestamped backup. Existing content is preserved; differing destination files or an unfamiliar screen cause a stop before writes. Package files, Pods, Xcode settings, model assets, calibration and health storage are not edited. A Release rebuild bundles the new JavaScript/JSON.

**Phone flow:** Test ML model → Test raw PPG preprocessing → Run preprocessing test → Share test report. The screen shows candidate count, interval match, feature differences, exact-match status and preprocessing-call duration. The shared JSON includes OS, development mode, JS engine and bundled source/fixture metadata. Hashes are verified at installation; the phone report does not constitute runtime binary attestation. No report is uploaded automatically, and synthetic outputs are not written to the health journal. The Share action uses React Native's system share sheet [R28].

**Remaining boundary:** this standalone test covers raw synthetic PPG to unnormalized features. The later connected synthetic test adds the original model’s normalization and inference (Section 6.22). Candidate-specific normalization and output scaling, signal quality, physiological labeling/segmentation, aggregation, calibration integration, watch acquisition and BP evaluation remain pending. Processing uses a complete 30-second recording and runs synchronously on the JS thread after yielding for UI state; one preprocessing-call duration is now recorded in Section 6.19; sustained responsiveness and repeated timing distributions remain unmeasured. The measured preprocessing-call duration excludes screen loading and reference comparison and must not be compared directly with previous ONNX inference-call timings. No memory/energy result is claimed for this port.

### 6.19 Completed iPhone raw-PPG preprocessing test — exact match on checked candidates

**User-run evidence:** the supplied `cdd_raw_ppg_preprocessing` JSON began at `2026-09-25T03:22:06.158Z` and finished at `03:22:06.206Z`, or September 24 at 11:22:06 p.m. EDT. The earlier installer reported `fixturePassed: true` and `exactMatch: true` on the Mac. Expo's build launcher again failed to locate Simulator.app even with `DEVELOPER_DIR` specified. Direct Xcode workspace/physical-device Release instructions were then supplied; the new phone report confirms a non-development iOS execution. It does not itself identify which build-launch command ultimately succeeded.

The report is retained as `cdd_raw_ppg_preprocessing_20260925T032206158Z_supplied_report.json`, a field-preserving transcription of the user-pasted JSON. It is not a signed device attestation. Device model is associated with the previously supplied iPhone 16 Pro evidence; this report itself contains OS and engine, not a hardware identifier.

| Observation | Supplied result |
|---|---|
| Runtime | iOS 26.6.2; Hermes; `developmentBuild: false` |
| Input | One synthetic 3,750-sample recording at 125 Hz (30 seconds) |
| Contract | `legacy_ppg_candidates_v1`; raw PPG → unnormalized features |
| Detected peaks / scale index | 33 / 56 |
| Candidates / expected | 31 / 31; no short intervals rejected |
| Interval comparison | First four reference intervals match |
| Numerical coverage | 4 candidates × 3 channels × 250 samples = 3,000 channel values; 8 timing values |
| Maximum channel / timing differences | 0 / 0 |
| Acceptance tolerances | Absolute channel `1e-6`; absolute timing `1e-7`, in feature units |
| Result | `passed: true`, `exactMatch: true` |
| Preprocessing-call duration | 45.4997079372406 ms; one run, not a latency distribution |
| Excluded stages | No normalization, model inference, signal-quality validation, memory or energy measurement |

The fixture and JS source hashes in the device report match the delivered local bytes: fixture `db0eae6bdc76c8ce73a3c03e9476356f9eb9e9db25ee39a0bc6836c7a89461f0`; JS `65210ab9067f7ed5b2b9c1e350b5b8dd538c3a7a078bf76b34d7d79ce10aa382`. The remaining bundled provenance fields agree with the delivered provenance JSON. Their presence documents the installed package; it does not independently hash the running binary. The Python reference environment remains NumPy 2.2.6/SciPy 1.17.0/pyampd 0.0.1.

**Interpretation:** the raw-signal feature code now has physical-phone evidence in Hermes as well as prior local Node evidence. Do not describe the result as all 31 candidate tensors checked, raw-PPG-to-BP inference, live streaming, signal quality, or clinical validation. A 30-second fixture was processed in one batch. The 45.500 ms measurement excludes screen loading and reference comparison; adding it to a previous ONNX timing would not measure the complete application path. The original synthetic ONNX tests remain separate completed stages.

### 6.20 Connected-chain reference generator — prepared and subsequently executed on HiPerGator

The next integration check joins the already-tested raw preprocessing to **the original deployed model's** normalization and ONNX inference. `prepare_cbp_chain_reference.py` prepares its reference values without retraining, reading recorded datasets, rerunning preprocessing, exporting a model, or editing phone assets. It validates known model/raw-fixture/smoke-fixture hashes, normalization values, the export contract, and fixed ONNX tensor names/shapes.

The generator uses the four saved Python feature tensors from the verified raw fixture. It applies `(feature - mean) / std` as float32 subtraction and division, including padded positions. No extra epsilon, post-normalization timing mask, calibration, or output de-standardization is applied to this original-model contract. New CNN comparison checkpoints have a different contract and are not supported by this generator.

Python ONNX Runtime CPU first checks the existing normalized smoke fixture against its saved PyTorch outputs, then evaluates the four normalized candidates twice. The new expected outputs come from **Python ONNX Runtime**, not a fresh PyTorch forward pass on these four candidates. The new JSON includes intermediate normalized features, expected outputs, input hashes, environment versions, and explicit scope flags. Four-candidate expected values are software references, not ground-truth BP. They will support a later phone test that recomputes features from raw input and compares intermediate values and final outputs separately.

**Local verification:** eight tests pass for float32 normalization/padding and original timing behavior, schema/value/shape/model-contract rejection, fixed per-beat feeds through a stand-in session, refusal to overwrite outputs, and mocked Slurm submission with bounded CPU resources. Python 3.9 syntax passes. The actual original ONNX model and HiPerGator scheduler were not executed here. `--submit` requests one core, 2 GB and five minutes on `hpg-default`, using the existing `venv-iphone-export/bin/python`; queue time is separate. Output is a new `raw_ppg_chain_reference_v1.json`; existing output causes a stop. The user subsequently supplied the generated JSON; its reviewed result is recorded in Section 6.21. ONNX Runtime's primary API documentation describes the session/provider/NumPy interface used here [R29].

### 6.21 Supplied connected-chain reference and prepared iPhone test

**Reference evidence:** the user attached `raw_ppg_chain_reference_v1.json`, created on HiPerGator at `2026-09-25T03:37:32.834432+00:00` (September 24, 11:37:32 p.m. EDT). The attachment is 93,151 bytes with SHA-256 `38ddaf0b51ee94b4c669993bd786c20694cf7a988e162784341b67cfa35305a5`. Its generator SHA-256 `acf24afc8fd473fae1d7437e1754a1b75664e8808017875549a794bda26d7f84` matches the delivered controller. Known original-model, raw-fixture and normalized-smoke-fixture identities agree with prior evidence. Normalization hash is `bc8a28b7ca84faa00644fa7d13ae706705ecd47b9543296753273555be3aba41`; export-report hash is `f2c752c064aa511b74013205b36e78e9f1decb24da2a032d001d2732ad10f82e`.

| Reference observation | Value / boundary |
|---|---|
| Runtime | Python 3.9.25, NumPy 1.26.4, ONNX Runtime 1.19.2; CPU; one thread |
| Features used | Saved Python features for the first four candidates from the verified synthetic PPG fixture |
| Preprocessing rerun by generator | No; it reused the already-verified Python feature oracle |
| Normalization | Float32 subtraction and division; padded positions standardized; no extra epsilon or timing mask |
| Existing PyTorch-reference smoke check | Maximum SBP/DBP differences 0.000030517578125 / 0.000003814697265625 mmHg |
| Repeated four-candidate ONNX calls | Reported maximum differences 0 / 0 mmHg |
| Independent local normalization recomputation | All 3,008 values exactly reproduced with NumPy 2.2.6 and Node JavaScript |
| Local model inference | Not rerun here; original ONNX bytes are not present in this workspace |
| Calibration / aggregation / quality / BP accuracy | None applied or evaluated |

The generated expected outputs are **software references for synthetic inputs**, not true BP values or measurements of the user:

| Synthetic candidate | Python ONNX SBP output (mmHg) | Python ONNX DBP output (mmHg) |
|---|---:|---:|
| 1 | 111.33690643 | 54.60478592 |
| 2 | 111.40845490 | 54.64792633 |
| 3 | 111.52600861 | 54.72703552 |
| 4 | 111.51296997 | 54.74232101 |

These four new outputs were generated with Python ONNX Runtime. The old smoke fixture was compared against saved PyTorch outputs, but there is no fresh PyTorch comparison for these four new candidates. The source model's poor original test performance remains unchanged.

**Prepared package:** `cdd-mobile-chain.zip` adds **Test raw PPG to model output** to the existing ML test screen and implements `app/ml-ppg-chain.tsx`. The phone derives its first-four feature inputs from the bundled raw PPG, standardizes them with the existing normalization file, and runs the original ONNX model four times with a fresh CPU session and one thread. Reference inputs are used only for comparisons; they are never substituted for the freshly derived inference inputs. A local test deliberately perturbs an oracle value within comparison tolerance and verifies that the model still receives the raw-derived input.

The three checks are reported separately:

1. **Preprocessing:** require 31 candidates and matching first-four intervals. Absolute tolerances are `1e-6` for channel features and `1e-7` for timing features; compare 3,000 and eight values respectively.
2. **Normalization:** compare the 3,008 normalized values with an absolute tolerance of `1e-6`. Standardize padding too; retain the original model's normalized upstroke scalar. A failure in either input stage stops before session creation.
3. **Inference:** require the fixed beat/timing input names and BP output name; validate each output as finite float32 with shape `[1,2]`. Compare each of four outputs with the Python ONNX oracle at `0.01 mmHg` absolute tolerance per SBP/DBP output. Preserve per-candidate differences and comparison failures. Always dispose allocated tensors and release a created session; cleanup failures cannot yield PASS.

Backgrounding/unmounting cancels between asynchronous boundaries; a native call already in progress is awaited and cleaned up. The screen permits sharing the result through the system share sheet, including partial failures, without automatic upload or health-history writes. ONNX Runtime documents session execution/release; React Native documents foreground/background notifications [R30–R31].

**Timing interpretation:** the report's total test-call time includes derivation, normalization, comparisons, runtime import, asset resolution, session creation, four inference calls and session release. It excludes navigation, screen/module work before the call and UI rendering. Separate model-call timings exclude input tensor construction, output validation and disposal. A new session is not a controlled cold app/OS-cache launch. Memory, energy and clinical accuracy are explicitly unmeasured.

**Installer behavior:** dry-run is the default. The installer requires the prior preprocessing addition, Expo 54, declared and installed ONNX Runtime React Native 1.24.3, and existing model/normalization/export-report/raw-fixture/preprocessing hashes matching the uploaded reference. It performs local raw-to-normalized numerical checks before writes. It adds ten files and one import/link in the inspected `app/ml-test.tsx` ScrollView, preserving the old screen and other controls. The unchanged preprocessing JS is included for local tests and compared with the installed copy; it is not replaced. Backups use `iphone-test-backups/ppg-chain-<timestamp>`. Conflict/layout/symlink/integrity guards stop before edits, and rerunning the same install is idempotent. No dependency manifests, Pods, iOS-native configuration, original model/normalization, calibration or health-storage files are changed.

**Local verification:** all 26 tests pass: ten core numerical/protocol tests, six ONNX-adapter lifecycle tests with a stand-in runtime, and ten installer tests. Installer tests use explicit test-only digest mappings for synthetic stand-in model/export buffers because the actual model is unavailable here; the delivered installer has no bypass option. Four TypeScript/TSX files pass TypeScript 5.9.2 transpilation/syntax checks. This is not a full project typecheck, Xcode build or actual ONNX execution in this environment. The user subsequently supplied its passing physical-iPhone report, recorded in Section 6.22. The local preparation checks above remain separate from that user-run evidence.

### 6.22 Completed connected iPhone test — raw PPG, normalization and model inference

**User-run evidence:** the `cdd_raw_ppg_chain` report began at `2026-09-25T04:18:06.205Z` and finished at `04:18:06.370Z` (September 25, 12:18:06 a.m. EDT). It reports non-development iOS 26.6.2, Hermes, ONNX Runtime React Native 1.24.3, CPU and one thread. The device model is associated with the preceding supplied iPhone 16 Pro evidence; this report itself does not include a hardware identifier. The report is preserved as `cdd_raw_ppg_chain_20260925T041806205Z_supplied_report.json`, a field-preserving transcription of the pasted JSON.

| Stage / observation | Result |
|---|---|
| Overall | Complete and passed; not cancelled; no run or cleanup failure |
| Input | One 30-second synthetic recording: 3,750 raw samples at 125 Hz |
| Preprocessing | 31 candidates found; first-four intervals match; zero differences across 3,000 channel values and eight timing values |
| Normalization | Zero differences across 3,008 values; padding standardized; original-model timing scalar retained |
| Model calls | 4 attempted, 4 successful; zero comparison failures and zero runtime failures |
| Largest SBP / DBP output differences | 0.00000762939453125 / 0.000011444091796875 mmHg |
| Output tolerance | 0.01 mmHg absolute per output |
| Session lifecycle | Fresh session reported; successfully released; no cleanup error |
| Model | Original deployed ONNX graph; no CNN comparison checkpoint replacement |
| Excluded | No calibration, aggregation, signal-quality validation, BP-accuracy evaluation, memory/energy or true app cold-launch measurement |

All eight per-output absolute differences were independently recomputed from the supplied phone/reference values and exactly reproduce the reported differences. Their maxima agree with the reported summary and all are below tolerance. Reference outputs match the previously attached Python oracle. The reference and four implementation-source hashes agree with available delivered bytes. These bundled identifiers are provenance metadata, not independent attestation of the running binary.

| Synthetic candidate | SBP absolute difference (mmHg) | DBP absolute difference (mmHg) |
|---|---:|---:|
| 1 | 0.00000762939453125 | 0.000011444091796875 |
| 2 | 0.00000762939453125 | 0 |
| 3 | 0.00000762939453125 | 0.000003814697265625 |
| 4 | 0 | 0.000003814697265625 |

**Measured call timings, one run:**

| Component | Time (ms) |
|---|---:|
| Raw preprocessing | 45.917416 |
| Normalization | 0.487625 |
| Runtime import | 3.004708 |
| Asset resolution | 0.823875 |
| Session creation | 99.767250 |
| Inference calls 1–4 | 3.538042, 2.834250, 2.808458, 2.730667 |
| Mean inference call, four calls | 2.977854 |
| Sum of four inference calls | 11.911417 |
| Session release | 0.509584 |
| Full test-call wall time | 165.699583 |

Named component timings total 162.421875 ms. The remaining 3.277708 ms includes comparisons and other untimed work inside the call. Session creation is the largest timed component in this run. There are only four inference calls with different candidate inputs and no declared warmup phase; do not turn their average into a throughput, sustained-latency, energy or cross-model speed claim. A fresh session does not imply an uncached process or model file. Screen/navigation time and true app launch remain excluded, and no network-off condition is recorded for this particular run.

**Milestone completed:** the original model's synthetic raw-PPG-to-uncalibrated-output software path executes on the physical iPhone and matches the recorded reference through all checked stages. This strengthens the earlier separate preprocessing and inference evidence by exercising their connection. Scope is the first four candidate tensors and outputs from one synthetic recording, not all 31, live streaming, recorded-patient accuracy or wearable integration. The roughly 111/55 synthetic outputs are software values with no known physiological ground truth. The original checkpoint's earlier 14.3402/9.5348 mmHg uncalibrated test MAE and negligible gain over the personal-reference baseline are unchanged by this engineering PASS.

**Next work:** retain this completed device evidence and move to a documented recorded-PPG research evaluation with signal-quality and label/segmentation decisions, reliable patient/session identities, and baseline comparisons. Use validation data for development; a newly selected model requires its own export/normalization contract and device check. In parallel, identify the exact wearable/sensor and supported raw-PPG export or transport format before implementing acquisition. Calibration collection UI/storage, activation/invalidation, aggregation and longitudinal calibration validity remain separate pending work. No additional repeat of this same synthetic check is required merely to reconfirm this PASS.

## 7. Commands to run now

### 7.1 HiPerGator: reproduce the completed comparison summary

These commands inspect the existing job; they do not submit another comparison.

```bash
squeue -j 43160017 -o "%.20i %.10T %.10M %.10l %R"
sacct -j 43160017 --format=JobID,State,Elapsed,ExitCode,MaxRSS
```

The following command produced the comparison recorded in Section 6.3 and can be rerun without training:

```bash
python3 /orange/xiangyan/rithika/cdd/outputs/iphone_inference/augmentation_comparison_20260924T034651067153Z/compare_cbp_augmentation.py \
  --summary \
  --experiment-dir /orange/xiangyan/rithika/cdd/outputs/iphone_inference/augmentation_comparison_20260924T034651067153Z
```

If a task fails or produces no report, inspect that task’s logs:

```bash
tail -n 30 /orange/xiangyan/rithika/cdd/logs/cbp_aug_43160017_0.log
tail -n 30 /orange/xiangyan/rithika/cdd/logs/cbp_aug_43160017_0.err
tail -n 30 /orange/xiangyan/rithika/cdd/logs/cbp_aug_43160017_1.log
tail -n 30 /orange/xiangyan/rithika/cdd/logs/cbp_aug_43160017_1.err
```

An empty queue listing is expected after completion; accounting and report files retain the evidence. The original `%1` array concurrency setting allowed one task at a time. GPU-job RAM reported by Slurm is not device-app memory.

### 7.2 Mac: record missing reproducibility details

```bash
cd /Users/rithika/Desktop/cddapp
git rev-parse --short HEAD
git status --short
xcodebuild -version
npm ls expo react-native onnxruntime-react-native expo-asset expo-dev-client --depth=0
shasum -a 256 assets/models/onnx_export/cbp_tnet.onnx assets/models/onnx_export/normalization.json
```

Also record the iPhone model and iOS version from Settings → General → About, without sharing device serial numbers or account information. Record the actual Run/Profile configuration and app build number used for each test.

The manual screenshots and automatic five-cycle device result are recorded in Sections 5.11 and 5.13. The user has completed the add-on installation and native rebuild; do not repeat them merely to acknowledge the result. Preserve the protocol and summary for future candidate comparisons. No model replacement or app retraining occurred.

### 7.3 Inspect the completed label-window audit

Read the existing logs on **HiPerGator**; no resubmission is needed:

```bash
cat /orange/xiangyan/rithika/cdd/logs/cbp_labels_43161373.log
cat /orange/xiangyan/rithika/cdd/logs/cbp_labels_43161373.err
```

The aggregate JSON and six diagnostic PNGs are in the directory recorded in Section 6.5. Keep waveform images within the permitted dataset environment unless their sharing is authorized. The previous job used an EL9 CPU node and the `pytorch/2.8.0` module for scientific Python dependencies; it did not request a GPU or import PyTorch.

### 7.4 Reproduce the completed upstroke comparison

Run on **HiPerGator** to verify and print the existing comparison. It does not retrain either model:

```bash
python3 /orange/xiangyan/rithika/cdd/outputs/iphone_inference/upstroke_comparison_20260924T044100934260Z/compare_cbp_upstroke.py \
  --summary \
  --experiment-dir /orange/xiangyan/rithika/cdd/outputs/iphone_inference/upstroke_comparison_20260924T044100934260Z
```

### 7.5 Inspect existing training histories before another experiment

Run this read-only command on **HiPerGator**. It uses standard Python, reads existing JSON files, and requires no Slurm job or GPU. It prints the logged training and validation MAEs at the selected epoch and at the last completed epoch for the four experiment arms:

```bash
python3 - <<'PY'
import json
from pathlib import Path

root = Path('/orange/xiangyan/rithika/cdd/outputs/iphone_inference')
aug = root / 'augmentation_comparison_20260924T034651067153Z'
timing = root / 'upstroke_comparison_20260924T044100934260Z'
runs = [
    ('augmentation on', aug / 'augmentation_on'),
    ('augmentation off', aug / 'augmentation_off'),
    ('keep upstroke', timing / 'keep_upstroke'),
    ('mask upstroke', timing / 'mask_upstroke'),
]
keys = ['train_sbp_maes', 'val_sbp_maes', 'train_dbp_maes', 'val_dbp_maes']
print('SAVED TRAINING HISTORY — logged epoch-average MAE (mmHg)')
print(f"{'Run':<20} {'Point':<6} {'Epoch':>5} {'TrainSBP':>9} {'ValSBP':>9} {'TrainDBP':>9} {'ValDBP':>9}")
for name, folder in runs:
    try:
        history = json.loads((folder / 'training_history.json').read_text())
        report = json.loads((folder / 'validation_report.json').read_text())
    except FileNotFoundError as error:
        print(name, 'missing:', error.filename)
        continue
    count = len(history['train_losses'])
    assert count == report['epochs_completed'] and all(len(history[k]) == count for k in keys)
    best = int(report['best_epoch'])
    assert 1 <= best <= count
    for point, epoch in [('best', best), ('last', count)]:
        values = [history[k][epoch - 1] for k in keys]
        formatted = ' '.join(f'{value:9.3f}' for value in values)
        print(f'{name:<20} {point:<6} {epoch:5d} {formatted}')
print('Training used sampled beats and training mode; validation used the full split and evaluation mode.')
PY
```

These are historical measurements while weights changed during each training epoch, with dropout enabled on sampled training beats and disabled for validation. The augmentation-on arm also augmented training inputs. The trainer averages per-batch metrics, whereas the final validation report computes metrics over all beats. Consequently, these columns are diagnostic clues, not an exact generalization-gap measurement from one fixed checkpoint under matching conditions.

The user has now supplied the keep-upstroke and mask-upstroke rows, recorded in Section 6.7. Their late divergence motivates the matching-condition audit below. The older augmentation-on/off history rows have not been supplied; rerunning this history command is optional and does not submit training.

### 7.6 Read the completed fixed-checkpoint audit

The aggregate report can be read on **HiPerGator**; no repeat audit is needed:

```bash
cat /orange/xiangyan/rithika/cdd/outputs/iphone_inference/generalization_audit_20260924T155422354621Z/generalization_report.json
```

### 7.7 Read the completed capacity-probe result

No resubmission is needed. On **HiPerGator**:

```bash
cat /orange/xiangyan/rithika/cdd/logs/cbp_tiny_fit_43223464.log
```

### 7.8 Reproduce the completed CNN-only / cBP-Tnet comparison

The user has supplied completed reports for both tasks of array **43230748**. These optional accounting commands on HiPerGator do not create more jobs:

```bash
squeue -j 43230748
sacct -j 43230748 --format=JobID,JobName,State,Elapsed,ExitCode
```

The already-completed summary can be reproduced without retraining:

```bash
python3 /orange/xiangyan/rithika/cdd/outputs/iphone_inference/cnn_comparison_20260924T200054145651Z/compare_cbp_cnn.py --summary --experiment-dir /orange/xiangyan/rithika/cdd/outputs/iphone_inference/cnn_comparison_20260924T200054145651Z
```

Those validation rows, selected-checkpoint train/validation metrics and stopping reasons have been supplied and are recorded in Section 6.13; no repeat is needed merely for confirmation. If a task fails, inspect `/orange/xiangyan/rithika/cdd/logs/cbp_cnn_43230748_0.err` or `_1.err`. An empty queue listing alone does not prove success; use accounting and result files. The tasks run sequentially with at most 90 minutes each, and can finish earlier. No automatic model export or phone update occurs.

### 7.9 Run the independent Mac work in parallel

The downloadable `cdd-parallel-work.zip` includes the repaired HPG script, calibration core/tests/installer, profiling payload/installer/collector, wearable-readiness memo and a root README. After extracting it into `~/Downloads/cdd-parallel-work`, the Mac components can be installed with:

```bash
node "$HOME/Downloads/cdd-parallel-work/install_mac.cjs" \
  --project /Users/rithika/Desktop/cddapp --apply
```

The user has already completed installation successfully; preserve the installation command above as a reproducibility record, not a required repeat. The root runner preflights both components before either writes. Conflicts stop installation for review. Calibration adds only library code; profiling adds a guarded screen link and new files with backup. Rebuild the existing working Xcode workspace, then open **Test ML model → Profile synthetic inference**. No new npm/native dependencies or clean prebuild are required by this package.

HPG training and physical-phone profiling can proceed independently. Calibration core tests can run on the Mac while both proceed. Device acquisition and a real cuff-pairing UI remain separate integrations; the package does not simulate their completion.


### 7.10 Additional-seed submission — reproducibility record

**This suite has completed; do not submit it again merely to confirm the results.** The commands below preserve the original procedure. The next action is Section 7.11.

Download **`run_cbp_multiseed.py`** to the Mac's Downloads folder. On the **Mac**:

```bash
scp "$HOME/Downloads/run_cbp_multiseed.py" \
  rmathew1@hpg.rc.ufl.edu:/orange/xiangyan/rithika/cdd/outputs/iphone_inference/run_cbp_multiseed.py
```

On **HiPerGator**, run once:

```bash
cd /orange/xiangyan/rithika/cdd
python3 outputs/iphone_inference/run_cbp_multiseed.py --submit
```

The runner performs only small metadata/code checks on the login node; the heavier preflight runs in a CPU Slurm job. The GPU array and automatic summary are submitted with dependencies immediately afterward. Once all IDs print, the terminal may close. Retain the printed suite path, IDs and commands. Do not resubmit to check progress; use the printed `squeue` or read-only summary command. A failed preflight prevents GPU training.

The user has supplied the final three-seed summary and all four new arm-completion logs. Each stopped by early stopping. The user subsequently supplied `preprocessing_review_source.txt`; review is complete. Continue with the new PPG-reference audit in Section 7.12.

### 7.11 Read the exact preprocessing review packet

On **HiPerGator**:

```bash
cat /orange/xiangyan/rithika/cdd/outputs/iphone_inference/cnn_multiseed_20260924T221508227477Z/preprocessing_review_source.txt
```

This handoff is complete: the user supplied the packet, and its definitions were reviewed. The code uses padding/truncation, not resampling. Keep this command as a record of the completed source handoff; current priorities are in Sections 6.22 and 8.

### 7.12 Submit the PPG-reference audit — completed procedure

This procedure has completed successfully. Keep these commands for reproducibility; use Section 7.13 for the current handoff.

Download `audit_cbp_ppg_reference.py` to the Mac's Downloads folder, then run on the **Mac**:

```bash
scp ~/Downloads/audit_cbp_ppg_reference.py \
  rmathew1@hpg.rc.ufl.edu:/orange/xiangyan/rithika/cdd/outputs/iphone_inference/
```

On **HiPerGator**:

```bash
cd /orange/xiangyan/rithika/cdd
python3 outputs/iphone_inference/audit_cbp_ppg_reference.py --submit
```

The script calls `sbatch` itself. After it prints the job ID, the terminal can close. Use its printed status/results/error commands and share the terminal summary first. No separate GPU request or phone rebuild is needed. A source/environment/parity failure is a diagnostic result to inspect, not a reason to remove the guard. The companion `cdd-ppg-reference.zip` includes the reference, synthetic tests, clearly labeled source transcription and a focused README.

### 7.13 Download the completed report and generated fixture — completed handoff

Run on the **Mac**, not inside the HiPerGator SSH session:

```bash
(
set -e
ppg_audit_remote="rmathew1@hpg.rc.ufl.edu:/orange/xiangyan/rithika/cdd/outputs/iphone_inference/ppg_reference_audit_20260925T022129409190Z"
mkdir -p ~/Downloads/cdd-ppg-handoff
scp "${ppg_audit_remote}/ppg_reference_report.json" \
    "${ppg_audit_remote}/synthetic_ppg_reference.json" \
    ~/Downloads/cdd-ppg-handoff/
open ~/Downloads/cdd-ppg-handoff
)
```

Both JSON files have now been attached, inspected and used for local mobile-port development. Keep the commands above for reproducibility; the subsequent phone tests are complete, and current priorities are in Sections 6.22 and 8. This is a read-only transfer of existing audit metadata and synthetic data. The existing report includes the synthetic fixture's hash, so the next stage can verify their pairing. Do not substitute a newly regenerated fixture or upload recorded dataset waveforms. No iPhone rebuild, USB connection or Slurm submission is needed for this transfer.

### 7.14 Install and run the raw-PPG phone test — completed procedure

Download `cdd-mobile-preprocessing.zip` to the Mac's Downloads folder. Connect the iPhone for installation, then run:

```bash
(
set -e
cd ~/Downloads
unzip -q cdd-mobile-preprocessing.zip
node cdd-mobile-preprocessing/install.cjs \
  --project /Users/rithika/Desktop/cddapp
node cdd-mobile-preprocessing/install.cjs \
  --project /Users/rithika/Desktop/cddapp --apply
cd /Users/rithika/Desktop/cddapp
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  npx expo run:ios --device --configuration Release
)
```

The first installer invocation is dry-run; the second applies the checked files. If Finder already extracted the ZIP, omit the unzip command. The explicit developer directory did not resolve the user’s subsequent Simulator.app lookup failure. Use the existing `ios/cddapp.xcworkspace` in Xcode, select the physical iPhone and Release Run configuration, then build/run with Cmd+R. The installer has already succeeded and the device report is now recorded in Section 6.19; there is no need to reinstall this preprocessing add-on. No new dependency installation or clean prebuild is required for this JavaScript-only addition.

On the iPhone, open **Test ML model → Test raw PPG preprocessing → Run preprocessing test**. Keep the app in the foreground, then tap **Share test report** and paste the JSON. Preserve any failure/error text instead of rerunning until a PASS appears. An unfamiliar-layout installer error requires the current `app/ml-test.tsx` for a safe merge; it does not authorize removing the guard.

### 7.15 Prepare reference values for the connected phone test — completed procedure

Download `prepare_cbp_chain_reference.py` into the Mac's Downloads folder. On the **Mac**:

```bash
scp ~/Downloads/prepare_cbp_chain_reference.py \
  rmathew1@hpg.rc.ufl.edu:/orange/xiangyan/rithika/cdd/outputs/iphone_inference/
```

On **HiPerGator**:

```bash
cd /orange/xiangyan/rithika/cdd
python3 outputs/iphone_inference/prepare_cbp_chain_reference.py --submit
```

Retain the printed job ID and use the exact log/status commands it prints. The CPU job continues if the terminal closes. After its log says `REFERENCE CREATED`, download the JSON on the **Mac**:

```bash
scp rmathew1@hpg.rc.ufl.edu:/orange/xiangyan/rithika/cdd/outputs/iphone_inference/raw_ppg_chain_reference_v1.json \
  ~/Downloads/
```

The user has now supplied that JSON; it is validated and bundled with the connected phone test. The commands above document the completed handoff and do not need repeating. On any intentional rerun failure, retain the log/error text and the fingerprint/contract guards.

### 7.16 Install and run the connected iPhone test — completed procedure

Download `cdd-mobile-chain.zip` into the Mac's Downloads folder. In the **Mac terminal**:

```bash
(
set -e
cd ~/Downloads
if [ ! -d cdd-mobile-chain ]; then
  unzip -q cdd-mobile-chain.zip
fi
node cdd-mobile-chain/install.cjs --project /Users/rithika/Desktop/cddapp
node cdd-mobile-chain/install.cjs --project /Users/rithika/Desktop/cddapp --apply
open -a Xcode /Users/rithika/Desktop/cddapp/ios/cddapp.xcworkspace
)
```

Connect/unlock the iPhone. In Xcode select the **cddapp** scheme and physical **Rithika's iPhone** destination. Confirm **Product → Scheme → Edit Scheme → Run → Info → Build Configuration: Release**, close the dialog, then press **Cmd+R**. Use the existing workspace; the Expo launcher has repeatedly failed while looking up Simulator.app.

Open **Test ML model → Test raw PPG to model output → Run connected test**. Keep the app in the foreground and share the JSON using **Share test report**. Retain errors and failed reports. The package contains the uploaded oracle. The user has now supplied the successful connected device result in Section 6.22; these commands are retained for reproducibility and do not need repeating.

## 8. Completion criteria for the next milestone

The synthetic on-device integration milestone is complete. The next milestone is a **recorded-PPG research replay with a documented model evaluation**.

- Retain the completed three-seed comparison and use CNN-only as the smaller development architecture. Retain the completed PPG-reference audit. Its sampled legacy parity is established, and the raw synthetic phone fixture now passes in Hermes. Broader recorded-signal mobile parity, labeling/segmentation and historical identity provenance remain separate unresolved contracts.
- Select candidate models using development/validation data, with a reserved final evaluation strategy and subject/session separation.
- Demonstrate useful improvement over the appropriate population and personal-reference baselines, with uncertainty and change-tracking results.
- Retain the completed raw-preprocessing report, Python oracle and connected physical-iPhone report. Extend parity to approved recorded fixtures with a defined PPG-only quality policy; candidate model changes need their own export and normalization contract.
- Retain the three phone timing reports and completed five-cycle native memory result. Document outstanding offline fresh-launch/run conditions and measure true app-launch/energy behavior separately; assess longer-session or candidate-specific memory when relevant.
- Integrate the now-tested calibration/profile core with collection UI, trustworthy storage/activation and mobile state handling.
- Identify and verify raw-PPG access on the actual wearable before implementing its transfer path.
- Keep monthly validity, clinical accuracy, and wearable deployment as unfulfilled claims until their specific studies/tests have been completed.

## 9. Sources and evidence boundaries

**Project evidence:** user-supplied Git/Slurm/export outputs and device screenshots; the saved-model audit; the completed augmentation comparison summary; the completed label-window audit log; both completed upstroke-proxy arm reports; their selected/last-epoch history rows; the completed fixed-checkpoint train/validation audit; the successful tiny-fit log for job 43223464; the reviewed training source, diagnostic/comparison scripts, and phone-test installer. Device tests, GPU training, and dataset audits were run by the project owner, not remotely executed by the document author. The actual dataset waveform plots and complete learning curves have not been reviewed here. The tiny-fit probe ran successfully. The first CNN-only/cBP-Tnet attempt failed on the supplied index/identity guard; the repaired preflight passed on HiPerGator and both task summaries from array 43230748 were supplied, with nearly identical validation MAEs for the two architectures. Calibration core tests ran locally. The user supplied three phone profiling JSONs, preserved separately; all raw timings reproduce their respective summaries. A supplied Settings screenshot identifies iPhone 16 Pro and iOS 26.6.2. Actual debugger/charging/thermal conditions and independent app-process restarts were not captured by the JSON schema. No new test-set or personal-calibration result is inferred from these engineering/development experiments. The later same-PID Xcode screenshots add an initial memory sequence (30.6 MB before, displayed high 70.3 MB, and 58.8 MB in the image labeled ten seconds afterward). They do not establish a leak or an energy measurement. The automatic memory add-on passed 18 local stand-in/installer tests and subsequently produced the supplied five-cycle physical-device summary. Its arithmetic, identities and reported completeness criteria were checked; raw memory samples and inference-duration arrays were omitted, so their medians/peaks/percentiles were not independently recomputed. All phone observations remain user-run evidence. The additional-seed runner passed twelve local preparation tests, and the user subsequently supplied its completed three-seed terminal summary plus four new arm-completion logs. Exact paired differences/statistics and the new full-precision arm values were checked; aggregate model mean/SD values are consistent with the available printed precision. The complete on-disk multi-seed summary JSON and checkpoint hashes were not independently retrieved during that review. The user subsequently supplied the source-only preprocessing packet. Its definitions informed the new reference implementation; 13 local tests passed on generated signals and temporary synthetic datasets. The user then supplied the completed PPG-reference terminal output. Its counts and exact-parity flags were reviewed and the totals recomputed. The full report and generated fixture were subsequently attached and read directly. Controller/detector/fixture hashes match available local bytes; Python regenerates the uploaded fixture exactly. The first JavaScript port passes local fixture checks and a ten-case synthetic comparison; sixteen core and eight installer tests pass. TSX syntax/transpilation checks pass. Actual HPG raw files were not independently reread here, and the user has now supplied its passing Hermes/non-development iOS report, preserved in Section 6.19. Source/fixture hashes match delivered bytes and all 3,008 checked values have zero reported difference. The connected-chain reference generator has passed eight local checks, including stand-in inference and mocked Slurm submission; the user subsequently attached its generated reference with original-model CPU ONNX outputs. The reference controller hash matches, and all normalized features were independently reproduced exactly; the new outputs remain user-run model evidence. The connected phone package then passed 26 local tests and four TS/TSX syntax checks, with stand-in ONNX resources and model bytes where documented. The user then supplied its passing physical-phone report. All eight output differences and their maxima were independently recomputed; source/reference hashes match delivered bytes. The four inference calls averaged 2.977854 ms and the full test-call time was 165.699583 ms. These observations remain user-run evidence on one synthetic recording. There is no final test-set accuracy result from these synthetic engineering checks.

**Reviewed project source:** [cddapp training source on `rithika-ML`](https://github.com/ethankrol/cddapp/blob/rithika-ML/python%20code/cbp_tnet_train_v4_final.py), Git blob `40b0ff63c48ebf793b3075b0f3bf3f991187fe5e`. Branch URLs can change; preserve that source revision and the experiment snapshots.

External references below were checked September 24, 2026. They support the stated background or procedures; they do not validate this app or determine its calibration interval.

1. **[R1] American Heart Association.** *Cuffless Devices for the Measurement of Blood Pressure.* Scientific-statement summary, updated December 11, 2025. [Official summary](https://professional.heart.org/en/science-news/cuffless-devices-for-the-measurement-of-blood-pressure). Statement DOI: [10.1161/HYP.0000000000000254](https://doi.org/10.1161/HYP.0000000000000254).
2. **[R2] Stergiou et al. (2023).** *European Society of Hypertension recommendations for the validation of cuffless blood pressure measuring devices.* Journal of Hypertension, 41(12), 2074–2087. [PubMed](https://pubmed.ncbi.nlm.nih.gov/37303198/). DOI: [10.1097/HJH.0000000000003483](https://doi.org/10.1097/HJH.0000000000003483).
3. **[R3] American Heart Association.** *Home Blood Pressure Monitoring.* [Official instructions](https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings/monitoring-your-blood-pressure-at-home).
4. **[R4] Microsoft ONNX Runtime.** *How to develop a mobile application with ONNX Runtime.* [Documentation](https://onnxruntime.ai/docs/tutorials/mobile/).
5. **[R5] Expo.** *Expo CLI: compiling iOS and production asset embedding.* [Documentation](https://docs.expo.dev/more/expo-cli/).
6. **[R6] Apple.** *Gathering information about memory use.* [Xcode documentation](https://developer.apple.com/documentation/xcode/gathering-information-about-memory-use).
7. **[R7] Apple.** *Technical Note TN2434: Minimizing your app’s Memory Footprint.* Archived technical note; conceptual profiling guidance, with current UI details checked against the installed Xcode version. [Technical note](https://developer.apple.com/library/archive/technotes/tn2434/_index.html).
8. **[R8] Moulaeifard, Charlton, and Strodthoff.** *Generalizable deep learning for photoplethysmography-based blood pressure estimation—A Benchmarking Study.* Machine Learning: Health 1(1):010501, 2025; arXiv v2 revised March 1, 2026. [Paper](https://arxiv.org/abs/2502.19167v2). DOI: [10.1088/3049-477X/ae01a8](https://doi.org/10.1088/3049-477X/ae01a8).
9. **[R9] Mathew et al. (2026).** *Benchmarking and Enhancing PPG-Based Cuffless Blood Pressure Estimation Methods.* Preprint; no journal reference listed on the inspected arXiv page. [Paper](https://arxiv.org/abs/2602.04725).
10. **[R10] AI4HealthUOL.** Author repository for the generalization benchmark. [Code](https://github.com/AI4HealthUOL/ppg-ood-generalization).
11. **[R11] PyTorch 2.10.** *Autograd mechanics.* Evaluation mode is separate from gradient disabling. [Documentation](https://docs.pytorch.org/docs/2.10/notes/autograd.html).
12. **[R12] PyTorch 2.10.** *MSELoss.* [Documentation](https://docs.pytorch.org/docs/2.10/generated/torch.nn.MSELoss.html).
13. **[R13] PyTorch 2.10.** *torch.backends*, including the multi-head-attention fast-path control. [Documentation](https://docs.pytorch.org/docs/2.10/backends.html).

14. **[R14] PyTorch 2.10.** *Reproducibility.* [Documentation](https://docs.pytorch.org/docs/2.10/notes/randomness.html).

15. **[R15] Apple.** *normalizedReflectance.* PPG waveform and scale caveat. [Documentation](https://developer.apple.com/documentation/sensorkit/srphotoplethysmogramopticalsample/normalizedreflectance-9aidm).
16. **[R16] Apple.** *Configuring your project for sensor reading.* Approved research entitlement and participant authorization. [Documentation](https://developer.apple.com/documentation/sensorkit/configuring-your-project-for-sensor-reading).
17. **[R17] Apple.** *SRFetchRequest.* Documented 24-hour holding period. [Documentation](https://developer.apple.com/documentation/sensorkit/srfetchrequest).

18. **[R18] Expo.** *Get started with local native modules* and *Autolinking*. Existing iOS projects need pod integration and native rebuild; the default local-module directory is `./modules`. [Module guide](https://docs.expo.dev/modules/get-started/) · [Autolinking](https://docs.expo.dev/modules/autolinking/).
19. **[R19] Expo.** *Module API: native functions, queues and lifecycle*. [Documentation](https://docs.expo.dev/modules/module-api/).
20. **[R20] Apple.** *task_vm_info_data_t*. Structure includes physical-footprint and resident-size fields. [Kernel documentation](https://developer.apple.com/documentation/kernel/task_vm_info_data_t).
21. **[R21] Apple.** *Required-reason APIs: system boot time*. Elapsed-time measurement declaration and restrictions. [Documentation](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype).

22. **[R22] UF Research Computing.** *Scheduling* and *Available Node Features*. Batch submission, default allocation and EL9 selection. [Scheduling](https://docs.rc.ufl.edu/quickstart/scheduling/) · [Node features](https://docs.rc.ufl.edu/scheduler/node_features/).
23. **[R23] SchedMD.** *sbatch* and *Job Array Support*. Successful/terminal dependencies, invalid-dependency handling and array concurrency. [sbatch](https://slurm.schedmd.com/sbatch.html) · [Arrays](https://slurm.schedmd.com/job_array.html).

24. **[R24] NumPy 2.2.** *numpy.gradient.* Default unit sample spacing and first-order boundary differences. [Documentation](https://numpy.org/doc/2.2/reference/generated/numpy.gradient.html).
25. **[R25] pyampd author repository.** *AMPD usage and scale parameter.* The job also records the actually installed implementation hash. [Repository](https://github.com/ig248/pyampd).
26. **[R26] SciPy.** *find_peaks.* Peak detection/properties used by the unchanged audit-only ABP selection. [Documentation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.find_peaks.html).

27. **[R27] NumPy.** *NEP 50 — Promotion rules for Python scalars.* Explains float32/Python-scalar arithmetic relevant to the port. [Documentation](https://numpy.org/neps/nep-0050-scalar-promotion.html).
28. **[R28] Expo / React Native.** *Expo Router SDK 54* and *Share.* Native routing and user-initiated result sharing. [Router](https://docs.expo.dev/versions/v54.0.0/sdk/router/) · [Share](https://reactnative.dev/docs/share).

29. **[R29] ONNX Runtime.** *Python API documentation.* `InferenceSession`, execution providers, metadata and NumPy input/output interfaces. [Official documentation](https://onnxruntime.ai/docs/api/python/api_summary.html). Checked September 25, 2026 UTC.

30. **[R30] ONNX Runtime.** *InferenceSession — JavaScript API.* Session execution, input/output names and resource release. https://onnxruntime.ai/docs/api/js/interfaces/InferenceSession.html . Checked September 25, 2026 UTC.
31. **[R31] React Native.** *AppState.* Foreground/background state and change subscriptions. https://reactnative.dev/docs/appstate . Checked September 25, 2026 UTC.
