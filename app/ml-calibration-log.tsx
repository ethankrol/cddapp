import {Stack} from 'expo-router';
import {useRef,useState} from 'react';
import {Alert,Platform,Pressable,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import {getResearchStore} from '../services/recordings/researchStore';
import type {CuffDraft} from '../services/recordings/calibrationStoreCore';
export default function CuffLogScreen(){
  const [participant,setParticipant]=useState(''),[recordingId,setRecordingId]=useState(''),[referenceId,setReferenceId]=useState('');
  const [cuffDevice,setCuffDevice]=useState(''),[measuredAt,setMeasuredAt]=useState(''),[sbp,setSbp]=useState(''),[dbp,setDbp]=useState('');
  const [items,setItems]=useState<CuffDraft[]>([]),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const running=useRef(false);
  async function run(action:()=>Promise<void>){
    if(running.current)return;running.current=true;setBusy(true);setError('');setMessage('');
    try{await action();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{running.current=false;setBusy(false);}
  }
  async function save(){
    const now=new Date().toISOString();
    const store=await getResearchStore();
    await store.saveDraft({schemaVersion:1,kind:'cdd_cuff_reference_draft_v1',status:'unmatched',source:'recorded',
      participantCode:participant.trim(),referenceId:referenceId.trim(),recordingId:recordingId.trim(),cuffDeviceId:cuffDevice.trim(),
      measuredAt:measuredAt.trim(),createdAt:now,units:'mmHg',cuff:{sbp:Number(sbp.trim()),dbp:Number(dbp.trim())}});
    setItems(await store.listDrafts(participant.trim()));setMessage('Saved locally as an unmatched cuff reading. No prediction was changed.');
    setReferenceId('');setSbp('');setDbp('');setMeasuredAt('');
  }
  const fields:[string,string,(v:string)=>void][]=[['Participant code',participant,v=>{setParticipant(v);setItems([]);} ],['Recording ID',recordingId,setRecordingId],['Unique cuff-reading ID',referenceId,setReferenceId],['Cuff device / identifier',cuffDevice,setCuffDevice],['Measurement time (UTC)',measuredAt,setMeasuredAt],['SBP / top number (mmHg)',sbp,setSbp],['DBP / bottom number (mmHg)',dbp,setDbp]];
  return <><Stack.Screen options={{title:'Cuff reading log',headerShown:true}}/><ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
    <Text style={s.title}>Save a cuff reference</Text>
    <Text style={s.body}>A cuff reference is a blood-pressure reading from a separate cuff. Save its time and the matching sensor recording ID so they can be compared later.</Text>
    <Text style={s.note}>These are local research drafts. Saving a number does not activate calibration, verify the pairing, or change the model’s output. Use participant codes instead of names. This screen has no account access control; anyone with access to the app may access stored drafts.</Text>
    {fields.map(([label,value,set])=><View key={label}><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} style={s.input} value={value} onChangeText={set} editable={!busy} autoCapitalize="none" autoCorrect={false} maxLength={160} placeholder={label==='Measurement time (UTC)'?'2026-10-07T12:00:00.000Z':undefined} keyboardType={label.includes('(mmHg)')?'decimal-pad':'default'}/></View>)}
    <Pressable accessibilityRole="button" disabled={busy} onPress={()=>setMeasuredAt(new Date().toISOString())}><Text style={s.link}>Use the current time — only if measured now</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={busy||Platform.OS==='web'} style={s.button} onPress={()=>run(save)}><Text style={s.white}>Save unmatched cuff reading</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={busy||Platform.OS==='web'} style={s.button} onPress={()=>run(async()=>{const store=await getResearchStore();setItems(await store.listDrafts(participant.trim()));})}><Text style={s.white}>Load this participant’s saved readings</Text></Pressable>
    {!!error&&<Text style={s.error}>{error}</Text>}{!!message&&<Text style={s.body}>{message}</Text>}
    {items.map(item=><View key={item.referenceId} style={s.card}><Text style={s.label}>{item.referenceId} · unmatched</Text><Text style={s.body}>{item.cuff.sbp} / {item.cuff.dbp} mmHg{ '\n'}{item.measuredAt}{'\n'}Recording: {item.recordingId}</Text><Pressable accessibilityRole="button" disabled={busy} onPress={()=>Alert.alert('Delete this local cuff reading?',item.referenceId,[{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:()=>run(async()=>{const store=await getResearchStore();await store.deleteDraft(item.participantCode,item.referenceId);setItems(await store.listDrafts(item.participantCode));})}])}><Text style={s.link}>Delete reading</Text></Pressable></View>)}
  </ScrollView></>;
}
const s=StyleSheet.create({page:{padding:20,paddingBottom:50,backgroundColor:'#f6f8fa'},title:{fontSize:25,fontWeight:'700'},body:{color:'#435466',fontSize:16,lineHeight:24,marginTop:12},note:{color:'#705300',fontSize:14,lineHeight:21,marginVertical:15},label:{fontSize:15,fontWeight:'600',marginTop:15},input:{borderWidth:1,borderColor:'#aab8bf',borderRadius:8,padding:12,marginTop:6,backgroundColor:'#fff'},button:{backgroundColor:'#184b66',borderRadius:12,padding:16,marginTop:18,alignItems:'center'},white:{color:'#fff',fontSize:16,fontWeight:'600'},link:{color:'#184b66',fontSize:15,marginTop:16},error:{color:'#a31c1c',marginTop:12},card:{backgroundColor:'#fff',padding:16,borderRadius:12,marginTop:16}});
