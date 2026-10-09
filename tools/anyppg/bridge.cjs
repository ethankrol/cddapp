// Local verification bridge only. Private recording contents are never written into the repo.
const fs=require('node:fs');
const {parseSerialCsv}=require('../../services/recordings/serialCsv');
const {prepareRecording,standardizeWindow,applyHead}=require('../../services/anyppg/core');
const head=require('../../assets/models/anyppg/ridge_head.json');
if(process.argv[2]==='prepare') {
 const p=prepareRecording(parseSerialCsv(fs.readFileSync(process.argv[3],'utf8')));
 const windows=[];
 for(const {channel,signal} of p.channels)for(const start of p.starts)windows.push({channel,start,
  normalized:Array.from(standardizeWindow(signal.subarray(start,start+3750)))});
 process.stdout.write(JSON.stringify(windows));
}else if(process.argv[2]==='head') {
 process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync(0,'utf8')).map(features=>applyHead(features,head))));
}else throw Error('Use prepare <private.csv> or head on stdin.');
