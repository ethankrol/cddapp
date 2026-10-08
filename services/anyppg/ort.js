'use strict';
const need=(ok,msg)=>{if(!ok)throw new Error(msg);};
async function createAdapter({ort,uri,now=()=>performance.now()}) {
  const session=await ort.InferenceSession.create(uri,{executionProviders:['cpu'],intraOpNumThreads:1,interOpNumThreads:1,graphOptimizationLevel:'disabled'});
  if(JSON.stringify(session.inputNames)!=='["chunks"]'||JSON.stringify(session.outputNames)!=='["features"]') {
    await session.release();throw new Error('Wrong AnyPPG encoder interface.');
  }
  let released=false;
  return {
    async run(chunks) {
      need(!released,'Session was released.');
      need(chunks instanceof Float32Array&&chunks.length===3750&&chunks.every(Number.isFinite),'Invalid AnyPPG input tensor.');
      let input,outputs,error,result;
      try {
        input=new ort.Tensor('float32',chunks,[3,1,1250]);
        const start=now();outputs=await session.run({chunks:input});
        const inferenceMs=now()-start,features=outputs.features;
        need(features?.type==='float32'&&JSON.stringify(features.dims)==='[3,512]','Unexpected encoder output.');
        result={features:Float32Array.from(features.data),inferenceMs};
      }catch(e){error=e;}
      const cleanup=[];
      for(const tensor of new Set([input,...Object.values(outputs||{})])) if(tensor) try{tensor.dispose();}catch(e){cleanup.push(String(e));}
      if(error||cleanup.length)throw new Error([error?String(error):'',...cleanup].filter(Boolean).join('; '));
      return result;
    },
    async release(){if(!released){released=true;await session.release();}}
  };
}
module.exports={createAdapter};
