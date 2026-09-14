import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const conn = async (t: string) => { const c = new Client({name:'t',version:'1'});
  await c.connect(new StreamableHTTPClientTransport(new URL('http://localhost:8787/mcp'),
    { requestInit:{ headers:{ Authorization:`Bearer ${t}` } } }) as never); return c; };
const call = (c: any, n: string, a: any={}) => c.callTool({name:n,arguments:a});
const say = (w:string,t:string)=>console.log(`\n${w}: "${t}"`);
const out = (r:any)=>console.log('  Alexa:', r.content?.[0]?.text);

const renee = await conn('renee-token'); const david = await conn('david-token');
const thursday = new Date(Date.now()+2*86400000); thursday.setUTCHours(14,0,0,0);

say('Renee','Mom has cardiology Thursday at 10.');
const a:any = await call(renee,'record_appointment',{kind:'cardiology',startsAt:thursday.toISOString()});
out(a);
const pid = a.structuredContent.proposals[0].id;
await call(renee,'confirm_proposal',{obligationId:pid,confirmed:true});
say('Renee',"I'll drive her."); out(await call(renee,'claim_obligation',{obligationId:pid}));

say('Renee',"Actually I can't drive Thursday, I'm out of town.");
out(await call(renee,'add_note',{ note:"I can't drive Thursday, I'm out of town.",
  unavailable:{ memberName:'Renee',
    from:new Date(thursday.getTime()-12*3600000).toISOString(),
    to:new Date(thursday.getTime()+12*3600000).toISOString() }}));

say('David',"What's going to fall through the cracks this week?");
out(await call(david,'get_care_gaps',{withinDays:7}));
await Promise.all([renee.close(),david.close()]);
