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
test('spreadsheets saved by Excel import, with long decimals, date-times and a title row above the header',async()=>{
  // Excel keeps 33.33 as 33.329999999999998 and dates as day numbers with a time part.
  const rows=await readXlsx(fs.readFileSync(new URL('./fixtures/splitwise-excel-saved.xlsx',import.meta.url)));
  assert.match(rows.flat().join(' '),/99999999/);
  const data=readSplitwise(rowsToCsv(rows));
  assert.deepEqual(data.skipped,[]);assert.equal(data.entries.length,5);
  assert.deepEqual(data.members,['Akash Modi','Mia','Leo']);
  assert.equal(data.entries[0].date,'2026-09-01');
  assert.deepEqual(data.entries[1].nets,{'Akash Modi':-1111,Mia:2222,Leo:-1111});
});
test('empty <row/> elements and namespaced tags such as <x:row> do not merge or hide rows',async()=>{
  const rows=await readXlsx(fs.readFileSync(new URL('./fixtures/splitwise-prefixed.xlsx',import.meta.url)));
  const data=readSplitwise(rowsToCsv(rows));
  assert.deepEqual(data.skipped,[]);assert.equal(data.entries.length,5);
  assert.deepEqual(data.members,['Akash Modi','Mia','Leo']);
});
