/* GPL-3.0-or-later: wrapper for paperback.rs 1.3.2 (Josef H.B. Schneider).
   PaperBack original by Oleh Yuschuk. See NOTICE.md.
   Audio and scans never leave the browser. The WASM is fetched from pinned jsDelivr. */
import init, {Decoder, encodeFile, version} from "https://cdn.jsdelivr.net/gh/J0s3f/paperback-homepage@c26a0e05070fe8bb1664b6700c0f67ff7cf64af3/site/pkg/paperback_web.js";

let decoder;
let loaded=false;
function reply(msg,transfer=[]) { self.postMessage(msg,transfer); }
self.onmessage=async e=>{
  const m=e.data;
  try {
    if(m.type==="init"){
      if(!loaded) {
        await init({module_or_path:new URL("https://cdn.jsdelivr.net/gh/J0s3f/paperback-homepage@c26a0e05070fe8bb1664b6700c0f67ff7cf64af3/site/pkg/paperback_web_bg.wasm")});
        decoder=new Decoder();loaded=true;
      }
      reply({type:"ready",version:version()});return;
    }
    if(!loaded) throw Error("PaperBack module has not loaded.");
    if(m.type==="encode"){
      reply({type:"progress",phase:"encode",note:"Building high-density pages with error correction…"});
      const result=encodeFile(m.bytes,m.name,m.settings);
      const pdf=result.pdf;
      const first=result.pages.length?result.pages[0].png:new Uint8Array();
      reply({type:"encoded",pdf,preview:first,pageCount:result.pageCount,
        sourceSize:result.sourceSize,dpi:result.dpi,
        name:result.fileName},[pdf.buffer,first.buffer]);
      return;
    }
    if(m.type==="clear"){decoder.clear();reply({type:"cleared"});return;}
    if(m.type==="addImage"){
      const count=decoder.addImage(m.bytes);
      reply({type:"added",count,total:decoder.pageCount()});return;
    }
    if(m.type==="decode"){
      const total=decoder.pageCount();
      const result=decoder.decode(null,index=>reply({type:"progress",phase:"decode",done:index+1,total}));
      const bytes=result.compatible?decoder.fileData():new Uint8Array();
      reply({type:"decoded",result,bytes},bytes.length?[bytes.buffer]:[]);
      return;
    }
    reply({type:"error",message:"Unknown PaperBack command"});
  } catch(error) {
    reply({type:"error",message:error?.message||String(error)});
  }
};