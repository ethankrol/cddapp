# Ordered implementation deliverables

Date: 2026-09-23
Status: Initial scaffold, shared contracts, and the requested inference, AWS sync, and BLE foundations are implemented. Commit `90aa96b` is pushed. Validation was rerun after dependencies were installed; results are recorded below.

Read alongside [the architecture design](service-foundations-design.md). Implement the numbered deliverables in order. Each is a reviewable change set containing implementation, its focused tests, and relevant documentation. “Push contents” below describes what a future authorized change should contain; nothing is being committed or pushed now.

## Scope and order

The first release is service foundations with an explicit demo pipeline. Preserve all existing screens and `services/database.ts` profile behavior. Do not add BLE packages, guess firmware constants, implement a BP formula, or start measurements from the app layout.

| Order | Deliverable | Depends on | Completion result |
| --- | --- | --- | --- |
| 0 | Inactive repository/service scaffold — completed | Existing repo | Placeholder modules exist; no functional pipeline. |
| 1 | Domain contracts and test foundation — completed | Existing repo | Shared boundaries and runtime guards are testable. |
| 2 | Device interface, decoder boundary, demo device | 1 | Controlled synthetic packet events without hardware. |
| 3 | Window assembly | 1–2 | Exactly one complete window for valid complete input. |
| 4 | Window/profile validation and mock prediction | 1–3 | Explicit mock result from accepted demo inputs. |
| 5 | Readings repository and SQLite | 1, 4 | Durable, idempotent readings without profile changes. |
| 6 | Measurement coordinator | 2–5 | Safe connection-to-storage orchestration. |
| 7 | Demo harness and integrated verification | 1–6 | Reproducible end-to-end demo with documented limitations. |
| 8 | Hardware and model integration, later | Approved team contracts | Real decoding/inference; outside foundation scope. |

File names below are proposed repository-relative paths. Keep service tests outside `app/` so Expo Router cannot interpret them as routes. Existing UI files are not part of any foundation change set.

## 0. Create the inactive service scaffold — completed

The user authorized this preliminary step after the planning documents were created.
The proposed service files from steps 1–7 now exist, including device/decoder/demo,
assembly/validation/profile/coordinator, prediction/mock, repository/SQLite/migrations,
and demo composition modules. `types/measurement.ts` reserves the domain contract location.
See [the scaffold guide](../services/README.md) for folder responsibilities.

Each temporary service entry point throws `ServiceNotImplementedError` when called.
Imports have no operational side effects. Domain interfaces and events are not yet
defined; their placeholder entry points are not stable public APIs. The type file
exports no permissive substitute types. Deliverable 1 has since replaced the shared
type, error, clock, and packet-validation placeholders with real contracts and behavior.

Scaffold deliverables: placeholder `.ts` modules, shared unimplemented error, service
README, and updated design/plan/memory. No test runner, fake fixtures, native dependencies,
database schema, or UI wiring is added in this step. Existing `services/database.ts`
remains unchanged. Focused behavior tests belong to the functional steps below.

Next implement step 1, then continue in numbered order. No BLE, demo emissions,
assembly, validation, mock prediction, readings persistence, or coordination works yet.

## 1. Establish shared contracts and test foundation — completed

Implemented the shared sensor/window/profile/prediction/reading contracts, collision-safe
source-window identity encoding, typed service errors, injectable system/manual clocks,
and a bounded runtime normalized-packet validator. Synthetic fixtures explicitly retain
unknown sensor units and rates. Node's built-in TypeScript-stripping test runner avoids
adding a second framework to the Expo app.

Focused tests cover valid unequal channel coverage, unknown units/rates, invalid numeric
samples, invalid indexes and offsets, duplicate channel declarations, out-of-coverage
chunks, resource-limit errors, defensive sample copying, identity-key collisions, and
wall-clock versus monotonic time. The final focused suite runs 18 tests covering packet
validation, inference, AWS sync, and BLE handling; all pass. After disk space was freed,
dependencies installed successfully, and both `npm run typecheck` and `npm run lint`
passed. An earlier installation attempt had failed with `ENOSPC`, but that condition is
resolved and is not the current validation status. Tests use Node 22's built-in runner.

### Push contents

- `types/measurement.ts`: sensor, window, profile, prediction, and saved-reading contracts.
- `services/measurement/errors.ts`: typed error codes and context.
- `services/measurement/packet-validation.ts`: normalized packet runtime guards.
- `services/measurement/clock.ts`: injectable timing interface.
- `tests/fixtures/measurement.ts`: small, explicitly synthetic fixtures.
- `tests/measurement/packet-validation.test.ts` and minimal test-runner configuration.
- `package.json` and lockfile changes only for the chosen compatible test tooling and scripts.

### Detailed design

Use discriminated unions for modes and results. Keep mutable transport state out of public domain objects. Suggested contracts:

| Type | Fields and invariants |
| --- | --- |
| SourceWindowIdentity | Source mode, device ID, acquisition/boot ID, window ID. Identity must remain stable during replay. |
| WindowManifest | Contract version, positive integer packet count, required channel IDs and positive integer sample counts. All sizes must respect supplied resource limits. |
| ChannelChunk | Channel ID, nonnegative integer sample offset, finite numeric sample values, and explicit available units/timing. No assumed shared sampling rate. |
| SensorPacket | Identity, manifest/reference, normalized zero-based packet index, chunks, and phone receive time. Index normalization is an application convention, not a wire-format decision. |
| CompleteSensorWindow | Identity, manifest, fully covered ordered channels, acquisition clock metadata, receive interval, and assembly diagnostics. |
| ValidatedSensorWindow | Complete window plus validation mode, input-contract version, and validator version. Constructor belongs to the validator. |
| PredictionProfile | Immutable validated feature snapshot with explicit units, profile-contract version, source, and validation timestamp. Initial demo may use age/height/weight; real required features remain ML-defined. |
| BPPrediction | Systolic, diastolic, explicit unit, prediction timestamp, source identity, mock/real discriminator, and applicable version provenance. |
| SavedReading | Stable ID/key, prediction, timing, independent device-source and prediction-mode labels, and minimal profile snapshot. |

Represent acquisition time as an explicit variant: synchronized wall clock, device ticks with clock metadata, or unavailable. Never substitute receipt time as if it were acquisition time. Keep monotonic elapsed time for deadlines separate from wall-clock timestamps.

Use an unambiguous identity encoding, such as a serialized tuple, instead of delimiter concatenation that can collide. The persistent identity includes source mode but does not include the phone connection generation. Keep real/mock prediction mode separate so mock results cannot be mistaken for real ones. One result per source window is the initial storage policy; deliberate reprocessing needs a later explicit design.

Runtime guards accept untrusted values and return a typed result or typed error. Check identity, manifest consistency, integer indexes/offsets, finite samples, and size limits before allocation. Do not use type assertions to turn arbitrary input into validated input. Do not introduce medical thresholds or physical sensor units here.

Define error stages such as connection, decode, assembly, validation, profile, prediction, and storage. Errors include a stable code, retryability, relevant identity, and safe diagnostic text. Example codes: `INVALID_PACKET`, `INCOMPLETE_WINDOW`, `CONFLICTING_PACKET`, `RESOURCE_LIMIT`, `INVALID_PROFILE`, `PREDICTION_UNAVAILABLE`, and `STORAGE_FAILED`.

Choose test tooling compatible with the installed Expo/TypeScript configuration during implementation. Keep pure service tests independent of native module imports. Add a repeatable `test` script and optionally `typecheck`; avoid adding multiple competing runners. Capture existing lint/typecheck failures before implementation so introduced problems can be distinguished.

### Tests and completion criteria

Reject NaN/infinity, fractional/out-of-range indexes, negative offsets, invalid manifests, and oversized inputs. Confirm differing channel counts/rates are representable, unknown units remain unknown, and identity encoding cannot collide for delimiter-containing IDs. Shared types compile under strict TypeScript; tests run without a simulator.

## 2. Add the device abstraction and deterministic demo source

### Push contents

- `services/device/device-service.ts`
- `services/device/packet-decoder.ts`
- `services/device/demo-device-service.ts`
- `services/device/demo-scenarios.ts`
- `tests/device/demo-device-service.test.ts`

### Detailed design

`DeviceService` exposes asynchronous `connect`, `disconnect`, and `dispose`, plus `getConnectionState` and `subscribe`. Subscription returns an unsubscribe function. Events carry connection state, normalized packets, optional window-end markers, or typed errors. If firmware eventually has no end marker, completeness and configured expiry still work.

Connection state is a discriminated union: disconnected, connecting, connected, disconnecting, error. Include a connection generation for stale callback rejection. Define repeated connect/disconnect calls to be idempotent; disposed instances reject subsequent use.

`PacketDecoder` accepts bytes plus transport context, buffers as needed, returns zero or more normalized packets/errors, and supports reset. Document reset on session changes/disconnect. Supply the interface only: there is no invented binary format or pretend production decoder. The future BLE adapter owns decoder composition.

`DemoDeviceService` emits directly normalized synthetic packets. Prefer manual `step`/`emitScenario` controls for tests, with optional injected scheduling for demonstration. Fixture identity and event order are deterministic; a fresh simulated acquisition gets a new explicit acquisition ID. Fixtures specify demo-only channel counts and metadata. They do not imply actual sample rates, sensor units, or collection intervals.

Scenarios: ordered, reordered, missing packet, identical duplicate, conflicting duplicate, malformed input, and disconnect mid-window. Malformed untyped values exercise the runtime input guard rather than being cast into valid packets. Label all source events as demo.

### Tests and completion criteria

Verify state transitions, subscription cleanup, repeated connect/disconnect, no events after dispose, and controllable event sequences without real sleeps. Disconnect cancels scheduled demo emissions. No native BLE dependency or UI change is introduced.

## 3. Implement bounded window assembly

### Push contents

- `services/measurement/window-assembler.ts`
- `tests/measurement/window-assembler.test.ts`
- Additional assembly fixtures under `tests/fixtures/`.

### Detailed design

Expose `acceptPacket`, optional `endWindow`, `expire`, and `reset`. Return typed outcomes: pending/progress, duplicate, complete, or rejected. Prefer explicit clock injection and expiry calls to hidden global timers.

For each identity, retain its immutable manifest, accepted packets by index, channel coverage, first-arrival deadline, and diagnostics. Require resource-limit and expiry configuration at construction. Demo configuration may choose small values; production values remain contract-dependent.

Process a packet in this order:

1. Validate shape and bounds before creating buffers.
2. Resolve its stable identity and compare its manifest/metadata with existing state.
3. If the index exists, compare semantic acquisition payload, excluding transport receive time. An identical retransmission is a duplicate; conflicting content rejects the window.
4. Validate chunks against channel sample bounds and prior coverage. Reject ambiguous overlap between distinct packets, unexpected channels, and metadata conflicts.
5. Store a defensive copy and update index/coverage state.
6. Emit a complete immutable window only if all indexes and all required sample positions exist. Empty/missing channel data cannot pass simply because packet count matches.

Do not pad missing values, interpolate, reorder channels by guesswork, or perform filtering. Maintain per-channel sample ordering using offsets. Packet reordering is supported; incompatible session data is never mixed.

An end marker with gaps or an expired deadline rejects the window with missing indexes and channel coverage information. A pending gap alone is not yet a terminal failure. Use a first-arrival deadline so repeated packets cannot extend an incomplete window forever.

Bound in-progress windows, packet counts, samples, and recent completed/rejected identities. A conflict leaves a bounded rejection tombstone so later packets do not immediately resurrect that invalid window. Once a tombstone expires, a replay may be reassembled; persistent storage is the final deduplication boundary. Resource exhaustion must emit an explicit error with a documented reject-new or eviction policy; prefer reject-new initially.

### Tests and completion criteria

Verify ordering, interleaved identities, missing packets, missing channel coverage, identical duplicates with changed receipt times, conflicting duplicates/manifests, overlap, invalid bounds, expiry, end markers, resource limits, reset, and completed-window replay suppression within retention. A complete event occurs once during retained assembly state and never for incomplete input.

## 4. Add validation, profile inputs, and mock prediction

### Push contents

- `services/measurement/window-validator.ts`
- `services/measurement/profile-provider.ts`
- `services/prediction/prediction-service.ts`
- `services/prediction/mock-prediction-service.ts`
- Focused validator/profile/prediction tests.

### Detailed design

The window validator accepts a complete window and an explicit input policy. The initial demo policy verifies structure and fixture compatibility and returns validation mode `demo-structural`. It must not assert that a signal is physiologically usable. A real policy is unavailable until supplied and versioned; real predictors reject demo validation.

The profile provider returns a validated immutable feature snapshot. Supply a synthetic provider with explicit units for demo use. Do not read the Profile screen's placeholder defaults as real data. Existing numeric weight has no unit and height is free text; a future persisted-profile adapter must require explicit unit and parsing policies. Do not assume pounds/kilograms, resolve age/DOB conflict silently, or invent mandatory skin-tone use. Verification of user-entered versus placeholder profile data needs an explicit policy/metadata; matching a default value is not reliable evidence.

`PredictionService.predict` accepts the validated window, profile snapshot, and cancellation signal. A returned result is associated with the same source identity. The mock implementation returns a documented fixed fixture or fixture-selected value, with `predictionMode: mock` and a mock implementation version. It does not calculate BP from signals, demographics, or random noise. Its documentation and demo output say “mock — not real BP inference.”

Validate predictor output at the boundary: finite numbers, required unit/version metadata, matching identity, and compatible provenance. Clinical ranges and confidence semantics are deferred to the ML contract. No implicit fallback from a failing real service to mock prediction is allowed.

### Tests and completion criteria

Valid demo input yields deterministic mock output. Missing/ambiguous required profile data is rejected. Inputs cannot mutate during an asynchronous call. Cancellation is honored where supported; coordinator guards will handle non-cooperative adapters. Unknown real validation/model configuration yields a typed unavailable error. No real-inference claim or model formula exists.

## 5. Implement readings storage in an isolated SQLite database

### Push contents

- `services/readings/readings-repository.ts`
- `services/readings/sqlite-readings-repository.ts`
- `services/readings/migrations.ts`
- `tests/readings/` for repository behavior.
- A native SQLite integration procedure/harness outside Router routes.

### Detailed design

Define a storage interface first: initialize, save, get by ID, get by source key, and list. Save returns inserted or already-existing, not an ambiguous success flag. An in-memory test implementation is a coordinator test double, not a persistence implementation.

Open `readings.db` lazily. Serialize initialization with one promise; after failure, support an explicit retry without leaving a permanently rejected cached promise. Apply schema version changes in a transaction, and reject unsupported newer schema versions. Do not open/modify `profile.db` through this repository.

Proposed first table:

| Column group | Design |
| --- | --- |
| Identity | Primary reading ID, unique source-window key, source mode, device/acquisition/window IDs. |
| Values | Systolic and diastolic numeric values, explicit output unit, prediction mode. |
| Times | Nullable synchronized acquisition timestamp, acquisition clock metadata, receive timestamp, prediction timestamp, save timestamp. |
| Provenance | Input contract, validator, profile contract, model/mock implementation and preprocessing versions as applicable. |
| Snapshot | Validated JSON containing only the inference profile features actually used; no contact details or full raw windows. |

Use non-null constraints where the contract requires values and checks for mode enums. App validation handles finite numbers and versioned JSON shape. Parameterize every value-bearing query. Index synchronized acquisition timestamp plus ID for stable cursor pagination; provide an explicit received-time query basis for windows without wall-clock acquisition time. Do not silently mix these time bases.

Use a unique source key and a transaction for idempotent saves. Identical semantic results return the existing row, retaining its original save timestamp/ID. Ignore newly generated storage metadata when deciding equivalence, but compare prediction and input provenance. Different prediction/profile/contract contents for an existing key return a conflict; never use replace/upsert to overwrite measurement history. The coordinator should look up existing keys before prediction, but uniqueness must also handle races.

Normal queries explicitly select real source plus real prediction. Demo/test queries explicitly opt into demo/mock rows. Validate limit/cursor/time-range inputs and stored JSON on reads. This schema intentionally does not support silently replacing a mock reading with a real result for the same window; later reprocessing needs explicit versioned-result semantics.

### Tests and completion criteria

Verify init/migration idempotency, rollback on migration failure, unsupported versions, identical/conflicting saves, concurrent duplicate saves, provenance filters, stable pagination, null acquisition time, and persistence after reopen. On a native runtime, verify `initDatabase`, `saveProfile`, and `getProfile` still round-trip the existing profile unchanged. Use isolated test databases and clean up only test-owned resources. Record the native environment tested; a mocked SQLite API is insufficient evidence.

## 6. Connect services with a measurement coordinator

### Push contents

- `services/measurement/measurement-coordinator.ts`
- `services/measurement/coordinator-events.ts`
- `tests/measurement/measurement-coordinator.test.ts`

### Detailed design

Inject device, assembler, validator, profile provider, predictor, repository, clock, and resource policy. Expose start, stop, dispose, state inspection, event subscription, and explicit retry of retained failed saves. No React imports or global singleton startup.

Keep three distinct state levels:

- Connection: device states from deliverable 2.
- Coordinator: stopped, starting, running, stopping, error.
- Window work: assembling, validating, predicting, saving, saved, rejected, failed.

Start initializes storage, installs listeners before connection, and connects. Guard overlapping start/stop calls with a lifecycle generation and shared operation promises. Roll back all acquired resources on failed startup. A connected event is not evidence that a measurement was saved.

For each completed window, use a bounded FIFO queue and one active processing job initially:

1. Check current run generation/cancellation.
2. Check the source key in storage; report an existing result as replay without predicting again.
3. Validate the window and capture/validate one profile snapshot.
4. Call the configured predictor.
5. Validate prediction output and check generation/cancellation again.
6. Prepare a stable reading and save atomically.
7. Emit saved only after successful commit; retain inserted/existing distinction.

Fail/reject individual windows without stopping healthy unrelated windows. Reject excess queue entries with a resource error rather than silently dropping them. Prediction timeouts are configurable operational limits, not guessed model behavior. Use cancellation plus generation checks because some adapters cannot cancel an already-running request.

On disconnect, clear incomplete assembly, cancel queued/uncommitted processing, and emit explicit outcomes. Remain available for explicit reconnection; do not implement an unlimited reconnect loop. Stop/dispose removes subscriptions, cancels timers, and waits for an already-started database transaction to settle. Such a transaction can still commit; do not promise rollback from cancellation or publish its result into a newer run.

A failed save retains the exact prepared reading in a bounded, run-local retry collection. An explicit retry saves the same object/key without repeating prediction. If stop/restart clears this collection, report that it was discarded; durable retry recovery is deferred. Listener exceptions must not corrupt coordinator state or prevent cleanup.

### Tests and completion criteria

Using injected fakes, verify success, window rejection without inference/storage, replay without re-prediction, startup rollback, concurrent start/stop, repeated cleanup, disconnect during each stage, late async completion, bounded queue/retry collection, prediction failure/timeout, save retry without re-prediction, and commit during stop. Observe no duplicate active subscriptions or saved event before commit.

## 7. Deliver a runnable demo and release evidence

### Push contents

- `services/demo/run-demo-measurement.ts`: explicitly invoked composition entry point.
- `tests/integration/demo-pipeline.test.ts`: service integration with repository double.
- `docs/demo-measurement.md`: exact invocation, native SQLite procedure, expected events/results, and limitations.
- Updated architecture/design status and implementation notes.

### Detailed design

The demo entry point creates the demo device, assembler, demo validator, synthetic profile provider, mock predictor, and injected repository. Expose a native composition path using the real SQLite repository and a pure test path using the in-memory repository. Do not imply that a Node-only run verifies `expo-sqlite`.

Run one explicitly triggered scenario and return a report containing event outcomes and saved reading identities, labeled as synthetic/mock. Provide normal, missing-packet, duplicate, and conflicting-packet examples. No changes to tabs, screens, navigation, Journal persistence, or app startup. Document how to invoke the native harness in a development runtime without committing UI wiring.

### Verification before a future push

1. Run focused service and integration tests using the documented command.
2. Run `npx tsc --noEmit` and `npm run lint` with project dependencies installed.
3. Run the real SQLite native integration checks from deliverable 5, including persistence across reopen and profile compatibility.
4. Review the diff for accidental UI edits, real-data constants, unlabeled mock values, or automatic startup.
5. Record exact commands, results, native runtime tested, and any pre-existing failures separately from introduced failures.

The foundation is ready when a complete synthetic window produces one durably saved mock reading, incomplete/conflicting input produces none, replay does not create duplicates, and the existing profile remains intact. Do not claim this acceptance gate is met until the implementation and checks exist.

## 8. Later integration sequence and external deliverables

These are follow-on change sets, not requirements to invent during the demo foundation. Request the team specifications early, but keep real adapters unavailable until the relevant inputs arrive.

### 8.1 Freeze hardware and ML contracts

Hardware delivers versioned UUIDs and notification/write behavior; packet framing, integrity, fragmentation and byte layout; device/acquisition/window identity and replay rules; window boundaries/manifests; channel mapping, units, calibration, sample rates and timing; reconnect/buffering behavior; and captured byte fixtures with expected decoded output.

ML delivers the artifact/runtime or remote API contract; required profile fields/units; quality rules; accepted channel/window shapes; exact training preprocessing including fitted parameters; output units/semantics; supported model/input versions; and golden raw/preprocessed/prediction fixtures with numeric tolerances. Confirm age/DOB policy and legacy profile unit handling before real profile integration.

Joint deliverable: an agreed compatibility matrix, signal-acceptance ownership, expected failure behavior, and acceptance fixtures. The provisional 30-second/15-minute targets must be explicitly approved or revised.

### 8.2 Implement the actual decoder, then BLE adapter

Push a fixture-tested decoder first, followed by the device adapter and required native configuration. Verify byte fragmentation, corruption, replay, session resets, clock mapping, permissions, and real-device reconnect behavior. Select native dependencies/build requirements only once platform and hardware contracts are known. Do not change the domain assembler merely to embed a wire format.

### 8.3 Implement real preprocessing, profile adaptation, and prediction

Push explicit legacy profile normalization/verification rules, versioned preprocessing, and the real predictor. If the current profile cannot provide verified inputs, return an input-required error until a separately scoped profile migration/UI workflow is designed. Match inference preprocessing to model training exactly: ordering, units, calibration, filtering, resampling, normalization, feature extraction, tensor shape and missing-data policy. Golden parity tests must pass before treating outputs as real predictions. No mock fallback.

### 8.4 Validate the real end-to-end pipeline

Use hardware captures and agreed ML fixtures to verify identity, acquisition time, rejection behavior, version compatibility, and saved provenance through SQLite. Record real-device results and unresolved limitations. UI display, background BLE acquisition, collection scheduling, raw signal retention, and deployment/release are separately scoped work after the service foundation.

## Current status

Steps 0 and 1 are complete. Steps 2–8, their tests, pushes, and functional acceptance
results remain future deliverables. Shared contracts and packet guards now work, but
the repository does not yet have a device source, assembler, predictor, persistence,
or coordinator and does not meet a demo or real-measurement acceptance gate.
