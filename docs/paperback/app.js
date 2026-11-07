/* PaperVoice PaperBack Lab / GPL-3.0-or-later
   Browser-only glue for paperback.rs 1.3.2 (original author Josef H.B. Schneider).
   See NOTICE.md for provenance and license terms. */
"use strict";
(() => {
  const el=id=>document.getElementById(id);
  const encodeTab=el("tab-encode"),decodeTab=el("tab-decode");
  const encodePane=el("pane-encode"),decodePane=el("pane-decode");
  const sourceInput=el("encode-file"),sourceCard=el("source-card");
  const encodeButton=el("encode-button"),decodeButton=el("decode-button");
  const encodeStatus=el("encode-status"),decodeStatus=el("decode-status");
  const encodeResult=el("encode-result"),decodeResult=el("decode-result");
  const scanInput=el("scan-files"),cameraInput=el("camera-input");
  let worker=null,readyPromise=null,pending=null,busy=false;
  let recording=false,recorder=null,stream=null,segments=[],clock=null,started=0;
  let audioFile=null,previewSrc=null,pdfSrc=null,recoveredSrc=null,sourceSrc=null;
  let scans=[];
  const MAX_FILE=6*1024*1024, MAX_SCAN=70*1024*1024;
  const human=bytes=>bytes<1024?bytes+" bytes":bytes<1048576?
    Math.ceil(bytes/1024)+" KB":(bytes/1048576).toFixed(2)+" MB";

  function status(node,msg,error=false){
    node.textContent=msg;
    node.className=error?"status error":"status";
  }
  function tab(which){
    const isEncode=which==="encode";
    encodePane.hidden=!isEncode;decodePane.hidden=isEncode;
    encodeTab.setAttribute("aria-selected",String(isEncode));
    decodeTab.setAttribute("aria-selected",String(!isEncode));
    if(location.hash!==(isEncode?"#encode":"#decode"))
      history.replaceState(null,"",isEncode?"#encode":"#decode");
  }
  encodeTab.addEventListener("click",()=>tab("encode"));
  decodeTab.addEventListener("click",()=>tab("decode"));
  window.addEventListener("hashchange",()=>tab(location.hash==="#decode"?"decode":"encode"));
  tab(location.hash==="#decode"?"decode":"encode");

  function update(){
    encodeButton.disabled=busy||recording||!audioFile;
    decodeButton.disabled=busy||!scans.length;
    el("record-start").disabled=busy||recording;
    el("record-stop").disabled=!recording;
    sourceInput.disabled=busy||recording;
    scanInput.disabled=busy;
    cameraInput.disabled=busy;
  }
  function revoke(url){if(url)URL.revokeObjectURL(url);}
  function resetEncode(){
    encodeResult.hidden=true;revoke(previewSrc);revoke(pdfSrc);
    previewSrc=pdfSrc=null;el("preview-image").removeAttribute("src");
    el("pdf-download").removeAttribute("href");
  }
  function resetDecode(){
    decodeResult.hidden=true;revoke(recoveredSrc);recoveredSrc=null;
    el("recovered-player").pause();el("recovered-player").removeAttribute("src");
    el("recovered-download").removeAttribute("href");
  }
  function setFile(file){
    if(!file)return;
    if(!file.size||file.size>MAX_FILE){
      status(encodeStatus,"Choose an audio file between 1 byte and 6 MB for the initial phone experiment.",true);
      return;
    }
    if(!file.type.startsWith("audio/")&&!/\.(mp3|m4a|wav|aac|flac|ogg|opus|webm)$/i.test(file.name)){
      status(encodeStatus,"This file doesn't look like audio. Select an audio recording.",true);
      return;
    }
    audioFile=file;resetEncode();
    revoke(sourceSrc);sourceSrc=URL.createObjectURL(file);
    el("source-player").src=sourceSrc;
    el("source-name").textContent=file.name;
    el("source-size").textContent=human(file.size)+" • exact bytes preserved (no transcoding)";
    sourceCard.hidden=false;
    status(encodeStatus,"Ready. Start with Phone-first test for your first iPhone scan.");
    update();
  }
  sourceInput.addEventListener("change",()=>{if(sourceInput.files[0])setFile(sourceInput.files[0]);});
  el("source-remove").addEventListener("click",()=>{
    audioFile=null;sourceInput.value="";sourceCard.hidden=true;
    revoke(sourceSrc);sourceSrc=null;
    el("source-player").pause();el("source-player").removeAttribute("src");
    resetEncode();status(encodeStatus,"");update();
  });
  function stopTracks(){
    if(stream){for(const track of stream.getTracks())track.stop();}
    stream=null;
  }
  function endRecording(){
    recording=false;clearInterval(clock);clock=null;stopTracks();
    const mime=recorder?.mimeType||"";
    if(!segments.length){status(encodeStatus,"No audio recorded.",true);update();return;}
    const ext=mime.includes("mp4")?".m4a":mime.includes("ogg")?".ogg":".webm";
    const file=new File([new Blob(segments,{type:mime})],"PaperBack_voice_"+Date.now()+ext,{type:mime});
    segments=[];setFile(file);status(encodeStatus,"Voice captured. Your browser's recording file will be archived exactly.");
    update();
  }
  el("record-start").addEventListener("click",async()=>{
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){
      status(encodeStatus,"Microphone recording isn't supported in this browser. Upload audio instead.",true);
      return;
    }
    try{
      stream=await navigator.mediaDevices.getUserMedia({audio:{
        echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      const mime=["audio/mp4","audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus"]
        .find(t=>MediaRecorder.isTypeSupported(t));
      recorder=new MediaRecorder(stream,mime?{mimeType:mime}:{});
      segments=[];
      recorder.ondataavailable=e=>{if(e.data?.size)segments.push(e.data);};
      recorder.onstop=endRecording;
      recorder.onerror=e=>{
        console.error(e);stopTracks();recording=false;clearInterval(clock);update();
        status(encodeStatus,"Microphone recording failed. Try again.",true);
      };
      recorder.start(500);recording=true;started=Date.now();
      el("timer").textContent="0:00";update();
      status(encodeStatus,"Recording… tap Stop when you're finished.");
      clock=setInterval(()=>{
        const t=Math.floor((Date.now()-started)/1000);
        el("timer").textContent=Math.floor(t/60)+":"+String(t%60).padStart(2,"0");
        if(t>=90&&recorder?.state==="recording")recorder.stop();
      },250);
    }catch(e){
      stopTracks();
      status(encodeStatus,e.name==="NotAllowedError"
        ?"Microphone permission denied. Allow microphone access in Safari, then retry."
        :"Couldn't open microphone. You can upload a saved recording instead.",true);
      update();
    }
  });
  el("record-stop").addEventListener("click",()=>{
    if(recorder?.state==="recording")recorder.stop();
  });
  window.addEventListener("pagehide",stopTracks);

  function onWorkerMessage(ev){
    const m=ev.data;
    if(m.type==="progress"){
      if(m.phase==="encode")status(encodeStatus,m.note||"Encoding pages…");
      if(m.phase==="decode")status(decodeStatus,"Reading page "+m.done+" of "+m.total+"…");
      return;
    }
    const call=pending;pending=null;
    if(!call)return;
    if(m.type==="error")call.reject(Error(m.message||"PaperBack engine error"));
    else call.resolve(m);
  }
  function send(message,transfers=[]){
    if(!worker)throw Error("PaperBack engine isn't loaded.");
    if(pending)throw Error("The PaperBack engine is busy.");
    return new Promise((resolve,reject)=>{
      pending={resolve,reject};
      worker.postMessage(message,transfers);
    });
  }
  function ensureEngine(){
    if(readyPromise)return readyPromise;
    readyPromise=(async()=>{
      worker=new Worker("./worker.js",{type:"module"});
      worker.onmessage=onWorkerMessage;
      worker.onerror=event=>{
        const p=pending;pending=null;
        if(p)p.reject(Error(event.message||"WebAssembly worker failed to load."));
      };
      const result=await send({type:"init"});
      return result.version;
    })().catch(e=>{
      worker?.terminate();worker=null;readyPromise=null;
      throw e;
    });
    return readyPromise;
  }
  function mimeFromName(name){
    if(/\.mp3$/i.test(name))return"audio/mpeg";
    if(/\.m4a$/i.test(name))return"audio/mp4";
    if(/\.wav$/i.test(name))return"audio/wav";
    if(/\.ogg$/i.test(name))return"audio/ogg";
    if(/\.webm$/i.test(name))return"audio/webm";
    if(/\.flac$/i.test(name))return"audio/flac";
    return"application/octet-stream";
  }
  const profiles={
    camera:{preset:"modern",paper:"letter",printerDpi:150,dotDpi:75,dotPercent:80,
      compression:"max",marginMils:500,parityPercent:20},
    inkjet:{preset:"modern",paper:"letter",printerDpi:300,dotDpi:150,dotPercent:80,
      compression:"max",marginMils:500,parityPercent:20},
    laser:{preset:"modern",paper:"letter",printerDpi:600,dotDpi:300,dotPercent:70,
      compression:"max",marginMils:500,parityPercent:20}
  };
  encodeButton.addEventListener("click",async()=>{
    if(!audioFile||busy)return;
    busy=true;update();resetEncode();
    try{
      const selected=document.querySelector('input[name="profile"]:checked')?.value||"camera";
      status(encodeStatus,"Loading PaperBack's WebAssembly engine…");
      const version=await ensureEngine();
      status(encodeStatus,"Reading "+human(audioFile.size)+" of original audio bytes…");
      const data=new Uint8Array(await audioFile.arrayBuffer());
      const response=await send({type:"encode",name:audioFile.name,bytes:data,
        settings:profiles[selected]},[data.buffer]);
      pdfSrc=URL.createObjectURL(new Blob([response.pdf],{type:"application/pdf"}));
      previewSrc=response.preview?.length?
        URL.createObjectURL(new Blob([response.preview],{type:"image/png"})):null;
      if(previewSrc)el("preview-image").src=previewSrc;
      el("preview-image").hidden=!previewSrc;
      el("pdf-download").href=pdfSrc;
      el("pdf-download").download="PaperBack_"+audioFile.name.replace(/[^a-z0-9_.-]/gi,"_")+".pdf";
      el("encode-summary").textContent=human(audioFile.size)+" archived on "+
        response.pageCount+" printable page(s) • "+human(response.pdf.length)+" PDF • paperback.rs "+version;
      encodeResult.hidden=false;
      status(encodeStatus,"Success. Now test recovery: open Recover audio and upload this PDF. Physical iPhone photo scanning is a separate test.");
    }catch(e){
      console.error("PaperBack encode",e);
      status(encodeStatus,"Could not generate archive: "+e.message,true);
    }finally{busy=false;update();}
  });

  function displayScans(){
    const list=el("scan-list");
    list.replaceChildren();
    if(!scans.length){list.textContent="No scans selected.";return;}
    scans.forEach((file,index)=>{
      const row=document.createElement("div");
      row.textContent=(index+1)+". "+file.name+" ("+human(file.size)+")";
      list.append(row);
    });
  }
  function addScans(files){
    const currentSize=scans.reduce((t,f)=>t+f.size,0);
    let added=0,size=currentSize;
    for(const file of files){
      if(!file.size||!(/\.(pdf|png|jpe?g|bmp|webp|heic|heif)$/i.test(file.name)||file.type.startsWith("image/")))continue;
      if(size+file.size>MAX_SCAN||scans.length>=35){
        status(decodeStatus,"Scan limit: 35 files and 70 MB total. Try smaller batches or the original PDF.",true);break;
      }
      if(scans.some(f=>f.name===file.name&&f.size===file.size&&f.lastModified===file.lastModified))continue;
      scans.push(file);size+=file.size;added++;
    }
    resetDecode();displayScans();update();
    if(added)status(decodeStatus,scans.length+" file(s) selected. Include all pages before decoding.");
  }
  el("clear-scans").addEventListener("click",()=>{
    if(busy)return;
    scans=[];scanInput.value="";cameraInput.value="";
    displayScans();resetDecode();status(decodeStatus,"");update();
  });
  scanInput.addEventListener("change",()=>{
    addScans(Array.from(scanInput.files||[]));scanInput.value="";
  });
  cameraInput.addEventListener("change",()=>{
    addScans(Array.from(cameraInput.files||[]));cameraInput.value="";
  });
  async function fallbackImageBytes(file){
    // The Rust reader understands JPEG/PNG but not iPhone's HEIC/HEIF.
    // Safari can sometimes decode them itself; then convert only those files.
    const url=URL.createObjectURL(file);
    try{
      const img=new Image();img.src=url;await img.decode();
      const canvas=document.createElement("canvas");
      canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
      canvas.getContext("2d").drawImage(img,0,0);
      const blob=await new Promise((resolve,reject)=>
        canvas.toBlob(b=>b?resolve(b):reject(Error("Image conversion failed.")),"image/png"));
      canvas.width=canvas.height=0;
      return new Uint8Array(await blob.arrayBuffer());
    } finally{URL.revokeObjectURL(url);}
  }
  decodeButton.addEventListener("click",async()=>{
    if(!scans.length||busy)return;
    busy=true;update();resetDecode();
    try{
      status(decodeStatus,"Loading high-density PaperBack decoder…");
      await ensureEngine();
      await send({type:"clear"});
      let pages=0;
      for(let i=0;i<scans.length;i++){
        const file=scans[i];
        status(decodeStatus,"Loading scan "+(i+1)+"/"+scans.length+": "+file.name);
        let response;
        try{
          const bytes=new Uint8Array(await file.arrayBuffer());
          response=await send({type:"addImage",bytes},[bytes.buffer]);
        }catch(e){
          if(!file.type.startsWith("image/"))throw Error(file.name+": "+e.message);
          const fallback=await fallbackImageBytes(file);
          response=await send({type:"addImage",bytes:fallback},[fallback.buffer]);
        }
        pages+=response.count;
      }
      if(!pages)throw Error("No recognizable PaperBack pages were found.");
      status(decodeStatus,"Analyzing "+pages+" page(s) with Reed–Solomon error correction…");
      const output=await send({type:"decode"});
      if(!output.result?.compatible)
        throw Error(output.result?.error||"The pages could not be recovered. Try flatter, sharper photos or a higher-resolution scanner.");
      const filename=(output.result.fileName||"PaperBack_restored_audio.mp3")
        .replace(/[\/\\\x00-\x1f]/g,"_");
      const type=mimeFromName(filename);
      const original=new Blob([output.bytes],{type});
      recoveredSrc=URL.createObjectURL(original);
      el("recovered-player").src=recoveredSrc;
      el("recovered-download").href=recoveredSrc;
      el("recovered-download").download=filename;
      el("decode-summary").textContent=filename+" • "+human(original.size)+
        " • "+pages+" page(s) read • original bytes restored, no audio transcoding";
      decodeResult.hidden=false;
      status(decodeStatus,"Success! The original file was recovered. Download it and listen.");
    }catch(e){
      console.error("PaperBack decode",e);
      status(decodeStatus,"Could not restore: "+e.message,true);
    }finally{busy=false;update();}
  });
  update();
})();
