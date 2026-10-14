import fs from 'node:fs/promises';
const template=await fs.readFile('backend/Code.template.gs','utf8');
let core=await fs.readFile('public/core.js','utf8');
core=core.replaceAll('export ','').replace('crypto.randomUUID()','Utilities.getUuid()').replaceAll('structuredClone(', 'clone_(');
const names=['uid','iso','date','addDays','nextDue','away','assignee','advance','emptyHome','demoHome','validateHome','record','complete','rollOver','skip','schedule','icsEscape','calendar'];
for(const name of names)core=core.replace(new RegExp('\\b'+name+'\\b','g'),name+'_');
// Only the local owner configuration contains the actual spreadsheet ID.
const id=process.argv[2]||'PASTE_YOUR_SPREADSHEET_ID';
await fs.writeFile('backend/Code.gs',template.replace('__SPREADSHEET_ID__',id)+'\nfunction clone_(v){return JSON.parse(JSON.stringify(v));}\n'+core);
