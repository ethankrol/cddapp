# Service scaffold

Only `database.ts` currently implements an application service (existing profile storage).
The device, prediction, readings, coordinator, and demo modules are placeholders.
Shared measurement types, errors, clocks, and normalized-packet validation are implemented.
Importing them does not connect a device, open a database, run a migration, start a timer,
generate a prediction, or start the pipeline. Calling a placeholder throws
`ServiceNotImplementedError`; there are no silent successes or fabricated readings.

The remaining temporary exported names and `never` return types mark unimplemented entry points,
not final interfaces. Replace them with the typed contracts and implementations in
[the ordered implementation plan](../docs/service-foundations-implementation-plan.md).
The domain types file now defines the deliverable 1 contracts.

| Folder | Responsibility |
| --- | --- |
| `device/` | BLE service interface, packet decoder boundary, validation/reassembly and demo placeholders. |
| `measurement/` | Input checks, clocks, future end-to-end coordinator and validation placeholders. |
| `prediction/` | Artifact-backed inference adapter and explicitly labeled fixed-output mock. |
| `sync/` | Local rolling PPG retention contracts, sync state/retry flow and DynamoDB writer adapter. |
| `readings/` | Future local reading repository and migration placeholders. |
| `demo/` | Explicitly invoked future full-pipeline composition. |

No new module is wired to the UI. Do not add production BLE constants, quality rules,
preprocessing, or a real predictor until the hardware/ML contracts are available.

See [initial-services-integration.md](../docs/initial-services-integration.md) for
the interfaces, setup points, boundaries, and test commands for the inference, AWS
sync, and BLE services.

## Validation

After dependencies were installed, `npm test` passed all 18 packet, inference, AWS
sync, and BLE service tests. `npm run typecheck` and `npm run lint` also passed.
An earlier dependency installation attempt failed with `ENOSPC`; this was resolved
after disk space was freed. These are the current validation results.
