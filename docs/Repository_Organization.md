# Repository organization and handoff

This is a bounded cleanup for Rithika's working `cddapp` checkout. The assistant inspected the remote `rithika-ML` branch and the previously delivered tool sources, but cannot directly edit the Mac checkout. Run `organize_cdd.py` there to check actual files and apply the guarded changes.

## What stays where

| Location | Why it stays |
|---|---|
| `app/` | App screens and navigation. Screen files can be discovered automatically by Expo Router, so lack of a direct import does not prove they are unused. |
| `components/`, `hooks/`, `constants/` | Shared UI and app logic. |
| `services/` | Inference, preprocessing, calibration calculation and database logic. |
| `assets/` | Images plus the model, normalization and synthetic reference inputs. The phone loads the ONNX here. |
| `modules/` | Local native modules, including the memory-measurement implementation if installed. |
| `ios/` | Working native Xcode project. Preserve native source, project settings, workspace and dependency lockfile. |
| `python code/` | Original checkpoint and training source; reviewed exporter is moved here beside its default checkpoint. Existing checkpoint paths remain valid. |
| `tools/research/` | Reviewed augmentation experiment controller, moved from the root if its fingerprint matches. |
| `tools/setup/` | Reviewed original test installer, moved from the root if its fingerprint matches. Keep for provenance; do not rerun it over newer screens. |
| `scripts/` | Existing project scripts; retained until local references have been inspected. |
| `docs/` | Plain-language guide, complete engineering report, this layout guide and selected synthetic test reports. |
| Root configuration files | Keep `package.json`, `package-lock.json`, `app.json`, `metro.config.js`, TypeScript/ESLint settings and declarations where their tools expect them. |
| `node_modules/` | Keep locally so the app works; ignore in Git. Dependencies can be reconstructed from the lockfile. |

## Changes made by `--apply`

1. Verify the original checkpoint, phone ONNX, normalization, export report and normalized synthetic fixture against known SHA-256 hashes; verify the export metadata pairs them. If any are missing/different, stop before project changes. No Torch model is loaded or executed.
2. Move the three reviewed helper scripts into the paths above only when their byte hashes match and no executable/config references to their old names are found. Modified or referenced scripts stay in place and are listed for review.
3. Move `iphone-test-backups/` and root `metro.config.js.backup-<timestamp>` items to a timestamped sibling folder outside the repository. This removes clutter from the repo while preserving recoverable copies. It does not permanently erase them.
4. Append ignore rules for local/generated files, and make the customized iOS source eligible for Git. `ios/Pods/`, build directories, personal Xcode state, local Node paths and signing credentials remain ignored. Existing ignore content is retained.
5. Add documentation and synthetic report copies. Existing different documentation files are preserved and listed for review.
6. Append a documentation index to the existing README.
7. Recheck the model bundle and ensure the tool did not change the Git index. Record changes, preserved items and a local file inventory in a JSON report outside the repository.

The backup includes a manifest of moved paths and original copies of amended files. Failed operations attempt rollback without overwriting concurrent user changes; empty organizational directories may remain. No package install, Xcode build, source transformation, model replacement, Git staging, commit or push runs automatically.

## Why iOS source is included

The inspected remote `.gitignore` ignores all of `/ios`, but the working app has native customization. For this cleanup we choose to preserve the current native project in Git and ignore its generated dependencies/output. An alternative future approach is to encode every native customization in config plugins, verify regeneration, and return to an entirely generated native project. That migration is not part of this cleanup.

The script adds root ignore rules, but a nested `.gitignore` or your global Git ignore file can still exclude a specific path. Check the final diff and native file list before committing. Do not use `git add -f ios` on the whole directory; that can include Pods and personal files.

## Model identity and versioning

The original model used in the successful phone tests is kept intact. New CNN/Tnet comparison checkpoints on HiPerGator are separate research artifacts. Do not copy one over the original filename: its training recipe, timing mask and target scaling can require a new export wrapper and matching metadata.

The checker compares on-disk Mac bytes with the known original package. It does not inspect or update a previously installed app. A future model update needs a deliberately versioned bundle, numerical checks, rebuild and physical-phone test.

## Finish the handoff

Run the tool from the downloaded package with Python 3; no extra Python packages are required:

```bash
python3 ~/Downloads/cdd-repo-cleanup/organize_cdd.py \
  --project /Users/rithika/Desktop/cddapp

python3 ~/Downloads/cdd-repo-cleanup/organize_cdd.py \
  --project /Users/rithika/Desktop/cddapp --apply
```

Then inspect the result locally:

```bash
cd /Users/rithika/Desktop/cddapp
git status --short
git diff --stat
git diff -- .gitignore README.md
git ls-files --others --exclude-standard -- ios modules assets services app docs tools
```

Upload the **apply report JSON** if anything needs review or to finish checking local-only source before selecting exact files for a commit. The report includes paths, file sizes, Git status and model hashes; it does not include file contents, credentials, raw participant waveforms or model bytes. Review filenames before sharing if they themselves are sensitive.

This pass does not prove arbitrary components, icons, routes or dependencies are unused. Those need the current local source, because the remote branch lacks the later mobile work. It also does not remove already tracked dependencies or local secrets from Git's index/history. Any such tracked paths are reported for a separate targeted fix.

Once the files selected for handoff have been reviewed, commit the relevant app code, native source, model bundle, documentation and lockfiles together. Do not blindly stage every local file. The remote branch was inspected at `2852dd82dff3afb5649a4be53802836f5b578606` on September 25, 2026; this is a point-in-time observation, not a guarantee it remains unchanged.

Reference: [Expo native-project guidance](https://docs.expo.dev/workflow/continuous-native-generation/).
