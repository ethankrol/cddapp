#!/usr/bin/env node
// Read-only inspection. Outputs aggregate engineering diagnostics, no waveform or participant identifiers.
const fs=require('node:fs');
const core=require('../../services/recordings/recordingCore');
const serial=require('../../services/recordings/serialCsv');
try {
  const args=process.argv.slice(2);
  if(args.length!==1) throw Error('Usage: node tools/recordings/inspect_recording.cjs recording.csv-or-json');
  const stat=fs.statSync(args[0]);
  if(!stat.isFile() || stat.size>core.MAX_FILE_BYTES) throw Error('Choose a CSV or JSON file no larger than 4 MiB.');
  const r=serial.parseRecordingFile(fs.readFileSync(args[0],'utf8'));
  const inspection=r.kind==='cdd_serial_csv_v1'?serial.inspectSerialCsv(r):core.inspectRecording(r);
  console.log(JSON.stringify({inspection,preview:inspection.previewAllowed?core.previewBeatExtraction(r):null},null,2));
  process.exitCode=inspection.previewAllowed?0:2;
} catch(e) { console.error(e.message); process.exitCode=1; }
