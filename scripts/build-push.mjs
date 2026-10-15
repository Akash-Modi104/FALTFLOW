import {build} from 'esbuild';
await build({entryPoints:['scripts/push-crypto.js'],bundle:true,format:'iife',globalName:'FlatflowPushCrypto',platform:'neutral',target:'es2020',minify:true,outfile:'backend/PushCrypto.gs'});
