/**
 * End-to-end walkthrough of the demo story, driven through a real MCP client over
 * Streamable HTTP. This is the story the video tells, executed against the server.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const ENDPOINT = new URL(process.env.CARECIRCLE_URL ?? 'http://localhost:8787/mcp');

async function connect(token: string): Promise<Client> {
  const client = new Client({ name: 'carecircle-e2e', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(ENDPOINT, {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport as never);
  return client;
}

const say = (who: string, text: string) => console.log(`\n${who}: "${text}"`);
const alexa = (r: any) => {
  const text = r.content?.[0]?.text ?? '(no text)';
  console.log(`  Alexa: ${text}`);
  return r;
};
const call = (c: Client, name: string, args: Record<string, unknown> = {}) =>
  c.callTool({ name, arguments: args }) as Promise<any>;

const margaret = await connect('margaret-token');
const david = await connect('david-token');
const renee = await connect('renee-token');
const aide = await connect('aide-token');

const tools = await david.listTools();
console.log(`Server exposes ${tools.tools.length} tools, protocol negotiated OK.`);

say('Margaret (kitchen Echo)', 'I took my heart pill.');
alexa(await call(margaret, 'log_care_event', { kind: 'medication_taken', medicationName: 'heart pill' }));

say('Renee (phone)', 'Mom has cardiology Thursday at 10.');
const appt = alexa(await call(renee, 'record_appointment', {
  kind: 'cardiology',
  startsAt: new Date(Date.now() + 2 * 86400000).toISOString(),
}));
const proposalId = appt.structuredContent?.proposals?.[0]?.id;

say('Renee', 'Yes, she will need a ride.');
alexa(await call(renee, 'confirm_proposal', { obligationId: proposalId, confirmed: true }));

say('Renee', 'Mom sounded tired on the phone.');
alexa(await call(renee, 'add_note', { note: 'Mom sounded tired on the phone.' }));

say('David (driving)', "What's going to fall through the cracks this week?");
const gaps = alexa(await call(david, 'get_care_gaps', { withinDays: 7 }));
console.log('  [structured]', JSON.stringify(
  gaps.structuredContent.gaps.map((g: any) => ({ severity: g.severity, kind: g.kind })),
));

say('David', "I'll take the cardiology one.");
const first = gaps.structuredContent.gaps.find((g: any) => g.obligationId);
alexa(await call(david, 'claim_obligation', { obligationId: first.obligationId }));

say('David', "How's Mom doing today?");
alexa(await call(david, 'get_care_summary'));

console.log('\n--- authority checks ---');
say('Renee (caregiver)', 'Assign the pharmacy run to David.');
alexa(await call(renee, 'assign_obligation', { obligationId: first.obligationId, assigneeName: 'David' }));

say('Tasha (paid aide)', "What's going on with the family?");
alexa(await call(aide, 'get_care_gaps'));

say('Tasha (paid aide)', 'What do I need to know today?');
alexa(await call(aide, 'get_shift_brief'));

await Promise.all([margaret.close(), david.close(), renee.close(), aide.close()]);
console.log('\nDone.');
