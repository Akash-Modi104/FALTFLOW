// Apps Script HTML bridge avoids cross-origin fetch and JSONP. Messages carry
// a per-frame nonce and are accepted only from the verified Google frame.
export class SheetsSync {
  constructor(url){
    if(!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url))throw new Error('Use the deployed Google Apps Script URL ending in /exec.');
    this.url=url;this.nonce=crypto.randomUUID();this.pending=new Map();
    this.ready=new Promise((resolve,reject)=>{this.resolveReady=resolve;this.rejectReady=reject;this.timer=setTimeout(()=>reject(new Error('Google Sheets did not connect. Check the deployment is available to Anyone.')),25000);});
    this.listener=e=>{
      if(!/^https:\/\/[\w-]+(?:\.|-)script\.googleusercontent\.com$/.test(e.origin))return;
      const d=e.data;if(!d||d.channel!=='flatflow'||d.nonce!==this.nonce)return;
      if(d.type==='ready'&&!this.target){this.target=e.source;this.origin=e.origin;clearTimeout(this.timer);this.resolveReady();return;}
      if(e.source!==this.target)return;
      const p=this.pending.get(d.id);if(p){clearTimeout(p.timer);this.pending.delete(d.id);d.error?p.reject(new Error(d.error)):p.resolve(d.result);}
    };
    window.addEventListener('message',this.listener);
    this.frame=document.createElement('iframe');this.frame.hidden=true;this.frame.title='Household sync';this.frame.referrerPolicy='no-referrer';
    this.frame.src=`${url}?origin=${encodeURIComponent(location.origin)}&nonce=${this.nonce}`;document.body.append(this.frame);
  }
  async call(payload){await this.ready;const id=crypto.randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Sync timed out. Reconnect before making more changes.'));},25000);this.pending.set(id,{resolve,reject,timer});this.target.postMessage({channel:'flatflow',nonce:this.nonce,id,payload},this.origin);});}
  close(){this.rejectReady(new Error('Connection closed. Please reconnect.'));clearTimeout(this.timer);window.removeEventListener('message',this.listener);this.frame.remove();for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Connection closed.'));}this.pending.clear();}
}
