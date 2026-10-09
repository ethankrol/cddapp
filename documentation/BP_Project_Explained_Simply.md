# Your blood-pressure app, explained simply

Updated September 25, 2026. This guide explains the results you supplied. The detailed engineering report contains the full measurements and research history.

## 1. What have we actually built?

Your iPhone can load the trained model and run its calculations locally. You have also run a connected test that starts with an artificial pulse waveform, prepares it, and feeds four detected beats into that model.

You operated the physical iPhone and sent the screenshots and JSON reports. The assistant prepared code, checked reference calculations and reviewed your reports; it did not remotely operate your phone. The reports record successful native inference in your iOS app. They do not show a watch collecting your actual pulse or establish accurate personal blood-pressure measurements.

There are two different questions:

| Question | What our work shows |
|---|---|
| Can this model run correctly on an iPhone? | Yes, for the synthetic inputs and test procedures we ran. |
| Does it accurately measure someone's real blood pressure? | That remains unresolved; the original model's accuracy results are weak. |

## 2. What is PPG?

PPG is the pulse-shaped signal obtained by shining light into tissue and measuring the reflected or transmitted light. For this project, think of it as a list of numbers describing a changing wave.

Our current preprocessing expects **125 numbers per second**. Therefore a 30-second recording contains **3,750 numbers**. These are signal samples, not 3,750 blood-pressure readings.

Your SFH 7050A provides LEDs and a light detector. Additional electronics must turn the detector signal into digital samples. Your ADXL366 measures motion; a future quality-checking system could use it to flag movement. We still need the analog readout and Bluetooth microcontroller details.

## 3. If PPG keeps arriving, how can the model fit on a phone?

The model is a fixed collection of learned numbers and instructions. New pulse samples do not make the model larger. A future continuous system would keep a limited recent section of signal, process it, and reuse that memory for subsequent sections. Saving every raw recording indefinitely would be a separate storage decision.

The model on your phone is approximately **20 MB on disk**. During the separate automated test, the **whole app's measured physical memory footprint** started around **35.1 MB**, reached a sampled peak of **72.1 MB**, and settled around **50.2 MB** after five cycles. The whole-app number includes the app, runtime, recorder and reports, not just the model. That short test does not establish battery use or all-day stability.

For each model call, the app supplies one prepared beat:

- 250 values describing the PPG wave;
- 250 values describing how quickly the wave changes;
- 250 values describing how that rate of change changes;
- two timing values.

These are 752 input numbers, occupying 3,008 bytes when each number is stored as a 32-bit float, before software overhead. The model's temporary working memory is additional.

The three wave channels are **PPG and two calculated derivatives**. They are not the sensor's three LED colors and not the accelerometer's three axes. Short beats are padded to 250 values; 250 does not mean every beat lasts two seconds.

## 4. Why did my test finish so quickly?

**The test input was already saved in the app. The phone did not wait for a sensor to collect it.** Thirty seconds of signal can be stored in a file and processed faster than thirty seconds, just as a computer can inspect an existing audio clip without playing the entire clip in real time.

Your latest connected test used this sequence:

| Step | What happened | Reported time |
|---|---|---:|
| Start with the bundled input | Read an artificial 3,750-sample waveform representing 30 seconds | No 30-second acquisition wait |
| Prepare the waveform | Filter it, find pulse boundaries and calculate features; find 31 candidate beats | 45.92 ms |
| Adjust numerical scales | Normalize the first four candidate inputs using saved training statistics | 0.49 ms |
| Prepare the model runtime | Create a fresh ONNX inference session | 99.77 ms |
| Run predictions | Run four single-beat predictions; compare each with the saved Python result | 2.98 ms per call on average |
| Finish | Check results and release the session | Entire test call: 165.70 ms |

One millisecond is one thousandth of a second. **165.70 ms is about 0.166 seconds.** Some setup, comparisons and cleanup are included in the total but not listed separately above.

The test detected 31 candidates, but only **the first four** went through the numerical feature checks and model inference. It did not run all 31 through the model, average a full recording, or apply personal calibration.

With a real sensor, collecting a fresh 30-second recording would still take 30 seconds. Processing happens after sufficient data arrives. Whether we use whole windows or a rolling window needs a separate implementation and validation. The existing peak detector/preprocessing test operates on a complete saved recording; it is not yet an always-running streaming service.

Training and prediction are also different jobs. Training on HiPerGator repeatedly adjusts the model using many examples. Prediction on the phone uses the already-trained model without repeating training. That is why long training does not imply a long wait for every prediction.

## 5. What did PASS mean?

Python calculated reference outputs ahead of time. Your phone independently calculated outputs from the supplied inputs, and the test compared the two. The expected-output values are used for checking, not substituted for the phone's predictions.

The allowed software difference is **0.01 mmHg for each output**. In the connected test, the largest differences were approximately **0.00000763 SBP** and **0.00001144 DBP**. The input preparation and normalization checks reported exact matches for the four checked candidates.

This is a check that the same calculation works on the phone. A model can match Python perfectly while giving poor predictions of real blood pressure. Matching Python and matching a reference cuff answer different questions.

Other completed tests:

| Test | Result and scope |
|---|---|
| Three timing runs on a prepared synthetic input | 333 successful calls; no numerical-comparison or runtime failures. Run means: 6.187, 9.713 and 6.436 ms. |
| Five-cycle memory test | 555 successful calls; 1,251 memory samples and no reported sampling failures. Settled memory decreased across these five cycles; this is not proof of no leaks. |
| Raw waveform preparation test | 31 candidates; four candidates checked numerically with zero differences. |
| Connected raw waveform test | Four successful model calls after raw preprocessing and normalization; total 165.70 ms. |

The memory test sampled the app while inference ran. Its timings should not be combined with timings collected without the memory sampler. Energy use, genuine cold app startup and long continuous acquisition remain unmeasured.

## 6. What are SBP, DBP and MAE?

- **SBP:** systolic pressure, the top blood-pressure number.
- **DBP:** diastolic pressure, the bottom number.
- **mmHg:** the unit used for blood pressure.
- **MAE:** mean absolute error, the average size of the model's mistakes, ignoring whether each mistake is high or low.

For a fictional example, suppose three reference SBP values are 120, 130 and 140, while the model predicts 125, 120 and 145. The mistake sizes are 5, 10 and 5. Their average is `(5 + 10 + 5) / 3 = 6.67 mmHg`. An MAE is an average over the evaluated examples, not a guarantee for every prediction or person.

## 7. What does calibration mean?

Calibration means using paired reference measurements to estimate a person's consistent prediction error, then applying a correction.

In our proposed first version, there are **two separate corrections**: one for SBP and one for DBP. A positive correction is added; a negative correction is subtracted. It does not retrain the neural network.

Fictional example:

| Paired observation | Model output | Reference cuff | Cuff minus model |
|---|---|---|---|
| First | 118 / 76 | 126 / 80 | +8 / +4 |
| Second | 122 / 78 | 128 / 82 | +6 / +4 |
| Average correction | | | **+7 / +4** |

A later model output of **121 / 77** becomes **128 / 81** after adding those corrections once.

The cuff and pulse recording must describe appropriately matched measurement conditions. An old cuff reading paired with an unrelated new waveform is not a valid pair. The exact pairing procedure and signal-quality rules remain to be validated.

## 8. What does weighted mean?

A weight says how much an observation contributes to an average. Equal weights mean every accepted observation counts equally. If a future validated quality rule gives one pair more weight, its correction contributes more.

For example, corrections of +8 and +6 average to +7 with equal weights. Weights of 0.75 and 0.25 would give `0.75 × 8 + 0.25 × 6 = +7.5`. Those unequal weights are only an arithmetic example, not a proven policy.

The recommendation is to start with equal weights for accepted pairs and introduce quality-based weights only after evaluating them. The proposal is not an arbitrary mixture of a current model output and last month's cuff value. It estimates a correction from paired observations.

Combining several beats from one recording is another average. Many beats attached to one cuff reading do not become many independent cuff measurements.

## 9. What would monthly calibration look like in the app?

This is the documented design; the complete user interface and storage are still pending.

1. The user starts a calibration session for the correct account and sensor.
2. The app collects pulse recordings and paired reference cuff readings under a specified measurement protocol.
3. The app rejects unusable signal or invalid pairs and calculates the two corrections from accepted pairs.
4. It saves a versioned profile containing the corrections, reference pairs, measurement times, expiry policy, user, sensor and exact model/preprocessing identity.
5. Later predictions use a compatible, unexpired profile. The app adds the two corrections once after combining accepted beats into a recording estimate.
6. A new calibration session creates a new profile while keeping the old one associated with older results.

A rolling **30-day reminder/expiry** is a proposed product rule. We have not shown that this model stays accurate for 30 days. That requires measurements taken over time.

The proposed storage is local to the app so it can work offline, with appropriate account separation and protection. Optional cloud synchronization is a separate feature. Missing, expired, incompatible or invalid calibration should return an explicit unavailable/calibration-required status. It should not silently reuse another user's profile or present an old cuff value as a new measurement.

The small calculation library has been implemented and tested. The calibration screen, persistence, reminders and full phone workflow remain future work. Questions still open include the cuff/PPG pairing procedure, quality rules, acceptable reference disagreement and how long corrections remain useful.

## 10. Is my `.pth` the right model?

The deployment demonstration uses the **original cBP-Tnet checkpoint**. The phone executes **`cbp_tnet.onnx`**, which was converted from that checkpoint. It does not execute the `.pth` file directly. ONNX is the portable model format; ONNX Runtime is the software doing its calculations on the phone.

| File | Role |
|---|---|
| `python code/cBP-Tnet_Model.pth` | Original trained weights used to create the demonstrated phone model |
| `assets/models/onnx_export/cbp_tnet.onnx` | Actual model loaded by the iPhone tests |
| `assets/models/onnx_export/normalization.json` | Saved numbers used to put inputs on the training scale |
| `assets/models/onnx_export/export_report.json` | Records which checkpoint, normalization and exported model belong together |

The cleanup tool checks exact file fingerprints, called SHA-256 hashes. Matching fingerprints establish that the bytes match the known tested package; they do not establish good BP accuracy or inspect what is currently installed inside an already-built phone app.

Known original checkpoint fingerprint:

```text
2cabfe0c64bf2463495d9581dea837638c41c149948abd9730b8b6be25fd0169
```

Known phone ONNX fingerprint:

```text
a8e26e25b852344814e4a474e73e92b9f8d40845c20948fdcce828c9e4f12fce
```

These hashes should differ because `.pth` and `.onnx` are different files. The export report records their relationship. Replacing a `.pth` on your Mac does not automatically update the ONNX model already bundled into the phone.

## 11. Did we test better or state-of-the-art models?

“State of the art,” usually abbreviated **SOTA**, means leading published methods under a specified task and evaluation setup. We have **not** run a benchmark of external published SOTA models in this project. We did run several controlled development experiments on HiPerGator, including augmentation on/off, keeping/masking a timing input, and a smaller CNN versus cBP-Tnet.

For the matched comparison, both architectures were trained using the same new recipe and three declared random seeds. A seed controls random initialization and sampling; repeats help show how much results vary between runs.

| Development model | Learned parameters | Mean validation SBP MAE | Mean validation DBP MAE |
|---|---:|---:|---:|
| Smaller CNN | 464,962 | 13.0435 mmHg | 8.6337 mmHg |
| cBP-Tnet under the new recipe | 5,219,394 | 12.9911 mmHg | 8.6854 mmHg |

The CNN uses about **91% fewer parameters** and achieved very similar errors. It is a useful smaller candidate for further work; three seeds do not prove that it is more accurate or statistically equivalent. It has not been exported and installed on your phone, and its new input/output preparation differs from the original export.

The **original deployed model**, in a separate test-set audit, had SBP/DBP MAE of **14.3402 / 9.5348 mmHg**. A simple fixed training-average prediction achieved **14.2803 / 9.4769**, slightly better. After personal calibration, the original model performed almost the same as simply using each person's reference-average BP. This is why successful phone execution does not mean the original checkpoint is ready to measure BP reliably.

Do not directly rank the new validation numbers against the original test numbers: they describe different splits and training recipes. Fair external-model comparisons need the same patient splits, preprocessing assumptions, reference budget and evaluation rules. Historical cache-to-patient identities also remain reconstructed rather than independently certified.

## 12. What can I mark complete?

| Assigned task | Status |
|---|---|
| Document the weighted/monthly calibration approach | Complete as a design document, with assumptions and open questions stated. |
| Demonstrate on-device inference with mock data and record observations | Complete for the documented physical-phone tests. |
| Connect actual sensors and Bluetooth | Pending. |
| Integrate calibration collection and saved profiles | Pending. |
| Establish useful real-world BP accuracy and long-term stability | Pending. |

On September 25, the remote `rithika-ML` branch was still at commit `2852dd8`: it contained the original `.pth` and training source, but not the later phone-test services, ONNX assets or native modules. Those local changes need to be included in the eventual handoff.

## References and evidence

- Project evidence: your supplied device JSON reports, screenshots and HiPerGator logs; full detail is in `CDD_Blood_Pressure_Engineering_Status_and_Calibration.md`.
- [ONNX Runtime for React Native](https://onnxruntime.ai/docs/get-started/with-javascript/react-native.html): the native runtime used by the app.
- [Expo native-project guidance](https://docs.expo.dev/workflow/continuous-native-generation/): manually maintained native changes must be preserved; a clean prebuild regenerates native directories.
- [SFH 7050A datasheet](https://look.ams-osram.com/m/25bef8c13d694a2/original/SFH-7050A.pdf) and [ADXL366 product documentation](https://www.analog.com/en/products/adxl366.html): sensor roles, not evidence of this app's BP accuracy.
