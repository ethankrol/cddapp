# Expanded iPhone test evidence

Read [Expanded_iPhone_Test_Results.md](Expanded_iPhone_Test_Results.md) first.

`reports/` preserves four supplied attachment byte streams and a transcription of the inline idle report. `evidence_manifest.json` identifies their origin and hashes. `analysis_summary.json` contains calculations, and `local_source_comparison.json` compares reported source identifiers to the previously prepared implementation.

Reproduce the arithmetic review with `python3 audit_expanded_reports.py`. It requires only the Python standard library. It does not run a model, access the phone or request a GPU.

No BP accuracy, energy or long-run memory result is inferred from these reports.
