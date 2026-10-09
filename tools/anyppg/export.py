"""Export the frozen, verified AnyPPG encoder and the previously fitted BP head.

Run from any directory: python tools/anyppg/export.py
Requires torch 2.8, numpy, onnx 1.17, onnxruntime 1.19.2. No training/data download.
The public test fixture is entirely synthetic. Never embeds a person's recording.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import platform

import numpy as np
import onnx
import onnxruntime as ort
import torch

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'tools/anyppg/source'
OUT = ROOT / 'assets/models/anyppg'

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def save(name, value):
    (OUT / name).write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')

def main():
    spec = importlib.util.spec_from_file_location('probe', ROOT / 'tools/research/recording_comparison/anyppg_probe.py')
    probe = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(probe)
    assert sha(SOURCE/'ridge_probe.npz') == '8856f560c9d2ecb1b73dfcf504c313871ed5438347e558f3090dff7160f9d608'
    torch.set_num_threads(1)
    torch.set_num_interop_threads(1)
    model = probe.load_encoder(SOURCE, 'cpu')
    with np.load(SOURCE/'ridge_probe.npz', allow_pickle=False) as f:
        head = {key: f[key].copy() for key in f.files}
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / 'anyppg_encoder.onnx'
    with torch.inference_mode():
        torch.onnx.export(model, torch.zeros(3,1,1250), str(path),
            input_names=['chunks'], output_names=['features'], opset_version=17,
            dynamo=False, do_constant_folding=True)
    graph=onnx.load(str(path))
    # This export supports exactly three 1250-sample chunks, not dynamic batches.
    for dim,size in zip(graph.graph.output[0].type.tensor_type.shape.dim,[3,512]):
        dim.ClearField('dim_param');dim.dim_value=size
    onnx.save(graph,str(path))
    onnx.checker.check_model(str(path))
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = opts.inter_op_num_threads = 1
    # Default ORT graph optimization changes this author's zero-padded pooling
    # graph numerically. Disable it in BOTH export verification and the app.
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
    session = ort.InferenceSession(str(path), sess_options=opts, providers=['CPUExecutionProvider'])
    assert session.get_inputs()[0].shape == [3,1,1250]
    assert session.get_outputs()[0].shape == [3,512]
    # Deterministic, generated irregular serial recording, distinct red/IR signals.
    times = np.arange(0, 48726, 21, dtype=np.float64)
    t = times / 1000
    red = 2000 + 250*np.sin(2*np.pi*1.2*t) + 35*np.sin(2*np.pi*2.4*t+.3)
    infrared = -800 + 500*np.sin(2*np.pi*1.2*t+.12) + 45*np.sin(2*np.pi*2.4*t+.5)
    rows = np.stack([times+1000,red,infrared],axis=1)
    grid = np.arange(int(times[-1]//8)+1)*8
    starts = [0,len(grid)-3750]
    fixture_windows = []
    errors = []
    for channel, values in [('red',red),('infrared',infrared)]:
        wave = np.interp(grid,times,values)
        for start in starts:
            window = wave[start:start+3750][None,None,:]
            chunks = probe.chunk_and_standardize(window)
            with torch.inference_mode():
                py = model(torch.from_numpy(chunks)).numpy()
            mobile = session.run(['features'],{'chunks':chunks})[0]
            py_bp = probe.predict_ridge(head, py.mean(axis=0)[None,:])[0]
            ort_bp = probe.predict_ridge(head, mobile.mean(axis=0)[None,:])[0]
            errors.append(np.abs(py_bp-ort_bp))
            fixture_windows.append({'channel':channel,'startSample':start,
                'normalized':chunks.flatten().tolist(), 'features':mobile.flatten().tolist(),
                'expected':py_bp.tolist()})
    # Further conversion checks cover varied synthetic amplitude, offset and morphology.
    rng = np.random.default_rng(125)
    for i in range(20):
        t = np.arange(3750)/125
        wave = (10**rng.uniform(-2,5))*(np.sin(2*np.pi*rng.uniform(.6,2.8)*t)+.2*rng.normal(size=3750)) + rng.uniform(-10000,10000)
        chunks = probe.chunk_and_standardize(wave[None,None,:])
        with torch.inference_mode():
            py = model(torch.from_numpy(chunks)).numpy()
        mobile = session.run(['features'],{'chunks':chunks})[0]
        errors.append(np.abs(probe.predict_ridge(head, py.mean(axis=0)[None,:])[0]-probe.predict_ridge(head,mobile.mean(axis=0)[None,:])[0]))
    error = np.max(errors,axis=0)
    assert (error <= .01).all(), error
    save('ridge_head.json',{'schemaVersion':1, 'model':'anyppg_frozen_ridge_raw_v1',
        'outputOrder':['SBP','DBP'], 'outputUnits':'mmHg',
        **{key: value.tolist() for key,value in head.items()}})
    save('synthetic_reference.json',{'synthetic':True,'rows':rows.tolist(),'windows':fixture_windows,
        'toleranceMmhg':.01,'normalizedAbsoluteTolerance':1e-6})
    save('manifest.json',{'schemaVersion':1,'modelId':'anyppg_frozen_ridge_raw_v1',
        'modelSha256':sha(path),'headSha256':sha(OUT/'ridge_head.json'),
        'sourceHashes':{p.name:sha(p) for p in SOURCE.iterdir() if p.is_file()},
        'syntheticFixtureSha256':sha(OUT/'synthetic_reference.json'),
        'inputName':'chunks','inputShape':[3,1,1250],'inputDtype':'float32',
        'outputName':'features','outputShape':[3,512],
        'requiredGraphOptimizationLevel':'disabled',
        'samplingRateHz':125,'recordingSamples':3750,'chunkSamples':1250,
        'preprocessing':'Per-chunk float64 population z-score with std+1e-8; then float32. No extra filter.',
        'head':'Float32 mean of 3 embeddings; saved feature standardization and ridge arithmetic in float64/JS Number.',
        'outputOrder':['SBP','DBP'],'outputUnits':'mmHg','calibrationApplied':False,
        'onnxBytes':path.stat().st_size,'sourceRepository':probe.REPOSITORY,'sourceCommit':probe.COMMIT,
        'physicalIphoneValidated':False,'bpAccuracyValidated':False,
        'pretrainingOverlap':probe.OVERLAP})
    save('export_report.json',{'complete':True,'passed':True,'syntheticWindowsChecked':24,
        'maxOutputDifferenceMmhg':error.tolist(),'toleranceMmhg':.01,
        'modelSha256':sha(path),'headSha256':sha(OUT/'ridge_head.json'),
        'python':platform.python_version(),'torch':torch.__version__,'numpy':np.__version__,
        'onnx':onnx.__version__,'onnxruntime':ort.__version__,
        'physicalIphoneRun':False,'trainingRun':False,'scope':'Host CPU export parity only.'})
    print(json.dumps({'exported':str(path),'bytes':path.stat().st_size,'maxDifferenceMmhg':error.tolist()}))

if __name__ == '__main__': main()
