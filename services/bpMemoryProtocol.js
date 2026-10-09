'use strict';

const CYCLES = 5, BASELINE_MS = 2000, SETTLE_MS = 10000;
let running = false;
function requireThat(ok, message) { if (!ok) throw new Error(message); }
function median(values) {
  requireThat(values.length > 0, 'No memory samples in this phase.');
  const sorted = [...values].sort((a, b) => a - b), n = sorted.length;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}
function validatePoint(p) {
  requireThat(p && Number.isFinite(p.elapsedMs) && p.elapsedMs >= 0 &&
    Number.isSafeInteger(p.footprintBytes) && p.footprintBytes > 0 &&
    Number.isSafeInteger(p.residentBytes) && p.residentBytes >= 0 &&
    typeof p.phase === 'string', 'Invalid native memory sample.');
}
function summarizeTrace(trace, cycles) {
  requireThat(trace?.metric === 'task_vm_info.phys_footprint' && trace.units === 'bytes' &&
    trace.sampleIntervalMs === 50 && Array.isArray(trace.samples), 'Unexpected native memory contract.');
  let previous = -1;
  for (const p of trace.samples) { validatePoint(p); requireThat(p.elapsedMs >= previous, 'Nonmonotonic memory samples.'); previous = p.elapsedMs; }
  requireThat(trace.samples.length > 0, 'Empty memory trace.');
  const tail = phase => {
    const points = trace.samples.filter(p => p.phase === phase);
    requireThat(points.length > 0, 'Missing phase: ' + phase);
    const last = points[points.length - 1].elapsedMs;
    const selected = points.filter(p => p.elapsedMs >= last - 1000);
    return { bytes: median(selected.map(p => p.footprintBytes)), sampleCount: selected.length,
      coveredMs: selected[selected.length - 1].elapsedMs - selected[0].elapsedMs };
  };
  const baseline = tail('baseline');
  const rows = cycles.map(cycle => {
    const points = trace.samples.filter(p => p.phase === `cycle_${cycle.cycle}_run` || p.phase === `cycle_${cycle.cycle}_settle`);
    const settled = cycle.waitCompleted ? tail(`cycle_${cycle.cycle}_settle`) : null;
    return { cycle: cycle.cycle, beforeBytes: cycle.before?.footprintBytes ?? null,
      observedPeakBytes: points.length ? Math.max(...points.map(p => p.footprintBytes)) : null,
      afterReleaseBytes: cycle.afterRelease?.footprintBytes ?? null,
      settledMedianBytes: settled?.bytes ?? null, settledWindowSampleCount: settled?.sampleCount ?? 0,
      settledWindowCoveredMs: settled?.coveredMs ?? 0, actualWaitMs: cycle.actualWaitMs ?? null,
      deltaFromBaselineBytes: settled ? settled.bytes - baseline.bytes : null,
      inferencePassed: cycle.profile?.passed === true };
  });
  const completeRows = rows.filter(r => r.settledMedianBytes !== null);
  return { baselineMedianBytes: baseline.bytes, baselineWindowSampleCount: baseline.sampleCount,
    baselineWindowCoveredMs: baseline.coveredMs,
    observedPeakBytes: Math.max(...trace.samples.map(p => p.footprintBytes)),
    maxSampleGapMs: trace.samples.reduce((value,p,i,a) => i ? Math.max(value,p.elapsedMs-a[i-1].elapsedMs) : value,0),
    cycles: rows,
    finalSettledMinusFirstSettledBytes: completeRows.length >= 2 ?
      completeRows[completeRows.length-1].settledMedianBytes - completeRows[0].settledMedianBytes : null,
    leakAssessment: 'not_determined',
    interpretation: 'Whole-app physical footprint, including recorder and retained reports. Peaks are sampled, not exact. Reusable memory and sample-buffer growth can contribute to retained values.' };
}

async function runMemoryProtocol(deps, options) {
  requireThat(!running, 'An automatic memory test is already running.');
  const { sampler, runProfile } = deps;
  const now = deps.now || (() => performance.now());
  const sleep = deps.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const shouldStop = options.shouldStop || (() => false);
  const progress = options.onProgress || (() => {});
  running = true;
  const started = now(); let samplerStarted = false;
  const result = { schemaVersion: 1, test: 'cdd_five_cycle_memory', synthetic: true,
    startedAt: new Date().toISOString(), finishedAt: '', ...options.metadata,
    protocol: { cycles: CYCLES, baselineMs: BASELINE_MS, settleMs: SETTLE_MS, sampleIntervalMs: 50,
      firstCallsPerCycle: 1, warmupCallsPerCycle: 10, measuredCallsPerCycle: 100 },
    complete: false, inferencePassed: false, memorySamplingComplete: false,
    cancelled: false, failure: null, native: null, cycles: [], trace: null, summary: null,
    sampledPeakOnly: true, energyMeasured: false, appColdLaunchMeasured: false,
    timingComparableToUninstrumentedRuns: false, totalWallMs: 0 };
  const cancelled = new Error('Cancelled');
  const check = () => { if (shouldStop()) throw cancelled; };
  async function wait(ms) {
    const begin = now(); let last = begin;
    while (now() - begin < ms) {
      check();
      const current = now();
      requireThat(current >= last, 'Nonmonotonic JavaScript clock.'); last = current;
      await sleep(Math.min(100, Math.max(1, ms - (current - begin))));
    }
    check(); return now() - begin;
  }
  try {
    check();
    result.native = await sampler.start(); samplerStarted = true;
    requireThat(result.native.isSimulator === false && result.native.intervalMs === 50, 'Physical-iPhone sampler contract failed.');
    progress('Recording the two-second baseline…');
    await wait(BASELINE_MS);
    for (let cycle = 1; cycle <= CYCLES; cycle++) {
      check();
      const row = { cycle, before: await sampler.mark(`cycle_${cycle}_run`), profile: null,
        afterRelease: null, settled: null, actualWaitMs: null, waitCompleted: false };
      result.cycles.push(row);
      progress(`Cycle ${cycle}/5: running the synthetic benchmark…`);
      row.profile = await runProfile({ shouldStop, onProgress: () => {} });
      if (row.profile.cancelled || shouldStop()) throw cancelled;
      requireThat(row.profile.complete && row.profile.passed && row.profile.successful === 111 &&
        row.profile.attempted === 111 && row.profile.parityFailures === 0 && row.profile.runtimeFailures === 0,
        row.profile.failure || 'Synthetic inference did not pass all 111 calls.');
      row.afterRelease = await sampler.mark(`cycle_${cycle}_settle`);
      progress(`Cycle ${cycle}/5: waiting ten seconds after release…`);
      row.actualWaitMs = await wait(SETTLE_MS); row.waitCompleted = true;
      row.settled = await sampler.mark(`cycle_${cycle}_settled`);
    }
    result.complete = true; result.inferencePassed = true;
  } catch (error) {
    result.cancelled = error === cancelled;
    if (!result.cancelled) result.failure = error instanceof Error ? error.message : String(error);
  } finally {
    if (samplerStarted) {
      try {
        result.trace = await sampler.stop(result.cancelled ? 'cancelled' : result.complete ? 'completed' : 'error');
        result.summary = summarizeTrace(result.trace, result.cycles);
        // Twenty-Hz samples should cover almost all of the final one-second windows.
        // Gaps/failures make the result incomplete; they never become a fake zero-memory PASS.
        result.memorySamplingComplete = result.trace.stopReason === 'completed' &&
          result.trace.sampleFailures === 0 && result.summary.maxSampleGapMs <= 250 &&
          result.summary.baselineWindowSampleCount >= 10 && result.summary.baselineWindowCoveredMs >= 800 &&
          result.summary.cycles.length === CYCLES && result.summary.cycles.every(r =>
            r.actualWaitMs >= SETTLE_MS && r.settledWindowSampleCount >= 10 && r.settledWindowCoveredMs >= 800);
        result.complete = result.complete && result.memorySamplingComplete;
        if (!result.memorySamplingComplete && !result.cancelled && !result.failure)
          result.failure = 'Memory trace is incomplete, sparse, or contains native sampling errors. Inspect the saved report.';
      } catch (error) {
        result.complete = false;
        result.failure = `${result.failure || ''} Memory finalization failed: ${String(error)}`.trim();
      }
    }
    result.finishedAt = new Date().toISOString(); result.totalWallMs = now() - started;
    running = false;
  }
  return result;
}
function memorySummaryForSharing(report) {
  const { trace, cycles, ...rest } = report;
  return { ...rest, fullTraceOmitted: true,
    traceMetadata: trace ? { metric: trace.metric, secondaryMetric: trace.secondaryMetric, units: trace.units,
      sampleIntervalMs: trace.sampleIntervalMs, sampleCount: trace.samples.length,
      sampleFailures: trace.sampleFailures, lastKernelError: trace.lastKernelError,
      stopReason: trace.stopReason, durationMs: trace.durationMs,
      lowPowerModeAtEnd: trace.lowPowerModeAtEnd, thermalStateAtEnd: trace.thermalStateAtEnd } : null,
    inferenceCycles: cycles.map(c => ({ cycle: c.cycle, complete: c.profile?.complete ?? false,
      passed: c.profile?.passed ?? false, attempted: c.profile?.attempted ?? 0,
      successful: c.profile?.successful ?? 0, parityFailures: c.profile?.parityFailures ?? null,
      runtimeFailures: c.profile?.runtimeFailures ?? null, failure: c.profile?.failure ?? null,
      sessionCreateMs: c.profile?.sessionCreateMs ?? null, releaseMs: c.profile?.releaseMs ?? null,
      latency: c.profile?.latency ?? null })) };
}
module.exports = { runMemoryProtocol, summarizeTrace, memorySummaryForSharing };
