"""Compare app JS preparation + ONNX + JS BP head against frozen Python inference.

python tools/anyppg/verify_csv.py --csv /private/recording.csv --out /private/check.json
Does not train or save raw waves. No iPhone or clinical accuracy claim.
"""
import argparse, csv, hashlib, importlib.util, json, subprocess
from pathlib import Path
import numpy as np
import onnxruntime as ort
import torch

def main():
    p=argparse.ArgumentParser();p.add_argument('--csv',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
    if a.out.exists(): raise ValueError('Use a new output file.')
    root=Path(__file__).resolve().parents[2];bridge=root/'tools/anyppg/bridge.cjs';assets=root/'assets/models/anyppg'
    windows=json.loads(subprocess.check_output(['node',str(bridge),'prepare',str(a.csv)]))
    spec=importlib.util.spec_from_file_location('probe',root/'tools/research/recording_comparison/anyppg_probe.py');probe=importlib.util.module_from_spec(spec);spec.loader.exec_module(probe)
    torch.set_num_threads(1);model=probe.load_encoder(root/'tools/anyppg/source')
    with np.load(root/'tools/anyppg/source/ridge_probe.npz',allow_pickle=False) as f: head={k:f[k].copy() for k in f.files}
    with a.csv.open(encoding='utf-8-sig') as f:
        reader=csv.reader(f);next(reader);rows=np.array([[float(x) for x in r] for r in reader if r])
    time=rows[:,0]-rows[0,0];grid=np.arange(int(time[-1]//8)+1)*8
    options=ort.SessionOptions();options.intra_op_num_threads=options.inter_op_num_threads=1;options.graph_optimization_level=ort.GraphOptimizationLevel.ORT_DISABLE_ALL
    session=ort.InferenceSession(str(assets/'anyppg_encoder.onnx'),sess_options=options,providers=['CPUExecutionProvider'])
    features=[];expected=[];input_error=0
    for w in windows:
        col=1 if w['channel']=='red' else 2
        wave=np.interp(grid,time,rows[:,col])[w['start']:w['start']+3750]
        normalized=probe.chunk_and_standardize(wave[None,None,:])
        js=np.array(w['normalized'],dtype=np.float32).reshape(3,1,1250)
        input_error=max(input_error,float(np.max(np.abs(normalized-js))))
        with torch.inference_mode(): py_features=model(torch.from_numpy(normalized)).numpy().mean(axis=0)[None,:]
        expected.append(probe.predict_ridge(head,py_features)[0])
        features.append(session.run(None,{'chunks':js})[0].flatten().tolist())
    outputs=json.loads(subprocess.check_output(['node',str(bridge),'head'],input=json.dumps(features).encode()))
    error=np.max(np.abs(np.array(outputs)-np.array(expected)),axis=0)
    assert input_error<=1e-6 and (error<=.01).all(), (input_error,error)
    report={'complete':True,'passed':True,'physicalIphoneRun':False,'bpAccuracyEvaluated':False,'trainingRun':False,
      'method':'JS CSV interpolation/normalization -> host ORT CPU -> JS saved BP head vs Python frozen pipeline',
      'graphOptimizationLevel':'disabled','csvSha256':hashlib.sha256(a.csv.read_bytes()).hexdigest(),
      'maxNormalizedDifference':input_error,'maxOutputDifferenceMmhg':error.tolist(),'toleranceMmhg':.01,
      'windows':[{'channel':w['channel'],'startSeconds':w['start']/125,'appCoreOutput':output,'pythonReference':ref.tolist()}for w,output,ref in zip(windows,outputs,expected)]}
    a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))

if __name__=='__main__':main()
