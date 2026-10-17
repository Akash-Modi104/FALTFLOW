// Minimal Excel (.xlsx) support without a library. Writing produces a plain
// workbook (stored zip, inline strings, numbers as numbers, bold header row).
// Reading takes the first sheet of any .xlsx, such as a Splitwise export, using
// the browser's built-in DecompressionStream for compressed entries.
const enc=new TextEncoder(),dec=new TextDecoder();
const CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
const crc32=bytes=>{let c=0xffffffff;for(const b of bytes)c=CRC[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
const xml=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
const column=i=>{let s='';for(i++;i;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s;};

function zip(files){
  const parts=[],central=[];let offset=0;
  for(const [name,text] of files){
    const data=enc.encode(text),nameBytes=enc.encode(name),crc=crc32(data),h=new DataView(new ArrayBuffer(30));
    h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(8,0,true);h.setUint32(14,crc,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,nameBytes.length,true);
    const c=new DataView(new ArrayBuffer(46));
    c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,nameBytes.length,true);c.setUint32(42,offset,true);
    parts.push(new Uint8Array(h.buffer),nameBytes,data);central.push(new Uint8Array(c.buffer),nameBytes);offset+=30+nameBytes.length+data.length;
  }
  const size=central.reduce((n,p)=>n+p.length,0),end=new DataView(new ArrayBuffer(22));
  end.setUint32(0,0x06054b50,true);end.setUint16(8,files.length,true);end.setUint16(10,files.length,true);end.setUint32(12,size,true);end.setUint32(16,offset,true);
  const all=[...parts,...central,new Uint8Array(end.buffer)],out=new Uint8Array(all.reduce((n,p)=>n+p.length,0));let at=0;for(const p of all){out.set(p,at);at+=p.length;}
  return out;
}
// sheets: [{name, rows:[[string|number,…],…]}]; the first row of each sheet is the header.
export function writeXlsx(sheets){
  const sheetXml=rows=>`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${rows.map((r,i)=>`<row r="${i+1}">${r.map((v,j)=>{const ref=column(j)+(i+1),s=i===0?' s="1"':typeof v==='number'?' s="2"':'';return typeof v==='number'&&Number.isFinite(v)?`<c r="${ref}"${s}><v>${v}</v></c>`:`<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${xml(v??'')}</t></is></c>`;}).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const files=[
    ['[Content_Types].xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s,i)=>`<sheet name="${xml(s.name.replace(/[\\/?*[\]:]/g,' ').slice(0,31))}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`],
    ...sheets.map((s,i)=>[`xl/worksheets/sheet${i+1}.xml`,sheetXml(s.rows)])
  ];
  return zip(files);
}

async function unzip(buffer){
  const bytes=new Uint8Array(buffer),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),out=new Map();
  let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){end=i;break;}
  if(end<0)throw new Error('This is not an Excel file.');
  let p=view.getUint32(end+16,true);const count=view.getUint16(end+10,true);
  for(let n=0;n<count;n++){
    if(view.getUint32(p,true)!==0x02014b50)throw new Error('This Excel file is damaged.');
    const method=view.getUint16(p+10,true),size=view.getUint32(p+20,true),nameLen=view.getUint16(p+28,true),extra=view.getUint16(p+30,true),comment=view.getUint16(p+32,true),local=view.getUint32(p+42,true);
    const name=dec.decode(bytes.subarray(p+46,p+46+nameLen));p+=46+nameLen+extra+comment;
    if(!/^xl\/(sharedStrings|workbook|worksheets\/sheet\d+)\.xml$/.test(name)&&name!=='xl/_rels/workbook.xml.rels')continue;
    const start=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true),data=bytes.subarray(start,start+size);
    if(method===0)out.set(name,dec.decode(data));
    else if(method===8)out.set(name,dec.decode(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()));
    else throw new Error('This Excel file uses an unsupported format.');
  }
  return out;
}
const unescape=s=>s.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[\da-f]+);/gi,(m,e)=>({lt:'<',gt:'>',quot:'"',apos:"'",amp:'&'}[e.toLowerCase()]??String.fromCodePoint(e[1].toLowerCase()==='x'?parseInt(e.slice(2),16):parseInt(e.slice(1),10))));
const texts=s=>[...s.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m=>unescape(m[1])).join('');
// Rows of the first worksheet as arrays of strings.
export async function readXlsx(buffer){
  const files=await unzip(buffer),shared=[...(files.get('xl/sharedStrings.xml')||'').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m=>texts(m[1]));
  const first=[...(files.get('xl/workbook.xml')||'').matchAll(/<sheet\b[^>]*r:id="([^"]+)"/g)][0]?.[1];
  const target=first&&(files.get('xl/_rels/workbook.xml.rels')||'').match(new RegExp(`Id="${first}"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="${first}"`));
  const path=target?'xl/'+(target[1]||target[2]).replace(/^\/?xl\//,''):'xl/worksheets/sheet1.xml',sheet=files.get(path)||files.get('xl/worksheets/sheet1.xml');
  if(!sheet)throw new Error('This Excel file has no sheets.');
  const rows=[];
  for(const r of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)){
    const row=[];
    for(const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
      const ref=(c[1].match(/r="([A-Z]+)\d+"/)||[])[1],type=(c[1].match(/t="(\w+)"/)||[])[1],body=c[2]||'',v=(body.match(/<v>([\s\S]*?)<\/v>/)||[])[1];
      const i=ref?[...ref].reduce((n,ch)=>n*26+ch.charCodeAt(0)-64,0)-1:row.length;
      row[i]=type==='s'?shared[Number(v)]??'':type==='inlineStr'?texts(body):v===undefined?'':unescape(v);
    }
    rows.push(Array.from(row,x=>x??''));
  }
  return rows;
}
// Turns rows back into CSV text, so CSV importers can read Excel files too.
export const rowsToCsv=rows=>rows.map(r=>r.map(v=>/[",\n]/.test(v)?`"${String(v).replace(/"/g,'""')}"`:v).join(',')).join('\n');
// Excel stores dates as days since 30 Dec 1899; Splitwise's Excel export does too.
export const excelDate=v=>/^\d{5}(\.\d+)?$/.test(String(v))?new Date(Date.UTC(1899,11,30)+Math.floor(Number(v))*864e5).toISOString().slice(0,10):v;
