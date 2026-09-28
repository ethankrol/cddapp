import { Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { runExpandedPhone } from '../services/bpExpanded';
import type { ExpandedMode, ExpandedReport, Progress } from '../services/bpExpandedCore';

export default function ExpandedPpgScreen() {
  const [report,setReport]=useState<ExpandedReport|null>(null);
  const [progress,setProgress]=useState<Progress|null>(null);
  const [busy,setBusy]=useState(false),[minutes,setMinutes]=useState(5),[error,setError]=useState('');
  const active=useRef(true),running=useRef(false),cancel=useRef(false);
  useEffect(()=>{
    active.current=true;
    const listener=AppState.addEventListener('change',state=>{if(running.current && state!=='active')cancel.current=true;});
    return ()=>{active.current=false;cancel.current=true;listener.remove();};
  },[]);
  async function run(mode: ExpandedMode) {
    if(running.current||Platform.OS!=='ios')return;
    running.current=true;cancel.current=false;setBusy(true);setError('');setReport(null);setProgress(null);
    try {
      const result=await runExpandedPhone(mode,minutes*60,
        ()=>cancel.current||!active.current||AppState.currentState!=='active',
        value=>{if(active.current)setProgress(value);});
      if(active.current)setReport({...result,platform:Platform.OS,osVersion:String(Platform.Version),developmentBuild:__DEV__});
    } catch(e) {if(active.current)setError(String(e));}
    finally {running.current=false;if(active.current)setBusy(false);}
  }
  const button=(label:string,action:()=>void,disabled=false)=><Pressable accessibilityRole="button" disabled={disabled}
    onPress={action} style={{padding:18,marginTop:12,borderRadius:10,backgroundColor:disabled?'#82949e':'#184b66'}}>
    <Text style={{color:'white',fontSize:16,fontWeight:'600'}}>{label}</Text></Pressable>;
  return <><Stack.Screen options={{title:'All beats and replay',headerShown:true}} />
    <ScrollView contentContainerStyle={{padding:20,paddingBottom:50,backgroundColor:'#f6f8fa',flexGrow:1}}>
      <Text style={{fontSize:24,fontWeight:'700'}}>Test the complete recording</Text>
      <Text style={{marginVertical:16,fontSize:16,lineHeight:24}}>Synthetic software test. All 31 original beats and five shifted windows are checked against Python. These outputs are not health readings.</Text>
      {button('1. Run all beats + window comparison',()=>{void run('full');},busy||Platform.OS!=='ios')}
      <Text style={{marginTop:20,lineHeight:23}}>Timed replay supplies one second of saved samples each second. Blocks update every 30 seconds. Rolling windows update every five seconds after the first 30 seconds. Keep this screen open; locking or leaving the app cancels the test.</Text>
      {button(`Replay duration: ${minutes} minutes — tap to change`,()=>setMinutes(minutes===5?20:5),busy)}
      {button(`2. Replay fixed blocks (${minutes} min)`,()=>{void run('blocks');},busy||Platform.OS!=='ios')}
      {button(`3. Replay rolling windows (${minutes} min)`,()=>{void run('rolling');},busy||Platform.OS!=='ios')}
      {button(`Idle comparison (${minutes} min)`,()=>{void run('idle');},busy||Platform.OS!=='ios')}
      {busy&&button('Cancel',()=>{cancel.current=true;})}
      {progress&&<Text accessibilityLiveRegion="polite" style={{marginTop:20}}>{progress.seconds===undefined?'Checking':`${progress.seconds}/${progress.durationSeconds} seconds`}; {progress.windows} windows completed</Text>}
      {!!error&&<Text style={{color:'#b91c1c',marginTop:20}}>{error}</Text>}
      {report&&<View style={{backgroundColor:'white',padding:18,marginTop:20,borderRadius:12}}>
        <Text style={{fontSize:20,fontWeight:'700',color:report.passed?'#166534':'#b91c1c'}}>{report.cancelled?'CANCELLED':report.passed?'PASS':'FAIL'}</Text>
        <Text style={{marginTop:10}}>{report.successful} model calls; {report.windows.length} completed windows; {report.parityFailures} output mismatches.</Text>
        <Text style={{marginTop:10}}>Elapsed: {(report.totalWallMs/1000).toFixed(1)} seconds</Text>
        {!!report.failure&&<Text>{report.failure}</Text>}{!!report.cleanupFailure&&<Text>{report.cleanupFailure}</Text>}
        {button('Share report',()=>{void Share.share({message:JSON.stringify(report,null,2)}).catch(e=>setError(String(e)));})}
      </View>}
      <Text style={{marginTop:25,lineHeight:22}}>This repeats a generated signal, including artificial wrap boundaries. It tests foreground software replay, not wearable acquisition. Means and medians are diagnostic summaries; no calibration or health-journal write occurs. Energy and app-launch measurements require the separate profiling procedures.</Text>
    </ScrollView></>;
}
