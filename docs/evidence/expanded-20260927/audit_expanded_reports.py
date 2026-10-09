#!/usr/bin/env python3
"""Recompute consistency/statistics of supplied reports; never run inference."""
import hashlib
import json
import math
from pathlib import Path
import statistics

ROOT = Path(__file__).resolve().parent
MODEL = 'a8e26e25b852344814e4a474e73e92b9f8d40845c20948fdcce828c9e4f12fce'
REFERENCE = '88e4ad195fe39cfdaebfa8f7c2cb7b76d0d29b9fd3fa63f61c7d3eae81d0117e'


def check(ok, message):
    if not ok:
        raise ValueError(message)


def close(a, b, tolerance=1e-10):
    return abs(a - b) <= tolerance


def summarize(path):
    d = json.loads(path.read_text())
    w = d['windows']
    check(d['schemaVersion'] == 1 and d['test'] == 'cdd_expanded_ppg' and d['synthetic'], 'Report identity')
    check(d['complete'] and d['passed'] and not d['cancelled'], 'Incomplete/failed report')
    check(d['failure'] is None and d['cleanupFailure'] is None, 'Reported failure')
    check(d['modelSha256'] == MODEL and d['provenance']['referenceSha256'] == REFERENCE, 'Unexpected reported package')
    check(d['platform'] == 'ios' and not d['developmentBuild'], 'Unexpected platform/build')
    check(d['parityFailures'] == 0, 'Reported parity failure')
    mode = d['mode']
    if mode == 'full':
        starts = list(range(0, 3750, 625))
    elif mode == 'idle':
        starts = []
    else:
        step = 3750 if mode == 'blocks' else 625
        check(mode in ('blocks', 'rolling'), 'Unknown mode')
        starts = list(range(0, (d['durationSeconds'] - 30) * 125 + 1, step))
    check([row['startSample'] for row in w] == starts, 'Window schedule mismatch')
    count = sum(row['candidates'] for row in w)
    check(d['attempted'] == d['successful'] == count, 'Call totals mismatch')
    check((mode == 'idle' and d['inferencePassed'] is None and not d['sessionReleased']) or
          (mode != 'idle' and d['inferencePassed'] and d['sessionReleased']), 'Inference/cleanup status')
    if mode != 'full':
        check(d['maxBufferSamples'] == 3750 and d['deadlineMisses'] == 0 and d['maxArrivalLagMs'] <= 1000, 'Replay pacing')
    for row in w:
        n = row['candidates']
        check(n == (31 if (row['startSample'] // 625) % 2 == 0 else 32), 'Candidate count mismatch')
        check(row['channelValuesChecked'] == n * 750 and row['timingValuesChecked'] == n * 2, 'Feature counts')
        check(all(row[k] == 0 for k in ('maxRawDifference', 'maxTimingDifference', 'maxNormalizedDifference')), 'Nonzero reported feature difference')
        check(all(0 <= x <= .01 for x in row['maxOutputDifferenceMmhg']), 'Output tolerance')
        if mode == 'full':
            check(len(row['outputs']) == len(row['expectedOutputs']) == len(row['intervals']) == n, 'Full output count')
            for j in range(2):
                actual = [x[j] for x in row['outputs']]
                expected = [x[j] for x in row['expectedOutputs']]
                check(all(math.isfinite(x) for x in actual + expected), 'Nonfinite outputs')
                check(close(max(abs(a-b) for a,b in zip(actual, expected)), row['maxOutputDifferenceMmhg'][j]), 'Reported max mismatch')
                check(close(statistics.mean(actual), row['mean'][j]), 'Mean mismatch')
                check(close(statistics.median(actual), row['median'][j]), 'Median mismatch')
    times = [row['totalWindowMs'] for row in w]
    overlaps = [row['overlapWithPrevious'] for row in w if row.get('overlapWithPrevious') and row['overlapWithPrevious']['matchedExactIntervals']]
    return {'report': str(path.relative_to(ROOT)), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'mode': mode, 'duration_seconds': d.get('durationSeconds'), 'started_at': d['startedAt'],
        'windows': len(w), 'successful_calls': count, 'consistency_checks_passed': True,
        'total_wall_ms': d['totalWallMs'], 'maximum_arrival_lag_ms': d['maxArrivalLagMs'],
        'deadline_misses': d['deadlineMisses'], 'session_released': d['sessionReleased'],
        'window_ms': {'min': min(times), 'mean': statistics.mean(times), 'median': statistics.median(times),
            'p95_nearest_rank': sorted(times)[math.ceil(.95*len(times))-1], 'max': max(times)} if times else None,
        'mean_inference_call_ms_weighted_by_candidates': sum(row['inferenceMeanMs'] * row['candidates'] for row in w) / count if count else None,
        'maximum_output_difference_mmhg': [max(row['maxOutputDifferenceMmhg'][j] for row in w) for j in range(2)] if w else None,
        'channel_values_checked': sum(row['channelValuesChecked'] for row in w),
        'timing_values_checked': sum(row['timingValuesChecked'] for row in w),
        'overlap_pair_comparisons': len(overlaps), 'matched_interval_comparisons': sum(row['matchedExactIntervals'] for row in overlaps),
        'maximum_overlap_output_difference_mmhg': [max(row['maxOutputDifferenceMmhg'][j] for row in overlaps) for j in range(2)] if overlaps else None}


def main():
    manifest = json.loads((ROOT / 'evidence_manifest.json').read_text())
    results = []
    for item in manifest['reports']:
        path = ROOT / item['report']
        check(hashlib.sha256(path.read_bytes()).hexdigest() == item['sha256'], 'Report bytes changed')
        results.append(summarize(path))
    check(len(results) == 5, 'Expected four inference reports and one idle control')
    full = json.loads((ROOT / 'reports/full_189_calls.json').read_text())
    phases = {row['startSample']: row for row in full['windows']}
    # Full-mode overlap is recomputed from its stored arrays. Replay reports
    # omit those arrays: check their summary pattern against the full phases,
    # without claiming to reconstruct unreported replay output values.
    for item in manifest['reports']:
        d = json.loads((ROOT / item['report']).read_text())
        previous = None
        for row in d['windows']:
            current_phase = phases[row['startSample'] % 3750]
            overlap = row['overlapWithPrevious']
            if previous is None:
                check(overlap is None, 'Unexpected first-window overlap')
            else:
                prev_phase = phases[previous['startSample'] % 3750]
                old = {tuple(k + previous['startSample'] for k in interval): output
                       for interval, output in zip(prev_phase['intervals'], prev_phase['outputs'])}
                differences = []
                for interval, output in zip(current_phase['intervals'], current_phase['outputs']):
                    key = tuple(k + row['startSample'] for k in interval)
                    if key in old:
                        differences.append([abs(old[key][j] - output[j]) for j in range(2)])
                check(overlap['matchedExactIntervals'] == len(differences), 'Overlap count mismatch')
                if differences:
                    check(all(close(max(v[j] for v in differences), overlap['maxOutputDifferenceMmhg'][j]) for j in range(2)), 'Overlap summary pattern mismatch')
                else:
                    check(overlap['maxOutputDifferenceMmhg'] is None, 'Expected null overlap difference')
            previous = row
    report = {'scope': 'Independent consistency/statistics checks on user-supplied reports, not independent model or device execution.',
        'all_consistent': True, 'total_inference_calls': sum(x['successful_calls'] for x in results),
        'total_windows': sum(x['windows'] for x in results), 'runs': results,
        'original_python_reference_bytes_available': False,
        'full_report_overlaps_recomputed': True,
        'replay_overlap_summaries_match_full_phase_pattern': True,
        'unreported_replay_output_arrays_independently_recomputed': False,
        'report_source_hashes_are_runtime_attestation': False,
        'memory_or_energy_inferred_from_timing': False}
    check(report['total_inference_calls'] == 3471 and report['total_windows'] == 111, 'Unexpected overall total')
    print(json.dumps(report, indent=2, allow_nan=False))


if __name__ == '__main__':
    main()
