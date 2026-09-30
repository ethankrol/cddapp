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

## Scaffold validation

`npm test` passes the 12 deliverable 1 tests using Node 22's built-in test runner.
An attempt to install the locked dependencies for lint/typechecking failed because the
disk had insufficient free space (`ENOSPC`); the incomplete `node_modules` was removed.
`npm run lint` and `npm run typecheck` are therefore not claimed as passing. Install
locked dependencies after freeing disk space, then run both checks.
