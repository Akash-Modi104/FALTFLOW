import fs from 'node:fs/promises';
await fs.rm('dist',{recursive:true,force:true});
await fs.cp('public','dist',{recursive:true});
await fs.writeFile('dist/.nojekyll','');
console.log('Built static app in dist/.');
