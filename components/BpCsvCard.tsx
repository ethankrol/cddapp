import {useEffect,useRef,useState} from 'react';
import {ActivityIndicator,AppState,Pressable,Share,StyleSheet,Text,View} from 'react-native';
import {pickRecording} from '@/services/recordings/pickRecording';
import {inferCsv} from '@/services/anyppg/inference';
import {checkAnyPpg} from '@/services/anyppg/synthetic';
import type {CsvReport} from '@/services/anyppg/core';

export default function BpCsvCard() {
  const [busy,setBusy]=useState(false),[progress,setProgress]=useState('');
  const [report,setReport]=useState<CsvReport|null>(null),[error,setError]=useState('');
  const [site,setSite]=useState('unknown');
  const running=useRef(false),cancel=useRef(false),mounted=useRef(true);
  useEffect(()=>{
    mounted.current=true;
    const subscription=AppState.addEventListener('change',state=>{if(state!=='active')cancel.current=true;});
    return ()=>{mounted.current=false;cancel.current=true;subscription.remove();};
  },[]);
  async function run(synthetic:boolean) {
    if(running.current)return;
    running.current=true;cancel.current=false;setBusy(true);setReport(null);setError('');
    setProgress(synthetic?'Checking the bundled model…':'Choose your CSV in Files…');
    try {
      const onProgress=(done:number,total:number)=>{if(mounted.current)setProgress(`Processed ${done} of ${total} channel windows`);};
      let result:CsvReport;
      if(synthetic) result=await checkAnyPpg(()=>cancel.current,onProgress);
      else {
        const recording=await pickRecording();
        if(!recording)return;
        // A system document picker may temporarily change AppState; resume only when it returns.
        if(!mounted.current)return;
        cancel.current=false;
        if(!('kind' in recording)||recording.kind!=='cdd_serial_csv_v1')throw new Error('Choose the original three-column red/infrared CSV for this model demo.');
        setProgress('Loading AnyPPG and preparing your recording…');
        result=await inferCsv(recording,()=>cancel.current,onProgress);
        result={...result,sensorSite:site,sensorSiteSource:'user_selection',controller:'ESP32-C3 (team reported)'};
      }
      if(mounted.current&&!cancel.current)setReport(result);
    }catch(e){if(mounted.current)setError(e instanceof Error?e.message:String(e));}
    finally {running.current=false;if(mounted.current){setBusy(false);setProgress('');}}
  }
  async function shareReport(){try{await Share.share({message:JSON.stringify(report,null,2)});}catch(e){setError(String(e));}}
  return <View style={s.card}>
    <Text style={s.eyebrow}>CSV MODEL DEMO</Text>
    <Text style={s.title}>Your recording, on this phone</Text>
    <Text style={s.body}>Import the team’s red/infrared CSV to calculate experimental blood-pressure estimates with AnyPPG.</Text>
    <View style={s.notice}><Text style={s.noticeTitle}>Research estimates • not a cuff measurement</Text>
      <Text style={s.note}>The CSV’s print times are an approximate clock. Accuracy on this sensor is unverified. Results stay outside your health journal.</Text></View>
    <Text style={s.label}>Where was the sensor worn?</Text>
    <View style={s.row}>{['unknown','finger','wrist'].map(value=><Pressable key={value} disabled={busy} accessibilityRole="radio" accessibilityState={{checked:site===value,disabled:busy}} onPress={()=>{setSite(value);setReport(null);}} style={[s.chip,site===value&&s.selected]}><Text style={site===value?s.selectedText:s.chipText}>{value==='unknown'?'Not sure':value==='finger'?'Finger':'Wrist'}</Text></Pressable>)}</View>
    <Text style={s.note}>This records what you know; it does not adjust the model.</Text>
    <Pressable disabled={busy} accessibilityRole="button" onPress={()=>run(false)} style={[s.button,busy&&s.disabled]}><Text style={s.buttonText}>Import CSV & calculate</Text></Pressable>
    <Pressable disabled={busy} accessibilityRole="button" onPress={()=>run(true)} style={s.secondary}><Text style={s.link}>Check model with a synthetic signal</Text></Pressable>
    {busy&&<View accessibilityLiveRegion="polite"><ActivityIndicator color="#184d60"/><Text style={s.note}>{progress}</Text><Pressable accessibilityRole="button" onPress={()=>{cancel.current=true;setProgress('Stopping after the current inference…');}} style={s.secondary}><Text style={s.link}>Cancel</Text></Pressable></View>}
    {!!error&&<Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {report&&<View accessibilityLiveRegion="polite">
      <Text style={s.resultTitle}>{report.synthetic?'Synthetic check passed':'CSV estimates complete'}</Text>
      <Text style={s.note}>{report.sourceRows.toLocaleString()} rows · {report.sourceDurationSeconds.toFixed(2)} seconds · {report.windows.length} channel windows</Text>
      {report.synthetic?<Text style={s.note}>Matches Python within 0.01 mmHg. These are generated test signals.</Text>:<Text style={s.note}>Sensor site: {report.sensorSite}. Largest logged gap: {report.maxLoggedGapMs} ms. Timing remains unverified.</Text>}
      {report.windows.map((w,i)=><View key={i} style={s.result}>
        <Text style={s.label}>{w.channel==='red'?'Red light':'Infrared light'} · {w.startSeconds.toFixed(3)}–{w.lastSampleSeconds.toFixed(3)} s</Text>
        <Text style={s.number}>{w.sbp.toFixed(1)} / {w.dbp.toFixed(1)} <Text style={s.unit}>mmHg</Text></Text>
        <Text style={s.note}>Estimated systolic / diastolic</Text>
      </View>)}
      <Text style={s.note}>Channels are processed separately. The last window may overlap the previous one; values are not pooled into a single reading.</Text>
      <Text style={s.note}>Computed in {(report.totalWallMs/1000).toFixed(2)} s. The CSV was already recorded, so the app does not wait for the recording to play.</Text>
      <View style={s.row}><Pressable accessibilityRole="button" onPress={shareReport} style={s.secondary}><Text style={s.link}>Share test report</Text></Pressable><Pressable accessibilityRole="button" onPress={()=>setReport(null)} style={s.secondary}><Text style={s.link}>Clear results</Text></Pressable></View>
    </View>}
  </View>;
}
const s=StyleSheet.create({
  card:{margin:18,padding:20,borderRadius:22,backgroundColor:'#f3f7f9'},eyebrow:{fontSize:12,fontWeight:'700',letterSpacing:1.6,color:'#376371'},
  title:{fontSize:25,fontWeight:'700',color:'#18333f',marginVertical:10},body:{fontSize:16,lineHeight:24,color:'#435460'},
  notice:{backgroundColor:'#fff2c8',borderRadius:12,padding:13,marginVertical:18},noticeTitle:{color:'#674e15',fontWeight:'700',fontSize:14},
  note:{fontSize:13,lineHeight:20,color:'#53616b',marginTop:5},label:{fontSize:14,fontWeight:'600',color:'#254754',marginTop:8},
  row:{flexDirection:'row',flexWrap:'wrap',gap:8,marginTop:10},chip:{borderWidth:1,borderColor:'#b4c6ce',borderRadius:20,paddingHorizontal:14,paddingVertical:9},
  selected:{backgroundColor:'#184d60',borderColor:'#184d60'},selectedText:{color:'#fff',fontWeight:'600'},chipText:{color:'#254754'},
  button:{backgroundColor:'#184d60',padding:16,borderRadius:13,alignItems:'center',marginTop:20},buttonText:{color:'#fff',fontWeight:'700',fontSize:16},
  disabled:{opacity:.5},secondary:{paddingVertical:14,paddingHorizontal:8,alignItems:'center'},link:{color:'#184d60',fontWeight:'600',fontSize:14},
  error:{color:'#9f2222',fontSize:14,lineHeight:21,marginVertical:12},resultTitle:{fontSize:21,fontWeight:'700',color:'#18333f',marginTop:14},
  result:{backgroundColor:'#fff',padding:15,borderRadius:13,marginTop:12},number:{fontSize:30,fontWeight:'700',color:'#18333f',marginTop:8},unit:{fontSize:14,fontWeight:'400'}
});
