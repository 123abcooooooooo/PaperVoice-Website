"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const input = $("source-audio"), micStart = $("record-start"), micStop = $("record-stop");
  const convert = $("make-qr"), report = $("create-status"), busy = $("create-progress");
  const preview = $("create-preview"), sourcePlayer = $("source-preview"), sourceInfo = $("source-info");
  const pdfButton = $("download-sheet"), clearButton = $("discard-audio"), modeInput = $("encoding-mode"), estimate = $("exact-estimate");
  const MAX_SECONDS = 90, MAX_BYTES = 28 * 1024 * 1024, CHUNK_BYTES = 850, MAX_CODES = 60;
  const EXACT_CODES_PER_PAGE = 12, MAX_EXACT_CODES = 480;
  const BASE45 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
  const C2_HEADER = Uint8Array.from([0xC0,0xDE,0xC2,0x00,0x08,0x04,0x00]);
  let mediaRecorder = null, activeStream = null, segments = [];
  let recordedAt = 0, timerId = null;
  let audioFile = null, fileURL = null, sheets = null;
  let recording = false, making = false;
  const sleep = () => new Promise(resolve => setTimeout(resolve, 0));

  function stateMessage(message, error=false) {
    report.textContent = message;
    report.className = error ? "status error" : "status";
  }

  function updateButtons() {
    convert.disabled = !audioFile || making || recording || (modeInput.value === "exact" && (1+Math.ceil(audioFile.size/CHUNK_BYTES) > MAX_EXACT_CODES));
    micStart.disabled = recording || making;
    micStop.disabled = !recording;
    clearButton.hidden = !audioFile || recording;
    input.disabled = recording || making;
    modeInput.disabled = recording || making;
  }

  function revokePreview() {
    if (fileURL) URL.revokeObjectURL(fileURL);
    fileURL = null;
    sourcePlayer.pause();
    sourcePlayer.removeAttribute("src");
    sourcePlayer.load();
  }

  function resetQr() {
    preview.hidden = true;
    $("qr-list").replaceChildren();
    pdfButton.disabled = true;
    sheets = null;
    busy.textContent = "";
  }

  function setSource(file) {
    if (recording) return;
    if (!file) return;
    if (file.size > MAX_BYTES) {
      stateMessage("The audio file is too large (28 MB maximum). Try a shorter recording.", true);
      return;
    }
    if (file.size === 0) { stateMessage("This file contains no audio.", true); return; }
    audioFile = file;
    resetQr();
    revokePreview();
    fileURL = URL.createObjectURL(file);
    sourcePlayer.src = fileURL;
    sourceInfo.textContent = file.name + " · " + (file.size / 1048576).toFixed(1) + " MB";
    sourcePlayer.hidden = false;
    showEstimate();
    stateMessage("Ready. Select your preferred encoding quality and create the QR sheet.");
    updateButtons();
  }


  function showEstimate() {
    if (!audioFile) { estimate.textContent=""; return; }
    if (modeInput.value !== "exact") {
      estimate.textContent="Ultra-small speech mode reduces the recording with lossy Codec 2 compression. It will NOT sound like the original.";
      return;
    }
    const codeCount = 1 + Math.ceil(audioFile.size / CHUNK_BYTES);
    const pages = Math.ceil(codeCount / EXACT_CODES_PER_PAGE);
    estimate.textContent = "Bit-perfect original file • " + audioFile.size.toLocaleString() +
      " bytes • " + codeCount.toLocaleString() + " QR codes • about " +
      pages.toLocaleString() + " printed page(s)." +
      (codeCount > MAX_EXACT_CODES ? " This exceeds the current 40-page browser limit. The original file is too large for exact offline printing here." :
      pages > 10 ? " This is a lot of paper; every page is needed to recover the audio." : "");
    convert.disabled = codeCount > MAX_EXACT_CODES || making || recording;
  }
  modeInput.addEventListener("change", () => {
    resetQr();
    if (audioFile) { showEstimate(); stateMessage(""); }
    updateButtons();
    if (audioFile && modeInput.value === "exact") showEstimate();
  });

  async function exactQRs(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const chunks = Math.ceil(bytes.length / CHUNK_BYTES);
    if (chunks + 1 > MAX_EXACT_CODES)
      throw Error("Exact original requires " + Math.ceil((chunks+1)/EXACT_CODES_PER_PAGE) +
        " pages. This website currently supports up to 40 pages per exact recording.");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const sha = Array.from(digest, n => n.toString(16).padStart(2, "0")).join("").toUpperCase();
    const id = sha.slice(0,12);
    const meta = { name:file.name.slice(0,120), mime:file.type||"application/octet-stream",
      size:file.size, sha256:sha };
    const manifest = new TextEncoder().encode(JSON.stringify(meta));
    const countText = String(chunks).padStart(4,"0");
    const qrCodes = [];
    function add(index,mode,payload){
      const data = "PV2:"+mode+":"+id+":"+
        String(index).padStart(4,"0")+":"+countText+":"+base45encode(payload);
      const qr = qrcode(0,"M");
      qr.addData(data,"Alphanumeric");
      qr.make();
      qrCodes.push(qr);
    }
    add(0,"M",manifest);
    for (let i=0;i<chunks;i++) {
      add(i+1,"F",bytes.slice(i*CHUNK_BYTES,(i+1)*CHUNK_BYTES));
      if (i%8===7){
        busy.textContent = "Writing exact audio: "+(i+1)+"/"+chunks+" data codes";
        await sleep();
      }
    }
    return {id,codes:qrCodes,mode:"exact",size:bytes.length,filename:file.name};
  }

  input.addEventListener("change", () => {
    const f = input.files && input.files[0];
    if (f) setSource(f);
  });
  clearButton.addEventListener("click", () => {
    audioFile = null; input.value = ""; revokePreview(); resetQr();
    sourcePlayer.hidden = true; sourceInfo.textContent = ""; estimate.textContent = ""; stateMessage(""); updateButtons();
  });

  function stopTracks() {
    if (activeStream) for (const track of activeStream.getTracks()) track.stop();
    activeStream = null;
  }
  function finishRecording() {
    clearInterval(timerId); timerId = null; stopTracks();
    recording = false; updateButtons();
    if (!segments.length) {stateMessage("Recording stopped without audio.", true); return;}
    const mime = mediaRecorder?.mimeType || "";
    const ext = mime.includes("mp4") ? ".m4a" : mime.includes("ogg") ? ".ogg" : ".webm";
    const file = new File([new Blob(segments, {type:mime})],
      "PaperVoice_recording_" + new Date().toISOString().replace(/[:.]/g,"-") + ext, {type:mime});
    segments = [];
    setSource(file);
    stateMessage("Recording captured. Tap Create QR codes to encode it.");
  }
  micStart.addEventListener("click", async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      stateMessage("This browser does not support microphone recording. Use Upload audio instead.", true);
      return;
    }
    try {
      activeStream = await navigator.mediaDevices.getUserMedia({
        audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}
      });
      const types = ["audio/mp4","audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus"];
      const mime = types.find(t => MediaRecorder.isTypeSupported(t));
      mediaRecorder = new MediaRecorder(activeStream, mime ? {mimeType:mime} : {});
      segments = [];
      mediaRecorder.ondataavailable = e => { if (e.data?.size) segments.push(e.data); };
      mediaRecorder.onerror = e => {
        console.error("MediaRecorder",e);
        stateMessage("The microphone recording was interrupted. Try again.", true);
        stopTracks(); clearInterval(timerId); recording=false; updateButtons();
      };
      mediaRecorder.onstop = finishRecording;
      mediaRecorder.start(250);
      recording = true;
      recordedAt = Date.now();
      stateMessage("Recording… use Stop when finished. Limit: 90 seconds.");
      resetQr(); updateButtons();
      $("record-timer").textContent = "0:00";
      timerId = setInterval(() => {
        const t = Math.floor((Date.now() - recordedAt)/1000);
        $("record-timer").textContent = Math.floor(t/60) + ":" + String(t%60).padStart(2,"0");
        if (t >= MAX_SECONDS && mediaRecorder?.state === "recording") mediaRecorder.stop();
      }, 200);
    } catch(error) {
      stopTracks();
      stateMessage(error?.name === "NotAllowedError"
        ? "Microphone permission was denied. Allow microphone access in your browser settings."
        : "Could not access the microphone. Try Upload audio instead.", true);
    }
  });
  micStop.addEventListener("click", () => {
    if (recording && mediaRecorder?.state === "recording") mediaRecorder.stop();
  });
  window.addEventListener("pagehide", stopTracks);

  async function readPCM(file) {
    const bytes = await file.arrayBuffer();
    const context = new (window.AudioContext || window.webkitAudioContext)();
    let buffer;
    try {
      buffer = await context.decodeAudioData(bytes.slice(0));
    } catch(error) {
      throw Error("This browser cannot read that audio format. Try MP3, M4A, or WAV, or record directly.");
    } finally { await context.close(); }
    const duration = buffer.duration;
    if (duration < .25) throw Error("The audio is too short. Record at least a quarter of a second.");
    if (duration > MAX_SECONDS + .05)
      throw Error("This version supports recordings up to 90 seconds. Shorten the audio and try again.");
    const channels = [];
    for (let c=0; c<buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
    const targetLength = Math.ceil(duration * 8000 / 320) * 320;
    const pcm = new Uint8Array(targetLength * 2);
    const view = new DataView(pcm.buffer);
    // Interpolation and downmix to signed 16-bit, mono 8 kHz. Codec 2 1300 is
    // speech-specific; music can sound heavily distorted or robotic.
    for (let i=0; i<targetLength; i++) {
      const position = i * buffer.sampleRate / 8000;
      const left = Math.min(buffer.length-1, Math.floor(position));
      const right = Math.min(buffer.length-1,left+1);
      const frac = Math.min(1,Math.max(0,position-left));
      let value=0;
      for (const samples of channels)
        value += (samples[left]*(1-frac)+samples[right]*frac)/channels.length;
      const fixed = Math.round(Math.max(-1,Math.min(1,value))* (value<0?32768:32767));
      view.setInt16(i*2,fixed,true);
    }
    return {pcm,duration};
  }

  async function codec2Encode(pcm) {
    if (typeof window.createC2Enc !== "function")
      throw Error("The Codec 2 encoder library did not load. Check your internet connection and refresh.");
    const raw = await new Promise((resolve,reject) => {
      let finished = false;
      const module = {
        arguments:["1300","input.raw","output.bit"],
        locateFile:name => "https://cdn.jsdelivr.net/gh/rameshvarun/codec2-emscripten@main/build/"+name,
        preRun:() => module.FS.writeFile("input.raw",pcm),
        postRun:() => {
          try { finished = true; resolve(module.FS.readFile("output.bit").slice()); }
          catch(e) { reject(e); }
        },
        printErr: msg => console.warn("Codec2 encoder:",msg)
      };
      try {
        Promise.resolve(window.createC2Enc(module)).then(() => {
          if (!finished) reject(Error("The speech encoder did not produce a recording."));
        }).catch(reject);
      } catch(e) { reject(e); }
    });
    if (!raw.length || raw.length % 7 !== 0)
      throw Error("The compressed speech has an invalid frame length.");
    // FFmpeg Codec2 container: fixed 7-byte header followed by mode 1300 frames.
    const wrapped = new Uint8Array(C2_HEADER.length+raw.length);
    wrapped.set(C2_HEADER); wrapped.set(raw,C2_HEADER.length);
    return wrapped;
  }

  function base45encode(input) {
    const result=[];
    for (let i=0;i<input.length;i+=2) {
      const num = i+1<input.length ? input[i]*256+input[i+1] : input[i];
      result.push(BASE45[num%45],BASE45[Math.floor(num/45)%45]);
      if (i+1<input.length) result.push(BASE45[Math.floor(num/2025)]);
    }
    return result.join("");
  }

  async function toQRSheets(bytes) {
    if (!window.qrcode) throw Error("QR generator did not load. Refresh the website.");
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
    const id = Array.from(hash.slice(0,6), b => b.toString(16).padStart(2,"0")).join("").toUpperCase();
    const count = Math.ceil(bytes.length / CHUNK_BYTES);
    if (count>MAX_CODES) throw Error("This recording needs too many QR codes. Please shorten it.");
    const result=[];
    for (let part=0;part<count;part++) {
      const payload = bytes.slice(part*CHUNK_BYTES,(part+1)*CHUNK_BYTES);
      const string = "PV1:T:"+id+":"+
        String(part+1).padStart(3,"0")+":"+String(count).padStart(3,"0")+":"+
        base45encode(payload);
      const qr=qrcode(0,"M");
      qr.addData(string,"Alphanumeric");
      try { qr.make(); } catch(error) { throw Error("QR message too dense. Shorten the recording."); }
      result.push(qr);
      if (part%4===3) {
        busy.textContent="Making QR codes: "+(part+1)+" / "+count;
        await sleep();
      }
    }
    return {id, codes:result, mode:"tiny", size:bytes.length};
  }

  function renderCanvas(qr,scale=4) {
    const count=qr.getModuleCount(),quiet=4;
    const canvas=document.createElement("canvas");
    canvas.width=canvas.height=(count+quiet*2)*scale;
    const ctx=canvas.getContext("2d");
    ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle="#000";
    for(let row=0;row<count;row++) for(let col=0;col<count;col++)
      if(qr.isDark(row,col)) ctx.fillRect((col+quiet)*scale,(row+quiet)*scale,scale,scale);
    return canvas;
  }

  function downloadPDF() {
    if (!sheets || !window.jspdf?.jsPDF) {
      stateMessage("The PDF library is not available. Check the connection and reload.",true);
      return;
    }
    try {
      const exact = sheets.mode === "exact";
      const perPage = exact ? EXACT_CODES_PER_PAGE : 4;
      const pdf = new window.jspdf.jsPDF({unit:"pt",format:"letter",compress:true});
      const count=sheets.codes.length, totalPages=Math.ceil(count/perPage);
      for(let page=0;page<totalPages;page++){
        if(page)pdf.addPage();
        pdf.setFont("helvetica","bold");pdf.setFontSize(17);
        pdf.text("PAPERVOICE",26,32);
        pdf.setFont("helvetica","normal");pdf.setFontSize(9);
        pdf.text(exact?"EXACT ORIGINAL - bit-for-bit audio data":"Tiny Codec 2 - compressed speech",26,48);
        pdf.text("ID: "+sheets.id+" | Page "+(page+1)+"/"+totalPages,26,63);
        for(let slot=0;slot<perPage;slot++){
          const index=page*perPage+slot;
          if(index>=count)break;
          const qr=sheets.codes[index];
          const box=exact?154:238;
          const x=exact?([26,229,432][slot%3]):(slot%2===0?37:337);
          const y=exact?([83,249,415,581][Math.floor(slot/3)]):(slot<2?92:421);
          const image=renderCanvas(qr,exact?6:8);
          pdf.addImage(image.toDataURL("image/png"),"PNG",x,y,box,box);
          image.width=image.height=0;
          pdf.setFontSize(exact?8:10);pdf.setTextColor(30);
          pdf.text("QR "+(index+1)+" / "+count,x+box/2,y+box+13,{align:"center"});
        }
        pdf.setTextColor(95);pdf.setFontSize(8);
        pdf.text(exact?"Every QR is required. Audio file bytes are stored exactly as supplied.":"Every QR is required. Audio is stored in these codes, not on a server.",26,777);
        pdf.setTextColor(0);
      }
      pdf.save("PaperVoice_"+sheets.id+".pdf");
    } catch(error){
      console.error(error);
      stateMessage("Could not save the PDF on this device. Try a shorter recording or a desktop browser.",true);
    }
  }

  pdfButton.addEventListener("click", downloadPDF);

  convert.addEventListener("click", async () => {
    if(!audioFile || making || recording)return;
    making=true;updateButtons();resetQr();stateMessage("");
    try {
      if(modeInput.value === "exact") {
        busy.textContent="Preserving the original file bytes exactly…";
        await sleep();
        sheets=await exactQRs(audioFile);
      } else {
        busy.textContent="Reading audio…";
        await sleep();
        const {pcm,duration}=await readPCM(audioFile);
        busy.textContent="Compressing speech with Codec 2 (lossy)…";
        await sleep();
        const data=await codec2Encode(pcm);
        busy.textContent="Generating tiny speech QR codes…";
        await sleep();
        sheets=await toQRSheets(data);
        sheets.duration=duration;
      }
      const entries=$("qr-list");
      entries.replaceChildren();
      const visible = Math.min(sheets.codes.length, 12);
      for(let i=0;i<visible;i++) {
        const item=document.createElement("figure");
        item.className="qr-item";
        const canvas=renderCanvas(sheets.codes[i],3);
        const label=document.createElement("figcaption");
        label.textContent="QR "+(i+1)+" of "+sheets.codes.length;
        item.append(canvas,label);
        entries.append(item);
      }
      const count=sheets.codes.length;
      const pages=Math.ceil(count/(sheets.mode==="exact"?EXACT_CODES_PER_PAGE:4));
      $("qr-summary").textContent=sheets.mode==="exact"
        ? "BIT-PERFECT • "+sheets.filename+" • "+sheets.size.toLocaleString()+
          " bytes • "+count+" QR codes • "+pages+" printed page(s) • SHA-256 checked on recovery."
        : sheets.duration.toFixed(1)+" seconds • "+sheets.size.toLocaleString()+
          " bytes (lossy Codec 2) • "+count+" QR codes • "+pages+" page(s).";
      if(count>visible){
        const text=document.createElement("p");
        text.textContent="Showing the first "+visible+" QR codes only; all "+count+
          " will be included in the PDF.";
        entries.append(text);
      }
      preview.hidden=false;
      pdfButton.disabled=false;
      stateMessage(sheets.mode === "exact"
        ? "Success: the original audio file was encoded with ZERO re-encoding or quality loss. All printed pages are required."
        : "Ready: QR sheet created using lossy Codec 2 compression.");
    } catch(error) {
      console.error(error);
      stateMessage(error?.message||"Audio encoding failed.",true);
    } finally {
      busy.textContent="";
      making=false;updateButtons();
    }
  });
  updateButtons();
})();
