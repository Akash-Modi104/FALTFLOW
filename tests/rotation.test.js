import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
globalThis.crypto ||= webcrypto;
import {demoHome,validateHome,assignee,complete,rollOver,skip,nextDue,schedule,calendar} from '../public/core.js';
test('completion advances one turn and preserves the anchored monthly date',()=>{
  const h=demoHome(),t=h.tasks[0],p=assignee(t,h.people);
  complete(h,t.id);assert.notEqual(assignee(t,h.people).id,p.id);assert.equal(h.history[0].kind,'done');
  const m={due:'2026-01-31',anchorDay:31,every:1,unit:'month'};m.due=nextDue(m);assert.equal(m.due,'2026-02-28');assert.equal(nextDue(m),'2026-03-31');
});
test('passing a chore changes person without changing the due date',()=>{const h=demoHome(),t=h.tasks[0],due=t.due,p=assignee(t,h.people);skip(h,t.id,'Away');assert.equal(t.due,due);assert.notEqual(assignee(t,h.people).id,p.id);assert.equal(h.history[0].kind,'skip');});
test('rotation skips people with breaks or date-bounded absences',()=>{const h=demoHome(),t=h.tasks[0];h.people[0].paused=true;h.people[1].awayFrom=t.due;h.people[1].awayTo=t.due;assert.equal(assignee(t,h.people).id,h.people[2].id);complete(h,t.id);assert.equal(assignee(t,h.people).id,h.people[3].id);});
test('single available person cannot pass their turn to themself',()=>{const h=demoHome(),t=h.tasks[0];h.people.slice(1).forEach(p=>p.paused=true);assert.throws(()=>skip(h,t.id,'No'),/another available person/);});
test('every three days and every two weeks work across boundaries',()=>{assert.equal(nextDue({due:'2026-12-30',unit:'day',every:3}),'2027-01-02');assert.equal(nextDue({due:'2026-10-25',unit:'week',every:2}),'2026-11-08');});
test('validation rejects broken references, impossible dates and empty rotations',()=>{const h=demoHome();assert.doesNotThrow(()=>validateHome(h));const bad=structuredClone(h);bad.tasks[0].order=['missing'];assert.throws(()=>validateHome(bad));const badDate=structuredClone(h);badDate.tasks[0].due='2026-02-30';assert.throws(()=>validateHome(badDate));const empty=structuredClone(h);empty.tasks[0].order=[];assert.throws(()=>validateHome(empty));});
test('schedule projects future rotation and excludes paused tasks',()=>{const h=demoHome();h.tasks[1].paused=true;const events=schedule(h,10);assert.ok(events.length>0);assert.ok(events.every(e=>e.task!==h.tasks[1].id));const days=events.filter(e=>e.task===h.tasks[0].id);assert.notEqual(days[0].person.id,days[1].person.id);});
test('calendar exports only the chosen person and escapes text',()=>{const h=demoHome();h.tasks[0].title='Kitchen, clean; rinse';const out=calendar(h,h.people[0].id);assert.match(out,/BEGIN:VCALENDAR/);assert.match(out,/Kitchen\\, clean\\; rinse/);assert.match(out,/TRIGGER:PT9H/);assert.ok(!out.includes(' · Jamie'));assert.ok(out.endsWith('END:VCALENDAR\r\n'));});
test('unfinished weekly turns rotate automatically at the next period',()=>{const h=demoHome(),t=h.tasks[0];h.tasks=[t];t.unit='week';t.due='2026-10-01';const original=assignee(t,h.people);assert.equal(rollOver(h,'2026-10-08'),true);assert.equal(t.due,'2026-10-08');assert.notEqual(assignee(t,h.people).id,original.id);assert.equal(h.history[0].kind,'missed');assert.equal(rollOver(h,'2026-10-09'),false);});
