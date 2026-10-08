import {Link, Stack, type Href} from 'expo-router';
import {useRef, useState} from 'react';
import {ActivityIndicator, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View} from 'react-native';
import {pickRecording} from '../services/recordings/pickRecording';
import {inspectRecording, makeDemoRecording, previewBeatExtraction, type BeatPreview, type Inspection, type SensorRecording} from '../services/recordings/recordingCore';
import {inspectSerialCsv, type SerialInspection, type SerialRecording} from '../services/recordings/serialCsv';

type Recording=SensorRecording|SerialRecording;
export default function RecordingScreen() {
  const [recording,setRecording]=useState<Recording|null>(null);
  const [report,setReport]=useState<Inspection|SerialInspection|null>(null);
  const [preview,setPreview]=useState<BeatPreview|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const running=useRef(false);
  function clear(){setRecording(null);setReport(null);setPreview(null);setError('');}
  function load(value:Recording){
    const next=value.kind==='cdd_serial_csv_v1'?inspectSerialCsv(value):inspectRecording(value);
    setRecording(value);setReport(next);setPreview(null);
  }
  async function run(action:()=>Promise<void>){
    if(running.current)return;running.current=true;setBusy(true);setError('');
    try{await action();}catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{running.current=false;setBusy(false);}
  }
  return <><Stack.Screen options={{title:'Inspect a recording',headerShown:true}}/>
    <ScrollView contentContainerStyle={s.page}>
      <Text style={s.title}>Check your sensor file</Text>
      <Text style={s.body}>Choose the red/infrared CSV from the collection computer, or a recording JSON in the documented format. This screen checks the data and timing; it does not calculate blood pressure.</Text>
      <Text style={s.note}>The imported waveform stays in this screen’s memory. It is not added to your health journal or saved by this feature. Files from a cloud provider are handled by your system’s file picker.</Text>
      <Pressable accessibilityRole="button" disabled={busy||Platform.OS==='web'} style={s.button} onPress={()=>run(async()=>{const value=await pickRecording();if(value){clear();load(value);}})}><Text style={s.white}>Choose CSV or JSON</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy} style={s.button} onPress={()=>run(async()=>{clear();load(makeDemoRecording());})}><Text style={s.white}>Load synthetic example</Text></Pressable>
      {busy&&<ActivityIndicator/>}{!!error&&<Text style={s.error}>{error}</Text>}
      {report&&<View style={s.card}>
        <Text style={s.heading}>{report.source==='synthetic'?'Synthetic example':'Recorded sensor data'}</Text>
        <Text style={s.body}>{report.sampleCount.toLocaleString()} samples · {report.elapsedSeconds.toFixed(3)} seconds between first and last timestamp</Text>
        {'observedLoggedPairsPerSecond' in report&&<>
          <Text style={s.body}>Logged pairs per second: {report.observedLoggedPairsPerSecond?.toFixed(2)??'unknown'}</Text>
          <Text style={s.body}>Time between logged rows: {report.intervalMs.min.toFixed(1)}–{report.intervalMs.max.toFixed(1)} ms; median {report.intervalMs.median.toFixed(1)} ms</Text>
          <Text style={s.note}>The logging rate does not establish the sensor’s true sampling rate.</Text>
        </>}
        <Text style={s.heading}>{report.previewAllowed?'Timing checks passed for beat preview':'Recording needs review'}</Text>
        {report.blockers.map((v,i)=><Text key={'b'+i} style={s.error}>• {v}</Text>)}
        {report.warnings.map((v,i)=><Text key={'w'+i} style={s.body}>• {v}</Text>)}
        {recording?.kind==='cdd_ppg_recording_v1'&&report.previewAllowed&&<Pressable accessibilityRole="button" disabled={busy} style={s.button} onPress={()=>run(async()=>{await new Promise(resolve=>setTimeout(resolve,30));setPreview(previewBeatExtraction(recording));})}><Text style={s.white}>Preview beat extraction</Text></Pressable>}
        {preview&&<><Text style={s.heading}>Beat preview {preview.passed?'completed':'needs review'}</Text>{preview.windows.map(w=><Text key={w.window} style={s.body}>Window {w.window}: {w.candidateCount} candidate beats{w.error?'; '+w.error:''}</Text>)}<Text style={s.body}>{preview.remainderSamples} trailing samples were not previewed. No normalization or model inference ran.</Text></>}
        <Pressable accessibilityRole="button" disabled={busy} style={s.button} onPress={()=>run(async()=>{await Share.share({message:JSON.stringify({inspection:report,preview},null,2)});})}><Text style={s.white}>Share diagnostics only</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={busy} style={s.button} onPress={clear}><Text style={s.white}>Clear imported data</Text></Pressable>
      </View>}
      <Link href={'/ml-calibration-log' as Href} style={s.link}>Record a cuff reading</Link>
    </ScrollView></>;
}
const s=StyleSheet.create({page:{padding:20,paddingBottom:48,backgroundColor:'#f6f8fa',flexGrow:1},title:{fontSize:26,fontWeight:'700',color:'#172b3a'},heading:{fontSize:19,fontWeight:'600',marginTop:18,color:'#172b3a'},body:{fontSize:16,lineHeight:24,marginTop:10,color:'#435466'},note:{fontSize:14,lineHeight:21,marginTop:12,color:'#705300'},button:{backgroundColor:'#184b66',borderRadius:12,padding:16,marginTop:16,alignItems:'center'},white:{fontSize:16,fontWeight:'600',color:'#fff'},error:{color:'#a31c1c',lineHeight:23,marginTop:12},card:{backgroundColor:'#fff',borderRadius:12,padding:16,marginTop:20},link:{color:'#184b66',fontSize:17,marginTop:24}});
