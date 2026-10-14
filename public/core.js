export const uid = () => crypto.randomUUID();
export const iso = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export const date = s => new Date(`${s}T12:00:00`);
export const addDays = (s,n) => { const d=date(s);d.setDate(d.getDate()+n);return iso(d); };
export function nextDue(t) {
  if(t.unit !== 'month') return addDays(t.due,t.every*(t.unit==='week'?7:1));
  const d=date(t.due), day=t.anchorDay||d.getDate();
  d.setDate(1);d.setMonth(d.getMonth()+t.every);
  const last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();
  d.setDate(Math.min(day,last));return iso(d);
}
export const away = (p,on=iso()) => !!(p && (p.paused || (p.awayFrom && p.awayTo && on>=p.awayFrom && on<=p.awayTo)));
export function assignee(t,people,on=t.due) {
  for(let i=0;i<t.order.length;i++){
    const id=t.order[(t.turn+i)%t.order.length], p=people.find(x=>x.id===id);
    if(p&&!away(p,on))return p;
  }
  return null;
}
export function advance(t,people,on=t.due) {
  const p=assignee(t,people,on);
  t.turn=p?(t.order.indexOf(p.id)+1)%t.order.length:(t.turn+1)%Math.max(1,t.order.length);
}
export const emptyHome = name => ({schema:1,id:uid(),name:name||'Our happy place',people:[],tasks:[],history:[],created: new Date().toISOString()});
export function demoHome(){
  const h=emptyHome('The Sunday Club');
  h.people=['Alex','Jamie','Sam','Taylor'].map((name,i)=>({id:uid(),name,color:i,paused:false,awayFrom:'',awayTo:''}));
  h.tasks=[['Kitchen reset','Kitchen','🍳',20,1,'day',0],['Take out the recycling','Whole home','♻️',10,1,'week',0],['Bathroom sparkle','Bathroom','🫧',25,1,'week',1],['Vacuum the living room','Living room','🧹',15,1,'week',2],['Water the plants','Living room','🌿',5,3,'day',3],['Deep-clean the fridge','Kitchen','🧊',30,1,'month',5]].map((a,i)=>({id:uid(),title:a[0],area:a[1],icon:a[2],minutes:a[3],every:a[4],unit:a[5],due:addDays(iso(),a[6]),anchorDay:date(addDays(iso(),a[6])).getDate(),order:h.people.map(p=>p.id),turn:i%4,notes:'',paused:false}));
  return h;
}
export function validateHome(h){
  const fail=()=>{throw new Error('This is not a valid Flatflow backup. No data was changed.');};
  if(!h||h.schema!==1||typeof h.id!=='string'||typeof h.name!=='string'||!h.name.trim()||h.name.length>80||!Array.isArray(h.people)||!Array.isArray(h.tasks)||!Array.isArray(h.history)||h.people.length>30||h.tasks.length>100||h.history.length>200)fail();
  const validDate = s => typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(date(s))&&iso(date(s))===s;
  const ids=new Set();
  for(const p of h.people){if(!p||typeof p.id!=='string'||ids.has(p.id)||!/^[\w-]{1,80}$/.test(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>60||!Number.isInteger(p.color)||p.color<0||p.color>5||typeof p.paused!=='boolean'||(p.awayFrom&&!validDate(p.awayFrom))||(p.awayTo&&!validDate(p.awayTo))||(p.awayFrom&&p.awayTo&&p.awayTo<p.awayFrom))fail();ids.add(p.id);}
  const taskIds=new Set();
  for(const t of h.tasks){if(!t||typeof t.id!=='string'||!/^[\w-]{1,80}$/.test(t.id)||taskIds.has(t.id)||typeof t.title!=='string'||!t.title.trim()||t.title.length>100||typeof t.area!=='string'||t.area.length>60||typeof t.icon!=='string'||t.icon.length>16||typeof t.notes!=='string'||t.notes.length>1000||typeof t.paused!=='boolean'||!Number.isInteger(t.every)||t.every<1||t.every>365||!['day','week','month'].includes(t.unit)||!validDate(t.due)||!Number.isInteger(t.anchorDay)||t.anchorDay<1||t.anchorDay>31||!Number.isInteger(t.minutes)||t.minutes<1||t.minutes>600||!Array.isArray(t.order)||new Set(t.order).size!==t.order.length||!t.order.length||t.order.some(id=>!ids.has(id))||!Number.isInteger(t.turn)||t.turn<0||t.turn>=t.order.length)fail();taskIds.add(t.id);}
  for(const e of h.history){if(!e||typeof e.id!=='string'||typeof e.text!=='string'||e.text.length>500||typeof e.at!=='string'||isNaN(Date.parse(e.at))||typeof e.kind!=='string'||typeof e.person!=='string'||typeof e.task!=='string'||!Number.isFinite(e.minutes)||e.minutes<0||e.minutes>600)fail();}
  if(JSON.stringify(h).length>40000)throw new Error('This home is too large. Export a backup and clear older activity first.');
  return h;
}
export function record(h,kind,text,person='',task='',minutes=0){h.history.unshift({id:uid(),kind,text,person,task,minutes,at:new Date().toISOString()});h.history=h.history.slice(0,200);}
export function complete(h,id){const t=h.tasks.find(t=>t.id===id);if(!t||t.paused)throw new Error('This task is unavailable.');const p=assignee(t,h.people);if(!p)throw new Error('Everyone in this rotation is away. Edit the task to add someone available.');record(h,'done',`${p.name} completed ${t.title}`,p.id,t.id,t.minutes);advance(t,h.people);t.due=nextDue(t);}
// A turn lasts until the next scheduled occurrence. Unfinished turns expire
// at that boundary, so daily/weekly/monthly rotations continue automatically.
export function rollOver(h,today=iso()){
  let changed=false;
  for(const t of h.tasks.filter(t=>!t.paused)){
    let n=0;
    while(nextDue(t)<=today){
      if(++n>50000)throw new Error('This chore starts too far in the past. Choose a recent due date.');
      const p=assignee(t,h.people);
      if(n<=200)record(h,'missed',`${t.title} was not completed for ${t.due}${p?' · '+p.name:''}`,p?.id||'',t.id);
      advance(t,h.people);t.due=nextDue(t);changed=true;
    }
  }
  return changed;
}
export function skip(h,id,reason){const t=h.tasks.find(t=>t.id===id),p=t&&assignee(t,h.people);if(!p)throw new Error('No one is available for this task.');const other=t.order.filter(id=>id!==p.id).find(id=>{const x=h.people.find(p=>p.id===id);return x&&!away(x,t.due);});if(!other)throw new Error('Add another available person before passing this turn.');advance(t,h.people);record(h,'skip',`${p.name} passed ${t.title}${reason?`: ${reason}`:''}`,p.id,t.id);}
export function schedule(h,days=35){const result=[],end=addDays(iso(),days);for(const original of h.tasks.filter(t=>!t.paused)){const t=structuredClone(original);for(let i=0;i<400&&t.due<=end;i++){const p=assignee(t,h.people);result.push({task:t.id,title:t.title,icon:t.icon,area:t.area,due:t.due,person:p,minutes:t.minutes});advance(t,h.people);t.due=nextDue(t);}}return result.sort((a,b)=>a.due.localeCompare(b.due)||a.title.localeCompare(b.title));}
const icsEscape=s=>String(s).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
export function calendar(h,person=''){
  const events=schedule(h,60).filter(e=>e.due>=iso()&&(!person||e.person?.id===person));
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Flatflow//Household chores//EN','CALSCALE:GREGORIAN',...events.flatMap(e=>['BEGIN:VEVENT',`UID:${h.id}-${e.task}-${e.due}@flatflow`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}`,`DTSTART;VALUE=DATE:${e.due.replaceAll('-','')}`,`DTEND;VALUE=DATE:${addDays(e.due,1).replaceAll('-','')}`,`SUMMARY:${icsEscape(e.title+' · '+(e.person?.name||'Unassigned'))}`,`DESCRIPTION:${icsEscape('Flatflow chore. '+e.minutes+' minutes. Schedule snapshot: re-export after changes.')}`,'BEGIN:VALARM','ACTION:DISPLAY',`DESCRIPTION:${icsEscape(e.title)}`,'TRIGGER:PT9H','END:VALARM','END:VEVENT']),'END:VCALENDAR'].join('\r\n')+'\r\n';
}
