# Sensor-to-reading service foundations

Date: 2026-09-23
Status: Inactive service scaffold and deliverable 1 shared contracts/validation implemented. Device integration and later services remain planned.

For the detailed ordered change sets, proposed files, and acceptance gates, see [Ordered implementation deliverables](service-foundations-implementation-plan.md).

## Scope and current state

The intended future pipeline is bracelet → phone → reconstructed and validated sensor window → prediction → locally saved reading. This document proposes service foundations without changing screens, navigation, or existing Journal behavior. Inactive placeholder modules now reserve the service structure; their entry points throw an explicit unimplemented error. No dependencies, BLE integration, inference, or database migrations have been added. See [the scaffold guide](../services/README.md).

Repository inspection confirms Expo ~54.0.33, React Native 0.81.5, React 19.1.0, Expo Router ~6.0.23, TypeScript ~5.9.2 with strict mode, and expo-sqlite ~16.0.10. Home and Analytics have headers only. Journal entries live in component state. `services/database.ts` opens `profile.db`, creates a `profile` table, and reads/writes the single profile at ID 1. Preserve its exports and behavior.

The existing profile stores numeric age and weight, free-text height and DOB, and skin tone. Weight units are absent; age and DOB can disagree. The Profile screen supplies placeholder defaults. These values must not silently become validated model inputs.

Approximately 30-second windows every 15 minutes are provisional product targets, not protocol constants, sample-count requirements, or a background scheduling guarantee.

## Architecture and boundaries

Proposed flow:

1. A device adapter exposes connection events and normalized sensor packets.
2. A standalone decoder translates eventual BLE bytes into the normalized packet contract.
3. A window assembler checks structural completeness and detects packet problems.
4. A validator applies an explicitly selected input contract and quality policy.
5. A profile provider supplies a validated, immutable snapshot of required model fields.
6. A prediction adapter produces an explicitly identified mock or real prediction.
7. A readings repository atomically persists the prediction and provenance.

A measurement coordinator owns subscriptions, processing, cancellation, and errors. Dependencies are injected so tests do not need React, BLE, or a native database. Nothing starts at module import or from an existing screen. A future service-level demo harness explicitly starts the pipeline.

Transport completeness and physiological usability are different guarantees. A structurally complete window is not automatically suitable for real inference. Missing real quality/preprocessing/model contracts must block a real prediction adapter, rather than select mock behavior implicitly.

## Proposed shared contracts

These are application-level concepts, not a proposed bracelet wire format. Final TypeScript definitions should use discriminated unions and readonly data. Validate external input at runtime; TypeScript types alone are insufficient.

| Contract | Required meaning |
| --- | --- |
| SensorPacket | Source mode, device identity, source acquisition/session identity, window identity, normalized packet index, expected packet count or explicit completeness manifest, contract version, channel chunks, receive timestamp, and available acquisition timing metadata. |
| ChannelChunk | Channel identifier, sample offset/coverage, numeric samples, and explicit unit/timing metadata when known. PPG, pressure, and temperature need not share rates, counts, or packet boundaries. |
| CompleteSensorWindow | Stable source/window identity, ordered channel data, satisfied manifest, acquisition timing and its origin, source provenance, and transport diagnostics. |
| ValidatedSensorWindow | Complete window plus the validator/input-contract version and a validation result. Only the validation boundary constructs this type. Demo structural validation is explicitly marked as such. |
| PredictionProfile | Only model-required fields, with explicit units, validation provenance, and the snapshot used for this request. Age, height, and weight are anticipated fields; the ML contract determines the final required set. |
| BPPrediction | Systolic and diastolic values, explicit output unit, generation time, source-window reference, prediction mode, and model/preprocessing versions or an explicit mock identifier. Confidence is absent unless the model defines it. |
| SavedReading | Stable reading/idempotency identity, prediction fields, acquisition and save times, device/session/window identity, input-contract/validator versions, and the minimal profile snapshot used. Device source and prediction mode are separate fields. |
| ServiceError | Stage, stable code, relevant session/window identity, retryability, and a diagnostic message/cause without raw sensor or profile dumps. |

The normalized demo contract may choose packet indexes and a finite sample manifest for fixtures. Those choices must be labeled demo-only and must not be claimed as hardware specifications. Unknown sensor units remain explicitly unknown; they are never guessed. A real adapter must resolve metadata required by its input contract before validation passes.

Keep acquisition timestamps separate from phone receive, prediction, and save timestamps. Do not invent wall-clock acquisition time when firmware provides only device ticks; retain clock origin and synchronization status.

## Device and decoding services

`DeviceService` should provide connection-state inspection/subscription, packet/error subscriptions with unsubscribe functions, asynchronous connect/disconnect, and disposal. Connection states: disconnected, connecting, connected, disconnecting, and error. Include a connection generation for rejecting stale callbacks; keep this separate from stable source acquisition identity used for replay deduplication.

`DemoDeviceService` emits deterministic, synthetic PPG/pressure/temperature fixtures with source `demo`, using an injected clock or explicit manual stepping. Provide normal, reordered, omitted, repeated, conflicting, malformed, and disconnected scenarios. No BLE package, permissions, UUIDs, or real-time collection schedule is required for this foundation.

`PacketDecoder` is a separate byte-to-normalized-packet boundary, capable of buffering fragmented input and producing zero or more packets. Actual byte framing, checksums, signedness, endianness, scaling, and version negotiation remain unimplemented. Demo packets bypass byte decoding. Later, a BLE adapter can compose the real decoder without modifying the assembler.

## Assembly and validation behavior

- Key in-progress windows by source mode, device, acquisition/session, and window identity. Never combine different sessions or manifests.
- Accept out-of-order packets and maintain both packet-index coverage and per-channel sample coverage.
- Report missing indexes as pending gaps while packets may still arrive. An explicit end signal, configurable deadline, or disposal makes remaining gaps an incomplete-window outcome. Do not infer completeness merely from elapsed time or the number of received messages.
- Identical duplicate packets produce a diagnostic and no extra samples. A repeated index with different content invalidates the window. Reject inconsistent metadata, invalid indexes/counts, invalid numeric values, and ambiguous overlapping sample coverage.
- Emit exactly once only after every required packet and every channel coverage requirement is satisfied. Packet completeness alone cannot establish complete sensor data.
- Make timeouts, maximum packet/sample counts, concurrent windows, and queue limits explicit configuration. Enforce bounds before allocation. Eviction reports an error rather than silently dropping data.
- Clear incomplete windows on disconnect/stop. Maintain bounded completion tracking during a run; persistent reading uniqueness handles completed-window replay after restart.

Hardware must provide a way to establish window boundaries and required coverage. If this cannot be derived from an authoritative manifest or negotiated contract, do not emit a complete window. Quality thresholds, filtering, resampling, calibration, and signal acceptance rules remain separate from structural assembly and unspecified for real data.

## Prediction and profile handling

`PredictionService` accepts a validated window, a validated profile snapshot, and cancellation context, and returns a prediction or typed error. The initial `MockPredictionService` returns deterministic fixture values; it does not estimate BP from physiology and must be described as “mock — not real BP inference.” Its output always carries mock provenance, even if called with recorded or real sensor data. Do not fabricate a formula relating synthetic signals or profile values to BP.

Use a profile-provider boundary so demo tests supply explicitly synthetic, unit-labeled profile data. A future adapter may read the existing profile service after initialization, but cannot assume the current weight unit or silently parse arbitrary height strings. Missing, ambiguous, placeholder, or conflicting required values yield a profile error. Resolve age-versus-DOB precedence and unit conversion with the ML/product contract before real use. Do not change the existing profile schema or screen as part of these foundations.

Real prediction remains unavailable until a model and its full input/output contract are supplied. Whether inference runs on-device or remotely is undecided. Preprocessing must match model training exactly, including channel order, units, calibration, filtering, resampling, normalization parameters, feature extraction, tensor layout, and missing-data handling. Version the preprocessing with the model and verify parity using team-supplied golden examples.

## Coordinator lifecycle and failures

Expose connection state independently of coordinator state. Proposed coordinator states: stopped, starting, running, stopping, and error; per-window stages: assembling, validating, predicting, saving, saved, rejected, and failed. A connection may remain connected while a window fails.

Start initializes readings storage, installs listeners, then connects. Startup failure rolls back listeners and connection resources. Serialize completed-window processing initially with a bounded queue. Snapshot required profile fields once per measurement and retain that snapshot through prediction/storage. A saved event occurs only after the database commit succeeds.

Stop/dispose unsubscribes, cancels pending work where supported, clears assembly/queued work, and invalidates old async results using a run generation. Disconnect rejects incomplete windows and cancels work not yet committed. An already-started database transaction may finish; await it before stop resolves and never claim that its commit was undone. Suppress callbacks into a newer run.

Window-local decode, assembly, validation, and prediction failures report typed events without fabricating a reading. Fatal initialization/connection failures affect service state. Storage failure preserves the prepared reading for an explicit bounded retry during the run; retry storage without rerunning prediction. Persistent retry/outbox recovery is deferred. Do not automatically loop failed requests indefinitely.

Use a stable source-window key for database uniqueness. If hardware window IDs reset, firmware boot/acquisition identity must disambiguate them; a newly generated phone connection ID alone cannot deduplicate replay across reconnections. One saved reading per source window is the initial policy; deliberate model reprocessing/versioned results are a separate future feature.

## Local persistence

Propose a separate `readings.db` owned by a new readings repository. This avoids changing `profile.db`, its table, current initializer, or existing imports. Use an idempotent initialization promise, versioned transactional schema migration, and parameterized queries. Do not share migration version counters across the two databases.

The initial readings table stores the saved-reading contract: primary reading ID; unique source-window key; systolic/diastolic values and unit; source and prediction modes; timing and clock provenance; device/session/window references; model/mock, preprocessing, and validation versions; and minimal inference profile snapshot. Index acquisition time where meaningful, with a stable ID tie-breaker. Validate serialized metadata on reads.

Repository operations: initialize, save idempotently, get by ID/source key, and list by time range with bounded pagination and explicit provenance filters. Ordinary real-reading queries exclude demo sources and mock predictions; a demo harness opts in. Repeated identical saves return the existing row; conflicting contents for the same key report an error rather than overwrite history. Do not persist full raw windows in this first phase or copy contact details into readings.

Test both new and existing databases. Verify that profile round-tripping is unchanged. Actual native SQLite behavior must be checked on a supported Expo native runtime; an in-memory repository fake alone does not verify persistence, migration, or platform support.

## Required team deliverables

| Owner | Required before real integration |
| --- | --- |
| Hardware/firmware | BLE service/characteristic UUIDs, discovery/identity rules, read/write/notify semantics, pairing/security and platform requirements, transport framing/fragmentation/MTU behavior, byte layout/types/endianness, checksum/integrity rules, protocol versions, example captures and decoder expectations. |
| Hardware/firmware | Window boundaries/manifests, packet ordering/counts and retransmission/end behavior, stable boot/session/window IDs and replay semantics, device clock/timestamp units and synchronization, disconnect buffering/reconnection behavior, approved collection duration/cadence. |
| Hardware/firmware | PPG channels/wavelengths and ordering, pressure/temperature representations, sensor units and scaling, sample rates and per-channel counts, synchronization/offsets, calibration, saturation/missing-value indicators, quality metadata and device limits. |
| ML | Required profile fields, explicit units, accepted ranges/missing-value policy, age/DOB policy, required channels/window lengths/rates, acceptance/rejection rules, and calibration requirements. |
| ML | Model artifact/version and runtime or service contract, exact training preprocessing and fitted parameters, tensor/feature shape/order/dtype, output semantics/units, uncertainty semantics if any, failures, golden input/preprocessed/output fixtures and numeric tolerances. |
| Joint | Version compatibility, clock/identity mapping, quality-policy ownership, real-device end-to-end fixtures, and acceptance criteria for releasing real predictions. For remote inference: endpoint/authentication, payload/version contract, timeout/cancellation/retry semantics, and data handling requirements. |

## Implementation plan after authorization

0. Create inactive placeholder modules for the service structure — completed. No UI wiring or import-time operations.
1. Add shared domain contracts, typed errors, runtime normalized-packet validation, timing abstraction, synthetic fixtures, and focused tests — completed. The profile-provider implementation remains correctly scheduled with prediction in step 4.
2. Add device interface and deterministic demo adapter, with controlled packet scenarios and independent decoder interface. Leave real BLE decoding unavailable.
3. Implement pure assembly and validation with injected clock/configuration and bounded state. Test completeness independently from quality validation.
4. Add prediction interface and explicitly labeled deterministic mock, plus profile validation. Leave real model adapter unavailable.
5. Add isolated readings SQLite repository and migrations. Verify duplicate handling, rollback, reopening persistence, and profile compatibility.
6. Add coordinator and a service-level demo harness with dependency injection, lifecycle handling, event/error reporting, and storage retry behavior. Do not wire into screens or auto-start from app layout.
7. Run focused tests, TypeScript (`npx tsc --noEmit`), and lint (`npm run lint`); fix introduced issues and separately report pre-existing ones. Confirm the diff contains no UI changes. Update this document with actual behavior and remaining dependencies.

Suggested future locations: `types/measurement.ts`; `services/device/`; `services/measurement/` for assembly, validation, coordinator, and profile boundary; `services/prediction/`; `services/readings/`; and focused tests outside Router's `app/` directory. Final filenames and test tooling can be selected during implementation. The repo currently has no test script or configured test runner, and this checkout has no installed `node_modules`.

## Focused verification and acceptance

- Assembly: ordered/reordered complete windows; missing packets and timeout; identical/conflicting duplicates; conflicting manifests; absent required channels; invalid values/indexes/counts; overlapping coverage; interleaved sessions; replay and bounded-resource eviction.
- Prediction/profile: deterministic mock labeling; no invented confidence; ambiguous units and missing fields rejected; snapshot stability; real mode blocked without its required contracts.
- Coordinator: successful demo input produces one mock reading; rejected windows never predict/save; disconnect/restart and late prediction results; repeated start/stop cleanup; queue overflow; prediction errors; storage failure/retry; transaction completion during stop.
- SQLite: initialization/migration idempotency and rollback, uniqueness and conflicting saves, timestamp ordering/pagination, provenance filtering, reopen persistence, and unchanged existing profile data.
- Future real adapters: firmware byte fixtures, fragment reassembly and corruption checks; training-preprocessing golden parity; model output fixtures; actual device reconnect/replay tests.

After future implementation, demo data should exercise transport-independent assembly → structural demo validation → mock prediction → SQLite persistence without hardware or a model. It will not demonstrate physiological validity, real BLE reception, trained inference, background acquisition, or a finalized 30-second/15-minute schedule.

The requested initial inference, AWS sync, and BLE service foundations have since been
implemented and committed in `90aa96b`. All 18 focused tests pass, and TypeScript and
lint checks pass with dependencies installed. These checks do not verify a real model,
provisioned AWS resources, a persistent local PPG cache, or a physical watch adapter.
