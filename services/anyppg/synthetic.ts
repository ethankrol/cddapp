import {inferCsv} from './inference';
import type {CsvReport} from './core';
const fixture=require('../../assets/models/anyppg/synthetic_reference.json');
export async function checkAnyPpg(shouldCancel:()=>boolean,onProgress:(done:number,total:number)=>void):Promise<CsvReport> {
  const report=await inferCsv({kind:'cdd_serial_csv_v1',format:'legacy_ac',rows:fixture.rows},shouldCancel,onProgress);
  if(report.windows.length!==fixture.windows.length)throw new Error('Synthetic window count differs from Python.');
  let maxDifference=0;
  report.windows.forEach((window,i)=>{
    const expected=fixture.windows[i];
    if(window.channel!==expected.channel || window.startSeconds!==expected.startSample/125)throw new Error('Synthetic window alignment differs.');
    maxDifference=Math.max(maxDifference,Math.abs(window.sbp-expected.expected[0]),Math.abs(window.dbp-expected.expected[1]));
  });
  if(maxDifference>fixture.toleranceMmhg)throw new Error(`Synthetic parity check failed: difference ${maxDifference} mmHg.`);
  return {...report,source:'synthetic',synthetic:true,parityPassed:true,maxDifferenceMmhg:maxDifference,toleranceMmhg:fixture.toleranceMmhg};
}
