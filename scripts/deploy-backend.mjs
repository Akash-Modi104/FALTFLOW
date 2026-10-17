// Builds the Apps Script backend and publishes it to the existing web app
// deployment with clasp, so the app URL stays the same.
// One-time setup:  npx @google/clasp@2.4.2 login
//                  npx @google/clasp@2.4.2 clone SCRIPT_ID --rootDir backend/deploy
// Then each time:  FLATFLOW_SHEET_ID=... npm run deploy-backend
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const sheet=process.env.FLATFLOW_SHEET_ID;
if(!sheet)throw new Error('Set FLATFLOW_SHEET_ID to the ID of your private Flatflow spreadsheet.');
const clasp=JSON.parse(await fs.readFile('.clasp.json','utf8').catch(()=>{throw new Error('Run the one-time clasp login and clone first (see README).');}));
const root=clasp.rootDir||'.';
const config=await fs.readFile('public/config.js','utf8');
const deployment=process.env.FLATFLOW_DEPLOYMENT_ID||(config.match(/macros\/s\/([\w-]+)\/exec/)||[])[1];
if(!deployment)throw new Error('Set FLATFLOW_DEPLOYMENT_ID, or put the web app URL in public/config.js.');
execFileSync('node',['scripts/build-backend.mjs',sheet],{stdio:'inherit'});
const files=await fs.readdir(root);
const target=files.find(f=>/^code\.(gs|js)$/i.test(f))||'Code.gs';
await fs.copyFile('backend/Code.gs',`${root}/${target}`);
const run=args=>execFileSync('npx',['--yes','@google/clasp@2.4.2',...args],{stdio:'inherit'});
run(['push','--force']);
run(['deploy','--deploymentId',deployment,'--description','Flatflow '+new Date().toISOString().slice(0,16)]);
console.log('Backend deployed to the existing web app. Reload Flatflow to use it.');
