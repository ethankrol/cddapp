# Initial inference, AWS sync, and BLE services

This document describes the first service implementations and how to run their isolated tests. No screen or app startup code invokes them.

## Blood pressure inference

`PredictionService` accepts a `ValidatedSensorWindow`, a unit-explicit `PredictionProfile`, and optional cancellation signal, and returns systolic/diastolic values in mmHg with model provenance. `createArtifactPredictionService` is the integration point for the selected model artifact: provide its version, preprocessing version, and async `predict` implementation. It refuses windows validated only for demo structure, rejects non-finite outputs, and reports cancellation/model failures as service errors.

No model artifact or training preprocessing package has been selected/provided in the repo, so real model inference is not included. When connecting one, its preprocessing must match model training exactly; version it with the artifact and verify parity using ML-provided golden inputs/outputs. Use `createMockPredictionService` for a deterministic fixture only. Its `mock` provenance means its values are not BP estimates.

Test: `npm test -- --test-name-pattern='blood-pressure inference'` (or run the inference test directly with the repository's Node test command). Tests prove fixed expected output, artifact invocation/provenance, and rejection of demo-only validation.

## 24-hour PPG cache and AWS sync

`RollingPpgCache` defines append, list-since, and prune operations; `rolling24HourCutoff(nowMs)` supplies the retention boundary. A local store should retain timestamped PPG windows for the last 24 hours and expose pending entries through `HealthDataCache` so they can be synchronized.

`AwsSyncService` reads bounded pending batches, writes each batch through `HealthDataRemoteStore`, and marks local records synchronized only after remote success. It publishes `idle`/`syncing`/`error`, `pendingCount`, `lastSyncAtMs`, and `lastError` for app state. Connectivity is injected through `isOnline`; failed writes use bounded exponential retry, preserving pending local data if retries fail.

`createDynamoDbRemoteStore` adapts an injected `DynamoDbWriter` and provisioned table name. DynamoDB provisioning, AWS credentials, authorization, and the production transport (for example a protected API/Lambda rather than embedding broad AWS credentials in the app) are external dependencies. No table name, credentials, AWS SDK, or fake cloud write is embedded here.

Test: `npm test -- --test-name-pattern='AWS health sync'`. The isolated tests exercise upload, a transient retry, sync-state updates, and offline failure. Supply a real local cache and provisioned remote writer to integrate the service.

## BLE watch handler

`BleHandlerService` exposes scan, connect, disconnect, a subscribable connection state, completed-window events, and typed errors. `BlePlatformAdapter` is the platform BLE seam; `BlePacketDecoder` converts notification bytes into normalized packet candidates. Candidates pass through the shared bounded packet validator and `SensorPacketReassembler`, which handles reordering, exact retransmission, manifest agreement, sample coverage, overlapping data rejection, and bounded concurrent windows.

The repository has no bracelet UUIDs, byte framing, checksum, encoded sample units/rates, or Expo native BLE adapter. Provide these through a hardware-specific platform adapter and decoder; neither is guessed here. The watch's proposed 15-minute cadence and 30-second segment remain provisional. `SensorPacket` is the normalized app boundary, not a BLE wire format. Forward `getState()` and state events into whichever app-state system is selected.

Test: `npm test -- --test-name-pattern='BLE handler service'`. A mocked platform emits discovery and notification callbacks; the test sends a two-frame window out of order and checks the assembled samples and disconnect transition. Validate the production adapter later on a real watch using captured packet fixtures.

## Run checks

- `npm test` runs the focused service and packet validation tests using Node 22's built-in test runner and TypeScript stripping.
- `npm run typecheck` runs strict TypeScript checks after project dependencies are installed.
- `npm run lint` runs Expo lint after project dependencies are installed.

The native Expo build, actual DynamoDB integration, selected model artifact, and physical BLE test each require their external dependency and are not replaced by these mock tests.
