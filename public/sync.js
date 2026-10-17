// Talks to the Flatflow backend on Cloudflare Workers: plain HTTPS requests. text/plain keeps them
// "simple" requests, so browsers skip the extra CORS preflight round trip.
export class ApiSync {
  constructor(url){
    if(!/^https:\/\/[\w.-]+\/rpc$/.test(url))throw new Error('Use the Flatflow backend address ending in /rpc.');
    this.url=url;this.controllers=new Set();this.ready=Promise.resolve();
  }
  async call(payload){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);this.controllers.add(controller);
    try{
      const response=await fetch(this.url,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(payload),signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});
      let data;try{data=await response.json();}catch{throw new Error('Sync failed. Try again.');}
      if(data&&data.error)throw new Error(data.error);
      if(!response.ok)throw new Error('Sync failed. Try again.');
      return data;
    }catch(err){if(err.name==='AbortError')throw new Error(controller.closed?'Connection closed.':'Sync timed out. Reconnect before making more changes.');throw err;}
    finally{clearTimeout(timer);this.controllers.delete(controller);}
  }
  close(){for(const c of this.controllers){c.closed=true;c.abort();}this.controllers.clear();}
}
export const createSync=url=>new ApiSync(url);
