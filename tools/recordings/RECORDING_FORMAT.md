# Recording import formats

`node tools/recordings/inspect_recording.cjs FILE` and the app use the same pure-JavaScript validation and diagnostics. Files are limited to 4 MiB and 30,000 rows. No parser guesses a sample rate, applies normalization/resampling, runs ONNX or saves a health result.

## Existing team CSV

Exact header (UTF-8 BOM and CRLF are accepted):

```csv
time_stamp_millis,RawRed,RawIR
1000,-0.14,-3.05
1021,-3.11,-1.04
```

Both columns are retained. Their names match the existing logger; the supplied firmware establishes that they contain baseline-subtracted values. Timestamps are uint32 device print times in milliseconds, not verified optical acquisition times. The importer checks finite numbers, row widths, timing distribution and both channel ranges. Blank/malformed interior rows cause a clear error instead of silent deletion. Sequence loss, actual sampling rate, ADC limits, UTC start time, sensor identity and cuff truth remain unknown. No BP inference or beat preview is enabled for this format.

## Diagnostic raw capture CSV

Exact header:

```csv
sequence,read_started_us,read_finished_us,fifo_available,red_counts,ir_counts
0,1000000,1006000,1,102030,203040
1,1020000,1026000,1,102080,203080
```

`sequence` is an emitted-read counter, not the sensor acquisition counter. Read timestamps are uint32 host microseconds and can wrap; reversed times stay visible and block timing interpretation. FIFO occupancy is diagnostic, not proof of overflow absence. Counts are nonnegative integers in the library's 24-bit transport; this is not a verified ADC clipping threshold. Original counts are preserved. The logger saves a separate `.csv.json` with collection identity and settings supplied by the operator. The current app reads the CSV only; it does not silently merge a sidecar or infer unknown settings. A verified acquisition clock and full sensor contract are required before conversion to the JSON preview path.

## Fully described single-channel JSON

Generate a **synthetic** complete example (do not relabel it as a person's recording):

```bash
node -e "process.stdout.write(JSON.stringify(require('./services/recordings/recordingCore').makeDemoRecording(), null, 2))" > /tmp/cdd-synthetic-recording.json
```

Schema: `cdd_ppg_recording_v1`, `schemaVersion: 1`. All fields below are required and extra root/nested metadata fields are rejected.

| Field | Type / meaning |
|---|---|
| source | `recorded` or `synthetic`; not a clinical eligibility flag |
| recordingId, participantCode | Nonempty identifiers; participant code is 1–64 letters, digits, `_` or `-` |
| startedAt | UTC ISO timestamp with milliseconds; do not derive from a filename |
| samplingRateHz | Actual documented rate, number 1–2,000 |
| timingSource | `sensor`, `sample_clock`, or `arrival` |
| sensor | `{id, model, firmwareVersion, site}` nonempty strings |
| channel | `{name, wavelengthNm, units, adcMin, adcMax}`; unknown wavelength/ADC limits use `null` |
| acquisition | `{gain, ledCurrentMa, preprocessing}`; unknown LED current may be `null`; other fields are strings |
| samples | Array of `[sequence, offset_ms, ppg_value]`; finite values, sequence safe integer, offset 0–86,400,000 ms |

Beat preview is possible only for declared 125 Hz JSON with at least 3,750 samples and no detected timing, sequence, flatline or declared-rail problems. It runs the existing legacy extractor on **every complete nonoverlapping 3,750-sample window**, reports the unused tail, and never runs a BP model. It preserves the legacy segmentation defects; this is not physiological validation.

Timing mismatch tolerance is `max(0.5 ms, 20% of one sample period)` and the whole-record rate discrepancy threshold is 1%. One second of exactly repeated values blocks preview. These are conservative, unvalidated engineering checks, not a validated signal-quality classifier. Passing them never confirms the declared metadata, device compatibility or clinical usability.

`arrival` timing is blocked. `sample_clock` timing is flagged as not independently measuring jitter. Unknown ADC limits disable clipping checks and produce a warning. Upstream preprocessing must be disclosed; it is not undone automatically.

## Local cuff storage

`cdd-research-calibration-v1.db` is separate from the existing journal/profile database. The new UI only stores unmatched cuff drafts. The pure storage adapter can persist/revalidate profiles created by the existing calibration core, select a compatible unexpired profile, and revoke one. The UI does not create or apply those profiles.

No account authentication or additional database encryption is added. Participant filtering helps prevent accidental mixing but is not access control. This feature does not implement cloud sync or manage OS backup policy. Delete controls apply to the selected local draft, not original sensor documents elsewhere.
