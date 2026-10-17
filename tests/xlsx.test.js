import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {writeXlsx,readXlsx,rowsToCsv,excelDate} from '../public/xlsx.js';
import {readSplitwise} from '../public/splitwise.js';

test('workbooks written in the browser read back with text, numbers and two sheets',async()=>{
  const rows=[['Date','Description','Cost'],['2026-10-01','Fish & chips, "large"',12.5],['2026-10-02','<Rent>',-800]];
  const file=writeXlsx([{name:'Expenses',rows},{name:'Balances',rows:[['Person'],['Asha']]}]);
  assert.equal(String.fromCharCode(file[0],file[1]),'PK');
  assert.deepEqual(await readXlsx(file),rows.map(r=>r.map(String)));
  // A real zip tool agrees the archive is valid and has every part.
  const path=new URL('./fixtures/out.xlsx',import.meta.url);fs.writeFileSync(path,file);
  try{const list=execFileSync('python3',['-c','import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print("\\n".join(z.namelist()))',path.pathname],{encoding:'utf8'});assert.match(list,/xl\/worksheets\/sheet2\.xml/);}
  finally{fs.unlinkSync(path);}
});
test('Splitwise Excel exports import like CSV, with Excel dates and shared strings',async()=>{
  const rows=await readXlsx(fs.readFileSync(new URL('./fixtures/splitwise.xlsx',import.meta.url)));
  assert.deepEqual(rows[0],['Date','Description','Category','Cost','Currency','Asha','Ben']);
  assert.equal(rows[1][2],'Food & drink');
  const csv=rowsToCsv(rows.map((r,i)=>i?r.map((v,j)=>j===0?excelDate(v):v):r));
  const data=readSplitwise(csv);
  assert.deepEqual(data.members,['Asha','Ben']);assert.equal(data.entries.length,2);
  assert.equal(data.entries[0].date,'2026-09-15');
  assert.equal(excelDate('2026-01-01'),'2026-01-01');
});
