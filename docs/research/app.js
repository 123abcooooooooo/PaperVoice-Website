/* SHEET/7 — adaptive optical research, GPL-3.0-or-later.
 * This is a new adaptive workflow using the established paperback.rs codec.
 * It is NOT a claimed invention of a previously unknown data storage format.
 * Audio file bytes are not altered by encoding.
 */
"use strict";
(() => {
  const $=id=>document.getElementById(id);
  const maxBytes=6*1024*1024, maxPhotoBytes=180*1024*1024;
  const src=$("source-file"),run=$("run"),restore=$("restore"),statusCreate=$("create-status"),statusRestore=$("restore-status");
  const densities600=[120,150,180,200,220,240,260,280,300],densities300=[75,100,120,135,150];
  let source=null,sourceURL=null,pdfURL=null,previewURL=null,recoveredURL=null;
  let audioChunks=[],mediaRecorder=null,stream=null,recTimer=null,recording=false,started=0;
  let scans=[],worker=null,readyPromise=null,pending=null,busy=false,previousSha=null;

  const size=b=>b<1048576?Math.ceil(b/1024)+" KB":(b/1048576).toFixed(2)+" MB";
  const yieldUI=()=>new Promise(resolve=>setTimeout(resolve,0));
  function message(element,value,isError=false){
    element.textContent=value;element.className=isError?"status error":"status";
  }
  function shaHex(buffer){
    return crypto.subtle.digest("SHA-256",buffer).then(hash=>
      Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,"0")).join(""));
  }
  function revoke(url){if(url)URL.revokeObjectURL(url);}
  function selectTab(create) {
    $("create-panel").hidden=!create;$("restore-panel").hidden=create;
    $("tab-create").setAttribute("aria-selected",String(create));
    $("tab-restore").setAttribute("aria-selected",String(!create));
    const hash=create?"#experiment":"#recover";
    if(location.hash!==hash)history.replaceState(null,"",hash);
  }
  $("tab-create").addEventListener("click",()=>selectTab(true));
  $("tab-restore").addEventListener("click",()=>selectTab(false));
  window.addEventListener("hashchange",()=>selectTab(location.hash!=="#recover"));
  selectTab(location.hash!=="#recover");

  function updateButtons(){
    run.disabled=busy||recording||!source;
    restore.disabled=busy||!scans.length;
    $("record").disabled=busy||recording;
    $("stop").disabled=!recording;
    src.disabled=busy||recording;
    $("scans").disabled=busy;
  }
  function resetOutput(){
    $("created").hidden=true;
    revoke(pdfURL);revoke(previewURL);pdfURL=null;previewURL=null;
    $("first-image").removeAttribute("src");$("pdf-link").removeAttribute("href");
    $("trials").hidden=true;$("trial-list").replaceChildren();
  }
  function resetRecovery(){
    $("restored").hidden=true;revoke(recoveredURL);recoveredURL=null;
    $("restored-player").pause();$("restored-player").removeAttribute("src");
    $("restored-link").removeAttribute("href");
  }
  function setSource(file){
    if(!file)return;
    if(!file.size||file.size>maxBytes){
      message(statusCreate,"The audio must be smaller than 6 MB for the research prototype.",true);
      return;
    }
    if(!file.type.startsWith("audio/")&&!/\.(mp3|wav|m4a|aac|flac|opus|ogg|webm)$/i.test(file.name)){
      message(statusCreate,"Please choose an audio file.",true);return;
    }
    source=file;revoke(sourceURL);sourceURL=URL.createObjectURL(file);
    $("selected").hidden=false;$("selected-name").textContent=file.name;
    $("selected-size").textContent=size(file.size)+" • original file bytes will be preserved";
    $("source-player").src=sourceURL;resetOutput();previousSha=null;
    message(statusCreate,"File loaded. You can now measure the exact number of pages.");
    updateButtons();
  }
  src.addEventListener("change",()=>{if(src.files?.[0])setSource(src.files[0]);});
  function stopTracks(){
    if(stream){stream.getTracks().forEach(track=>track.stop());stream=null;}
  }
  function finishRecording(){
    recording=false;clearInterval(recTimer);recTimer=null;stopTracks();
    if(!audioChunks.length){
      message(statusCreate,"Recording was empty.",true);updateButtons();return;
    }
    const mime=mediaRecorder.mimeType||"";
    const ext=mime.includes("mp4")?".m4a":mime.includes("ogg")?".ogg":".webm";
    const f=new File([new Blob(audioChunks,{type:mime})],"SHEET7_voice_"+Date.now()+ext,{type:mime});
    audioChunks=[];setSource(f);updateButtons();
  }
  $("record").addEventListener("click",async()=>{
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){
      message(statusCreate,"Your browser does not support microphone recording. Upload an audio file.",true);return;
    }
    try{
      stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      const type=["audio/mp4","audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus"]
        .find(value=>MediaRecorder.isTypeSupported(value));
      mediaRecorder=new MediaRecorder(stream,type?{mimeType:type}:{});
      audioChunks=[];
      mediaRecorder.ondataavailable=e=>{if(e.data?.size)audioChunks.push(e.data);};
      mediaRecorder.onstop=finishRecording;
      mediaRecorder.onerror=e=>{
        console.error(e);stopTracks();recording=false;clearInterval(recTimer);updateButtons();
        message(statusCreate,"Microphone recording failed.",true);
      };
      mediaRecorder.start(500);recording=true;started=Date.now();
      $("record-time").textContent="0:00";updateButtons();
      message(statusCreate,"Recording… stop when you finish (up to 90 seconds).");
      recTimer=setInterval(()=>{
        const s=Math.floor((Date.now()-started)/1000);
        $("record-time").textContent=Math.floor(s/60)+":"+String(s%60).padStart(2,"0");
        if(s>=90&&mediaRecorder?.state==="recording")mediaRecorder.stop();
      },300);
    }catch(err){
      stopTracks();message(statusCreate,err.name==="NotAllowedError"
        ?"Microphone permission denied. Enable it in Safari."
        :"Could not open microphone. Try uploading a recording.",true);
      updateButtons();
    }
  });
  $("stop").addEventListener("click",()=>{
    if(mediaRecorder?.state==="recording")mediaRecorder.stop();
  });
  window.addEventListener("pagehide",stopTracks);

  function onMessage(event){
    const data=event.data;
    if(data.type==="progress"){
      if(data.phase==="decode")message(statusRestore,"Checking page "+data.done+"/"+data.total+"…");
      if(data.phase==="encode")message(statusCreate,"Generating error-corrected dots…");
      return;
    }
    const p=pending;pending=null;
    if(!p)return;
    if(data.type==="error")p.reject(Error(data.message||"Optical engine failed"));
    else p.resolve(data);
  }
  function call(command,transfer=[]){
    if(!worker)return Promise.reject(Error("Optical engine not loaded."));
    if(pending)return Promise.reject(Error("Optical engine is already processing another request."));
    return new Promise((resolve,reject)=>{
      pending={resolve,reject};
      worker.postMessage(command,transfer);
    });
  }
  function engine(){
    if(readyPromise)return readyPromise;
    readyPromise=(async()=>{
      worker=new Worker("/paperback/worker.js",{type:"module"});
      worker.onmessage=onMessage;
      worker.onerror=e=>{
        const p=pending;pending=null;
        if(p)p.reject(Error(e.message||"WebAssembly engine failed to load."));
      };
      const started=await call({type:"init"});
      return started.version;
    })().catch(err=>{
      worker?.terminate();worker=null;readyPromise=null;throw err;
    });
    return readyPromise;
  }
  function logTrial(density,count,goal){
    $("trials").hidden=false;
    const p=document.createElement("p");
    p.textContent=density+" dots/inch → "+count+" page(s) · "+(count<=goal?"within goal":"too many");
    $("trial-list").append(p);
  }
  async function search(bytes,name,dpi,goal,cache){
    const densities=dpi===600?densities600:densities300;
    let lo=0,hi=densities.length-1,winning=null;
    while(lo<=hi){
      const mid=Math.floor((lo+hi)/2),density=densities[mid];
      let result=cache.get(density);
      if(!result){
        message(statusCreate,"Testing "+density+" dots/inch on "+dpi+" DPI printer…");
        await yieldUI();
        result=await call({type:"encode",name,bytes,
          settings:{preset:"modern",paper:"letter",printerDpi:dpi,dotDpi:density,
            dotPercent:80,compression:"max",marginMils:500,parityPercent:20}});
        cache.set(density,result);
        logTrial(density,result.pageCount,goal);
      }
      if(result.pageCount<=goal){winning={density,result};hi=mid-1;}
      else lo=mid+1;
    }
    return winning;
  }
  function mimeOf(name) {
    if(/\.mp3$/i.test(name))return"audio/mpeg";
    if(/\.m4a$/i.test(name))return"audio/mp4";
    if(/\.wav$/i.test(name))return"audio/wav";
    if(/\.ogg$/i.test(name))return"audio/ogg";
    if(/\.webm$/i.test(name))return"audio/webm";
    if(/\.flac$/i.test(name))return"audio/flac";
    return"application/octet-stream";
  }
  async function verify(bytes,originalSha){
    message(statusCreate,"Self-test: decoding the generated PDF and checking every original byte…");
    await call({type:"clear"});
    const pdfBytes=bytes.slice();
    const added=await call({type:"addImage",bytes:pdfBytes},[pdfBytes.buffer]);
    if(!added.count)throw Error("The generated PDF contains no readable pages.");
    const decoded=await call({type:"decode"});
    if(!decoded.result?.compatible)
      throw Error("PaperBack digital self-check failed: "+(decoded.result?.error||"cannot decode PDF"));
    const resultSha=await shaHex(decoded.bytes);
    if(resultSha!==originalSha)throw Error("Digital verification failed: the original and recovered SHA-256 hashes differ.");
    return {pages:added.count,sha:resultSha};
  }
  run.addEventListener("click",async()=>{
    if(!source||busy)return;
    busy=true;updateButtons();resetOutput();
    try{
      if(!crypto?.subtle)throw Error("Use HTTPS for SHA-256 integrity verification.");
      const target=Number($("target").value);
      const dpi=Number($("printer").value);
      const bytes=new Uint8Array(await source.arrayBuffer());
      const originalSha=await shaHex(bytes);
      previousSha=originalSha;
      message(statusCreate,"Measuring file: "+size(bytes.length)+". No lossy compression will be applied.");
      await engine();await yieldUI();
      const cache=new Map();
      let chosen=await search(bytes,source.name,dpi,target,cache);
      let fallback=false;
      if(!chosen&&target===7){
        message(statusCreate,"Seven pages were not achievable at the tested densities. Trying the 15-page fallback…");
        chosen=await search(bytes,source.name,dpi,15,cache);
        fallback=true;
      }
      if(!chosen){
        throw Error("The selected printer cannot fit this original recording within "+
          (target===7?"15":"15")+" pages at tested settings. Reduce the ORIGINAL recording size, use a 600-DPI printer, or allow more pages. No data was discarded.");
      }
      const {result,density}=chosen;
      const validated=await verify(result.pdf,originalSha);
      pdfURL=URL.createObjectURL(new Blob([result.pdf],{type:"application/pdf"}));
      previewURL=result.preview?.length?
        URL.createObjectURL(new Blob([result.preview],{type:"image/png"})):null;
      if(previewURL)$("first-image").src=previewURL;
      $("first-image").hidden=!previewURL;
      $("pdf-link").href=pdfURL;
      $("pdf-link").download="SHEET7_"+source.name.replace(/[^a-z0-9_.-]/gi,"_")+".pdf";
      $("page-number").textContent=String(result.pageCount);
      $("dot-number").textContent=density+" DPI";
      $("hash-label").textContent="MATCH ✓";
      $("result-head").textContent=fallback?"15-page fallback achieved":"Page target achieved";
      $("result-meta").textContent=size(source.size)+" • "+validated.pages+" readable PDF pages • no audio transcoding";
      $("created").hidden=false;
      message(statusCreate,"Digital round-trip passed: exact audio bytes recovered. "+
        (fallback?"7 pages could not be met; this fits within 15.":"Page budget achieved.")+
        " Real printer/iPhone recovery still needs testing.");
    }catch(e){
      console.error(e);message(statusCreate,"Experiment failed: "+e.message,true);
    }finally{busy=false;updateButtons();}
  });

  function listScans(){
    $("file-count").textContent=scans.length?
      scans.length+" file(s): "+scans.map(f=>f.name).join(", "):"No scans selected";
  }
  $("scans").addEventListener("change",()=>{
    for(const file of $("scans").files||[]){
      if(!file.size)continue;
      if(scans.some(f=>f.name===file.name&&f.size===file.size&&f.lastModified===file.lastModified))continue;
      scans.push(file);
    }
    $("scans").value="";
    listScans();resetRecovery();updateButtons();
  });
  $("clear").addEventListener("click",()=>{
    if(busy)return;
    scans=[];$("scans").value="";resetRecovery();listScans();updateButtons();
  });
  async function convertHeic(file){
    // WebKit can decode HEIC but paperback.rs accepts PNG/JPEG/BMP/PDF.
    const src=URL.createObjectURL(file);
    try{
      const image=new Image();image.src=src;await image.decode();
      const canvas=document.createElement("canvas");
      canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      canvas.getContext("2d").drawImage(image,0,0);
      const blob=await new Promise((resolve,reject)=>
        canvas.toBlob(b=>b?resolve(b):reject(Error("Image conversion failed.")),"image/png"));
      canvas.width=canvas.height=0;
      return new Uint8Array(await blob.arrayBuffer());
    }finally{URL.revokeObjectURL(src);}
  }
  restore.addEventListener("click",async()=>{
    if(!scans.length||busy)return;
    busy=true;updateButtons();resetRecovery();
    try{
      const totalBytes=scans.reduce((n,f)=>n+f.size,0);
      if(totalBytes>maxPhotoBytes)throw Error("Photos exceed 180 MB in total; try smaller originals or split the test.");
      await engine();await call({type:"clear"});
      let num=0;
      for(let i=0;i<scans.length;i++){
        const file=scans[i];message(statusRestore,"Loading "+file.name+" ("+(i+1)+"/"+scans.length+")");
        let added;
        try{
          const bytes=new Uint8Array(await file.arrayBuffer());
          added=await call({type:"addImage",bytes},[bytes.buffer]);
        }catch(e){
          if(!file.type.startsWith("image/"))throw Error(file.name+": "+e.message);
          const bytes=await convertHeic(file);
          added=await call({type:"addImage",bytes},[bytes.buffer]);
        }
        num+=added.count;
      }
      if(!num)throw Error("No recognizable optical pages were found.");
      message(statusRestore,"Decoding "+num+" captured page(s) with error correction…");
      const output=await call({type:"decode"});
      if(!output.result?.compatible)
        throw Error(output.result?.error||"Missing or damaged pages. Try a flatter, sharper 48 MP photo.");
      const originalBytes=output.bytes;
      const sha=await shaHex(originalBytes);
      const name=(output.result.fileName||"SHEET7_original.mp3").replace(/[\/\\\x00-\x1f]/g,"_");
      const blob=new Blob([originalBytes],{type:mimeOf(name)});
      recoveredURL=URL.createObjectURL(blob);
      $("restored-player").src=recoveredURL;
      $("restored-link").href=recoveredURL;
      $("restored-link").download=name;
      $("restored-info").textContent=name+" · "+size(blob.size)+" · "+num+" page(s) decoded";
      $("restored-sha").textContent="SHA-256: "+sha+
        (source&&sha===previousSha?" — MATCHES ORIGINAL UPLOADED IN THIS SESSION":"");
      $("restored").hidden=false;
      message(statusRestore,"Success. The original encoded audio file was recovered.");
    }catch(e){
      console.error(e);message(statusRestore,"Recovery failed: "+e.message,true);
    }finally{busy=false;updateButtons();}
  });
  updateButtons();
})();
