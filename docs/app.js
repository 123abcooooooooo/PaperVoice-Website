"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const picker = $("picker"), drop = $("drop"), list = $("files"), decodeButton = $("decode");
  const clearButton = $("clear"), status = $("status"), output = $("output"), audio = $("audio");
  const download = $("download"), info = $("info"), progress = $("progress");
  const B45 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
  const B45_INDEX = Object.fromEntries([...B45].map((ch, i) => [ch, i]));
  const QR_PATTERN = /^PV1:([TO]):([0-9A-F]{12}):([0-9]{3}):([0-9]{3}):([0-9A-Z $%*+\-./:]*)$/;
  const EXACT_PATTERN = /^PV2:([MF]):([0-9A-F]{12}):([0-9]{4}):([0-9]{4}):([0-9A-Z $%*+\-./:]*)$/;
  let files = [];
  let resultURL = null;
  const setStatus = (message, error = false) => {
    status.textContent = message;
    status.className = error ? "status error" : "status";
  };
  const yieldUI = () => new Promise(resolve => setTimeout(resolve, 0));

  const formatSize = bytes => bytes < 1048576
    ? Math.ceil(bytes / 1024) + " KB" : (bytes / 1048576).toFixed(1) + " MB";

  function refreshFiles() {
    list.replaceChildren();
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const row = document.createElement("div");
      row.className = "file";
      const title = document.createElement("span");
      title.className = "filename";
      title.textContent = file.name;
      const size = document.createElement("small");
      size.textContent = formatSize(file.size);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", "Remove " + file.name);
      remove.addEventListener("click", () => {
        files.splice(i, 1);
        resetOutput();
        refreshFiles();
      });
      row.append(title, size, remove);
      list.appendChild(row);
    }
    decodeButton.disabled = files.length === 0;
    clearButton.hidden = files.length === 0;
  }

  function resetOutput() {
    if (resultURL) URL.revokeObjectURL(resultURL);
    resultURL = null;
    audio.removeAttribute("src");
    audio.load();
    download.removeAttribute("href");
    output.hidden = true;
    setStatus("");
    progress.textContent = "";
  }

  function addFiles(incoming) {
    let rejected = 0;
    for (const file of incoming) {
      if (!/\.(png|jpe?g|webp|pdf)$/i.test(file.name) || file.size > 25 * 1024 * 1024) {
        rejected++;
        continue;
      }
      if (files.length >= 24) { rejected++; continue; }
      if (!files.some(f => f.name === file.name && f.size === file.size &&
                            f.lastModified === file.lastModified)) files.push(file);
    }
    resetOutput();
    refreshFiles();
    if (rejected) setStatus("Some files were skipped. Use JPG, PNG, WebP or PDF (up to 25 MB each, 24 files total).", true);
  }

  drop.addEventListener("click", () => picker.click());
  drop.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); picker.click(); }
  });
  picker.addEventListener("change", () => {
    addFiles(Array.from(picker.files || []));
    picker.value = "";
  });
  for (const name of ["dragenter", "dragover"])
    drop.addEventListener(name, event => { event.preventDefault(); drop.classList.add("dragging"); });
  for (const name of ["dragleave", "drop"])
    drop.addEventListener(name, event => { event.preventDefault(); drop.classList.remove("dragging"); });
  drop.addEventListener("drop", event => addFiles(Array.from(event.dataTransfer.files || [])));
  clearButton.addEventListener("click", () => { files = []; resetOutput(); refreshFiles(); });

  function b45decode(input) {
    if (input.length % 3 === 1) throw new Error("A QR code contains damaged Base45 data.");
    const decoded = new Uint8Array(Math.ceil(input.length * 2 / 3));
    let dest = 0;
    for (let i = 0; i < input.length;) {
      let value;
      if (i + 2 < input.length) {
        value = B45_INDEX[input[i]] + 45 * B45_INDEX[input[i+1]] + 2025 * B45_INDEX[input[i+2]];
        if (!Number.isInteger(value) || value > 65535) throw new Error("Corrupt QR payload.");
        decoded[dest++] = value >> 8;
        decoded[dest++] = value & 255;
        i += 3;
      } else {
        value = B45_INDEX[input[i]] + 45 * B45_INDEX[input[i+1]];
        if (!Number.isInteger(value) || value > 255) throw new Error("Corrupt QR payload.");
        decoded[dest++] = value;
        i += 2;
      }
    }
    return decoded.slice(0, dest);
  }

  async function rebuild(codes) {
    const parts = new Map();
    let group = null, kind = null, count = null;
    for (const code of codes) {
      const parsed = QR_PATTERN.exec(code);
      if (!parsed) continue;
      const [, mode, id, indexText, totalText, payload] = parsed;
      const index = Number(indexText), total = Number(totalText);
      if (!total || index < 1 || index > total) throw new Error("Invalid QR sequence number.");
      if (!group) { group = id; kind = mode; count = total; }
      if (id !== group || kind !== mode || count !== total)
        throw new Error("These codes belong to different recordings. Upload only one recording.");
      const bytes = b45decode(payload);
      if (parts.has(index)) {
        const prior = parts.get(index);
        if (prior.length !== bytes.length || prior.some((v,i) => v !== bytes[i]))
          throw new Error("QR " + index + " has conflicting copies.");
      } else parts.set(index, bytes);
    }
    if (!group) throw new Error("No PaperVoice QR codes found. Try sharper photos or the original PDF.");
    const missing = [];
    for (let i = 1; i <= count; i++) if (!parts.has(i)) missing.push(i);
    if (missing.length) throw new Error("Found " + parts.size + "/" + count +
      " codes. Missing QR number(s): " + missing.join(", ") + ".");
    const size = Array.from(parts.values()).reduce((n, a) => n + a.length, 0);
    if (size > 3 * 1024 * 1024) throw new Error("Audio payload too large for this browser.");
    const bytes = new Uint8Array(size);
    let position = 0;
    for (let i = 1; i <= count; i++) {
      const chunk = parts.get(i);
      bytes.set(chunk, position);
      position += chunk.length;
    }
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    const actual = Array.from(new Uint8Array(hash).slice(0,6), b => b.toString(16).padStart(2,"0")).join("").toUpperCase();
    if (actual !== group) throw new Error("Audio checksum failed. Please rescan the blurry QR code.");
    return { kind, id: group, count, bytes };
  }

  // PV2 exact audio stores the original file bytes, not newly encoded audio.
  // QR 0000 is a JSON manifest; QRs 0001...N carry the original file bytes.
  // SHA-256 verifies byte-for-byte identity before the file is released.
  async function rebuildExact(codes) {
    let id=null,total=null,manifest=null;
    const chunks=new Map();
    for(const code of codes){
      const match=EXACT_PATTERN.exec(code);
      if(!match) continue;
      const [,type,hash,indexText,totalText,payload]=match;
      const number=Number(indexText),n=Number(totalText);
      if(!n||n>479||number>n)throw Error("Invalid exact-audio sequence.");
      if(id===null){id=hash;total=n;}
      if(hash!==id||total!==n)throw Error("Different PaperVoice recordings were mixed.");
      const bytes=b45decode(payload);
      const key=number;
      if(type==="M" && number!==0 || type==="F" && number===0)
        throw Error("Invalid exact-audio file manifest.");
      if(chunks.has(key)){
        const existing=chunks.get(key);
        if(existing.length!==bytes.length || existing.some((b,i)=>b!==bytes[i]))
          throw Error("Conflicting QR "+number+"; rescan this page.");
      } else chunks.set(key,bytes);
    }
    if(!id) throw Error("No exact-audio QR codes found.");
    const missing=[];
    for(let i=0;i<=total;i++)if(!chunks.has(i))missing.push(i);
    if(missing.length)
      throw Error("Missing "+missing.length+" code(s) including "+
        missing.slice(0,15).map(i=>i===0?"manifest":String(i)).join(", ")+
        ". Every QR from the printed document is required.");
    try{
      manifest=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(chunks.get(0)));
    }catch(e){throw Error("The file manifest was damaged. Rescan the first QR.");}
    if(!manifest||!Number.isSafeInteger(manifest.size)||
       manifest.size<1||manifest.size>480*850||
       !/^[0-9A-F]{64}$/.test(manifest.sha256||"") ||
       typeof manifest.name!=="string")
       throw Error("Invalid exact-original audio file manifest.");
    const bytes=new Uint8Array(manifest.size);
    let offset=0;
    for(let i=1;i<=total;i++){
      const part=chunks.get(i);
      if(offset+part.length>bytes.length)throw Error("Audio file length mismatch.");
      bytes.set(part,offset);offset+=part.length;
    }
    if(offset!==bytes.length)throw Error("Audio file incomplete.");
    const sha=new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
    const actual=Array.from(sha,b=>b.toString(16).padStart(2,"0")).join("").toUpperCase();
    if(actual!==manifest.sha256 || !actual.startsWith(id))
      throw Error("Checksum mismatch. A QR code was damaged; the original file was not reconstructed.");
    const safeName=manifest.name.replace(/[\/\\\x00-\x1F]/g,"_").slice(0,120)||"PaperVoice_original.bin";
    const mime=typeof manifest.mime==="string"&&manifest.mime.startsWith("audio/") ?
      manifest.mime : "application/octet-stream";
    return {id,count:total+1,bytes,filename:safeName,mime};
  }

  // ZXing reads one QR at a time. For full-page PDFs we crop into overlapping
  // cells so all 2x3 codes can be decoded without a server or camera permissions.

  // The original four very dense v25 QR codes are far more reliable in ZBar's
  // WebAssembly reader than in ZXing. ZBar can also find several codes per image.
  async function scanWithZbar(canvas) {
    if (!window.zbarWasm?.scanImageData) return [];
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const picture = context.getImageData(0, 0, canvas.width, canvas.height);
    const results = await window.zbarWasm.scanImageData(picture);
    return results.map(result => result.decode()).filter(text => /^PV[12]:/.test(text));
  }

  function tryZxing(canvas) {
    if (!window.ZXing) return null;
    try {
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const source = new ZXing.RGBLuminanceSource(image.data, canvas.width, canvas.height);
      const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(source));
      const hints = new Map();
      hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
      return new ZXing.QRCodeReader().decode(bitmap, hints).getText();
    } catch (_) {
      return null;
    }
  }

  function crop(source, x, y, w, h) {
    const canvas = document.createElement("canvas");
    const px = Math.floor(source.width * x), py = Math.floor(source.height * y);
    const pw = Math.min(source.width - px, Math.ceil(source.width * w));
    const ph = Math.min(source.height - py, Math.ceil(source.height * h));
    canvas.width = pw; canvas.height = ph;
    canvas.getContext("2d", { willReadFrequently: true })
      .drawImage(source, px, py, pw, ph, 0, 0, pw, ph);
    return canvas;
  }

  async function readCanvas(canvas, exactPage=false) {
    const seen = new Set();
    const add = text => { if (/^PV[12]:/.test(text||"")) seen.add(text); };
    if ("BarcodeDetector" in window) {
      try {
        const detector = new BarcodeDetector({formats: ["qr_code"]});
        for (const result of await detector.detect(canvas)) add(result.rawValue);
      } catch (_) {}
    }
    try {
      for (const code of await scanWithZbar(canvas)) add(code);
    } catch (error) { console.warn("ZBar whole-image scan:", error); }
    add(tryZxing(canvas));

    // Exact-original PDFs use 3 columns x 4 rows on each Letter-size page.
    // For a rendered PDF, use known cell centers; legacy PV1 is 2 x 2.
    let boxes;
    if (exactPage || [...seen].some(code => code.startsWith("PV2:"))) {
      boxes = [];
      const xpos=[26,229,432], ypos=[83,249,415,581];
      for (const y of ypos) for (const x of xpos)
        boxes.push([(x-6)/612,(y-6)/792,166/612,166/792]);
    } else {
      boxes = [
        [0, 0, .55, .53], [.45, 0, .55, .53],
        [0, .37, .55, .49], [.45, .37, .55, .49],
        [0, .52, .55, .48], [.45, .52, .55, .48]
      ];
    }
    // The full-image multi-QR scan often finds all codes. Individual crops
    // recover codes it missed because of density or page rendering.
    for (let i=0;i<boxes.length;i++) {
      const region=crop(canvas,...boxes[i]);
      try {
        for(const code of await scanWithZbar(region)) add(code);
        if(!exactPage) add(tryZxing(region));
      } catch(error){ console.warn("QR crop scan:",error); }
      region.width=region.height=0;
      if(i%3===2) await yieldUI();
    }
    return [...seen];
  }

  async function imageCanvas(file) {
    const blobURL = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = blobURL;
      await img.decode();
      const scale = Math.min(1, 3200 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas;
    } finally { URL.revokeObjectURL(blobURL); }
  }

  async function scanFile(file) {
    if (file.name.toLowerCase().endsWith(".pdf")) {
      if (!window.pdfjsLib) throw new Error("The PDF reader failed to load; check your internet connection.");
      const documentTask = pdfjsLib.getDocument({data: new Uint8Array(await file.arrayBuffer())});
      const pdf = await documentTask.promise;
      if (pdf.numPages > 40) throw new Error("PDF too long: the browser limit is 40 pages.");
      let found = [];
      try {
        for (let i = 1; i <= pdf.numPages; i++) {
          progress.textContent = "Scanning PDF page " + i + " of " + pdf.numPages + "…";
          await yieldUI();
          const page = await pdf.getPage(i);
          const pageText = await page.getTextContent();
          const isExact = pageText.items.some(item => item.str && item.str.includes("EXACT ORIGINAL"));
          const dimensions = page.getViewport({ scale: 1 });
          const scale = Math.min(isExact?2.7:2.0, 2600 / Math.max(dimensions.width, dimensions.height));
          const viewport = page.getViewport({scale});
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          await page.render({canvasContext: canvas.getContext("2d"), viewport}).promise;
          found.push(...await readCanvas(canvas,isExact));
          canvas.width = canvas.height = 0;
          page.cleanup();
        }
      } finally { await pdf.destroy(); }
      return found;
    }
    const canvas = await imageCanvas(file);
    try { return await readCanvas(canvas); }
    finally { canvas.width = canvas.height = 0; }
  }

  function rawPcmToFloat(bytes) {
    const frames = Math.floor(bytes.length / 2);
    if (!frames) throw new Error("The speech decoder returned no audio.");
    const output = new Float32Array(frames);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i=0; i<frames; i++) output[i] = view.getInt16(i*2, true) / 32768;
    return output;
  }

  async function decodeTiny(bytes) {
    if (typeof window.createC2Dec !== "function")
      throw new Error("Codec 2 decoder did not load. Check your internet connection.");
    if (bytes.length < 8 || bytes[0] !== 0xc0 || bytes[1] !== 0xde || bytes[2] !== 0xc2)
      throw new Error("Invalid Tiny Codec 2 header.");
    // FFmpeg .c2 file header: magic C0 DE C2 and 4 metadata bytes.
    const data = bytes.slice(7);
    if (!data.length || data.length % 7 !== 0)
      throw new Error("The Codec 2 data is incomplete or has an unfamiliar frame size.");
    const raw = await new Promise((resolve, reject) => {
      let produced = false;
      const module = {
        arguments: ["1300", "input.bit", "output.raw"],
        locateFile: name => "https://cdn.jsdelivr.net/gh/rameshvarun/codec2-emscripten@main/build/" + name,
        preRun: () => module.FS.writeFile("input.bit", data),
        postRun: () => {
          try { produced = true; resolve(module.FS.readFile("output.raw").slice()); }
          catch (error) { reject(error); }
        },
        printErr: message => console.warn("Codec2:", message)
      };
      try {
        Promise.resolve(window.createC2Dec(module)).then(() => {
          if (!produced) reject(new Error("The Codec 2 decoder produced no audio."));
        }).catch(reject);
      } catch (error) { reject(error); }
    });
    return {samples: rawPcmToFloat(raw), rate: 8000};
  }

  async function decodeClear(bytes) {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    try {
      const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const decoded = await context.decodeAudioData(copy);
      const samples = new Float32Array(decoded.length);
      for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
        const part = decoded.getChannelData(channel);
        for (let i = 0; i < decoded.length; i++) samples[i] += part[i] / decoded.numberOfChannels;
      }
      return { samples, rate: decoded.sampleRate };
    } catch (_) {
      throw new Error("This browser cannot decode the Clear (Ogg/Opus) file. Try current Safari, Chrome or Firefox.");
    } finally { await context.close(); }
  }

  function resample(samples, inRate, outRate = 24000) {
    if (inRate === outRate) return samples;
    const length = Math.max(1, Math.round(samples.length * outRate / inRate));
    const next = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const pos = i * inRate / outRate;
      const left = Math.min(samples.length - 1, Math.floor(pos));
      const right = Math.min(samples.length - 1, left + 1);
      const factor = pos - left;
      next[i] = samples[left] * (1-factor) + samples[right] * factor;
    }
    return next;
  }

  async function encodeMp3(input) {
    if (!window.lamejs) throw new Error("MP3 encoder did not load. Check your internet connection.");
    const samples = resample(input.samples, input.rate);
    if (samples.length > 24000 * 360) throw new Error("Audio is too long for in-browser encoding.");
    const encoder = new lamejs.Mp3Encoder(1, 24000, 64);
    const pieces = [];
    for (let start = 0; start < samples.length; start += 1152) {
      const end = Math.min(samples.length, start + 1152);
      const pcm = new Int16Array(end - start);
      for (let j = start; j < end; j++) {
        const v = Math.max(-1, Math.min(1, samples[j]));
        pcm[j-start] = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767);
      }
      const chunk = encoder.encodeBuffer(pcm);
      if (chunk.length) pieces.push(new Uint8Array(chunk));
      if (start % (1152*120) === 0) {
        progress.textContent = "Encoding MP3: " + Math.round(start*100/samples.length) + "%";
        await yieldUI();
      }
    }
    const tail = encoder.flush();
    if (tail.length) pieces.push(new Uint8Array(tail));
    const size = pieces.reduce((total, p) => total+p.length, 0);
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const p of pieces) { bytes.set(p, offset); offset += p.length; }
    if (size < 100) throw new Error("The MP3 encoder did not produce a valid file.");
    return new Blob([bytes], {type: "audio/mpeg"});
  }

  decodeButton.addEventListener("click", async () => {
    if (!files.length) return;
    resetOutput();
    decodeButton.disabled = true;
    decodeButton.textContent = "Converting…";
    try {
      if (!window.ZXing) throw new Error("The QR scanning library did not load. Check your connection.");
      if (!crypto?.subtle) throw new Error("Open this page over HTTPS so checksum verification works.");
      let codes = [];
      for (let i = 0; i < files.length; i++) {
        progress.textContent = "Reading file " + (i+1) + "/" + files.length + ": " + files[i].name;
        await yieldUI();
        try { codes.push(...await scanFile(files[i])); }
        catch (error) { throw new Error(files[i].name + ": " + error.message); }
      }
      codes=[...new Set(codes)];
      const exact=codes.some(code=>code.startsWith("PV2:"));
      if(exact&&codes.some(code=>code.startsWith("PV1:")))
        throw Error("These scans contain two different PaperVoice formats. Upload only one recording.");
      if(exact){
        progress.textContent="Reassembling and verifying original file bytes…";
        await yieldUI();
        const original=await rebuildExact(codes);
        const saved=new Blob([original.bytes],{type:original.mime});
        resultURL=URL.createObjectURL(saved);
        audio.src=resultURL;
        download.href=resultURL;
        download.download=original.filename;
        download.textContent="↓ Download exact original "+original.filename;
        info.textContent="EXACT original • "+original.count+
          " QR codes • "+formatSize(original.bytes.length)+" • SHA-256 matches.";
        setStatus("Success — every original audio byte was recovered. No transcoding or quality loss.");
      } else {
        const message=await rebuild(codes);
        progress.textContent="Audio recovered from "+message.count+" QR codes. Decoding speech…";
        await yieldUI();
        const pcm=message.kind==="T"?await decodeTiny(message.bytes):await decodeClear(message.bytes);
        progress.textContent="Making MP3…";await yieldUI();
        const mp3=await encodeMp3(pcm);
        resultURL=URL.createObjectURL(mp3);
        audio.src=resultURL;
        download.href=resultURL;
        download.download="PaperVoice_"+message.id+".mp3";
        download.textContent="↓ Download MP3";
        info.textContent=message.count+" QR codes • "+(pcm.samples.length/pcm.rate).toFixed(1)+
          " seconds • "+formatSize(mp3.size);
        setStatus("Success — legacy compressed recording reconstructed.");
      }
      output.hidden = false;
      setStatus("Success — your recording was reconstructed locally on this device.");
      progress.textContent = "";
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "Something went wrong decoding the message.", true);
      progress.textContent = "";
    } finally {
      decodeButton.disabled = !files.length;
      decodeButton.textContent = "Decode & recover audio";
    }
  });
  refreshFiles();
})();