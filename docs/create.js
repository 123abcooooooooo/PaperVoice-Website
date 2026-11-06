"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const input = $("source-audio"), micStart = $("record-start"), micStop = $("record-stop");
  const convert = $("make-qr"), report = $("create-status"), busy = $("create-progress");
  const preview = $("create-preview"), sourcePlayer = $("source-preview"), sourceInfo = $("source-info");
  const pdfButton = $("download-sheet"), clearButton = $("discard-audio");
  const MAX_SECONDS = 90, MAX_BYTES = 28 * 1024 * 1024, CHUNK_BYTES = 850, MAX_CODES = 60;
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
    convert.disabled = !audioFile || making || recording;
    micStart.disabled = recording || making;
    micStop.disabled = !recording;
    clearButton.hidden = !audioFile || recording;
    input.disabled = recording || making;
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
    stateMessage("Ready. Create a printable QR message from your recording.");
    updateButtons();
  }

  input.addEventListener("change", () => {
    const f = input.files && input.files[0];
    if (f) setSource(f);
  });
  clearButton.addEventListener("click", () => {
    audioFile = null; input.value = ""; revokePreview(); resetQr();
    sourcePlayer.hidden = true; sourceInfo.textContent = ""; stateMessage(""); updateButtons();
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
    return {id, codes:result};
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
      const pdf=new window.jspdf.jsPDF({unit:"pt",format:"letter",compress:true});
      const count=sheets.codes.length;
      const totalPages=Math.ceil(count/4);
      // 2 x 2 per US Letter page with full 4-module quiet zones.
      for(let page=0;page<totalPages;page++) {
        if(page) pdf.addPage();
        pdf.setFont("helvetica","bold");pdf.setFontSize(17);
        pdf.text("PAPERVOICE",42,39);
        pdf.setFont("helvetica","normal");pdf.setFontSize(10);
        pdf.text("Scan all QR codes to hear this printed recording.",42,56);
        pdf.text("ID: "+sheets.id+" | Page "+(page+1)+" of "+totalPages,42,72);
        for(let slot=0;slot<4;slot++) {
          const index=page*4+slot;
          if(index>=count)break;
          const qr=sheets.codes[index];
          const box=238, x=slot%2===0?37:337, y=slot<2?92:421;
          // Embed a lossless, high-resolution QR bitmap including the full
          // four-module quiet zone. This is more reliable to scan after
          // PDF rendering/printing than many adjacent vector rectangles.
          const picture=renderCanvas(qr,8);
          pdf.addImage(picture.toDataURL("image/png"),"PNG",x,y,box,box);
          picture.width=picture.height=0;
          pdf.setFontSize(10);pdf.setTextColor(30);
          pdf.text("QR "+(index+1)+" / "+count,x+box/2,y+box+17,{align:"center"});
        }
        pdf.setTextColor(95);pdf.setFontSize(9);
        pdf.text("Voice data is stored in these codes (not an internet link). Keep every page.",
          42,770);
        pdf.setTextColor(0);
      }
      pdf.save("PaperVoice_"+sheets.id+".pdf");
    } catch(error) {
      console.error(error);
      stateMessage("Could not save the PDF on this browser. Try Safari's Share or a computer.",true);
    }
  }

  pdfButton.addEventListener("click", downloadPDF);

  convert.addEventListener("click", async () => {
    if(!audioFile || making || recording)return;
    making=true;updateButtons();resetQr();stateMessage("");
    try {
      busy.textContent="Reading audio…";
      await sleep();
      const {pcm,duration}=await readPCM(audioFile);
      busy.textContent="Compressing speech with Codec 2…";
      await sleep();
      const data=await codec2Encode(pcm);
      busy.textContent="Encoding the compressed audio into QR codes…";
      await sleep();
      sheets=await toQRSheets(data);
      const entries=$("qr-list");
      entries.replaceChildren();
      for(let i=0;i<sheets.codes.length;i++) {
        const item=document.createElement("figure");
        item.className="qr-item";
        const canvas=renderCanvas(sheets.codes[i],3);
        const label=document.createElement("figcaption");
        label.textContent="QR "+(i+1)+" of "+sheets.codes.length;
        item.append(canvas,label);
        entries.append(item);
      }
      $("qr-summary").textContent=duration.toFixed(1)+" seconds • "+
        data.length.toLocaleString()+" compressed bytes • "+sheets.codes.length+
        " QR codes • "+Math.ceil(sheets.codes.length/4)+" printable page(s)";
      preview.hidden=false;
      pdfButton.disabled=false;
      stateMessage("Ready! Your voice is encoded inside the QR patterns. Download the PDF to print or share.");
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
