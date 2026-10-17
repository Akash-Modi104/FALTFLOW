import fs from 'node:fs/promises';
const template=await fs.readFile('backend/Code.template.gs','utf8');
let core=await fs.readFile('public/core.js','utf8');
core=core.replaceAll('export ','').replace('crypto.randomUUID()','Utilities.getUuid()').replaceAll('structuredClone(', 'clone_(');
const names=['removePerson','uid','iso','date','addDays','nextDue','away','assignee','advance','emptyHome','demoHome','validateHome','record','complete','rollOver','skip','schedule','icsEscape','calendar','validateExpenses','splitAmount','expenseBalances','settlements','addExpense','removeExpense','clearSettledExpenses','postDueBills','validateBills','compactExpenses','validateShopping'];
for(const name of names)core=core.replace(new RegExp('\\b'+name+'\\b','g'),name+'_');
// Only the local owner configuration contains the actual spreadsheet ID.
const id=process.argv[2]||'PASTE_YOUR_SPREADSHEET_ID';
await fs.writeFile('backend/Code.gs',template.replace('__SPREADSHEET_ID__',id)+'\n'+await fs.readFile('backend/PushCrypto.gs','utf8')+'\n'+await fs.readFile('backend/Push.gs','utf8')+'\n'+await fs.readFile('backend/Accounts.gs','utf8')+'\n'+await fs.readFile('backend/Migrate.gs','utf8')+'\nfunction clone_(v){return JSON.parse(JSON.stringify(v));}\n'+core);
