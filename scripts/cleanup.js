// Deletes any Daytona sandboxes still running (e.g. after the server was killed).
import '../lib/env.js';
import { Daytona } from '@daytona/sdk';

let found = 0;
for await (const s of await new Daytona().list()) {
  const st = String(s.state ?? '').toLowerCase();
  if (st.includes('destroy')) continue;
  found++;
  try {
    await s.delete(60, true);
    console.log('Deleted', s.id);
  } catch (err) {
    console.error('Could not delete', s.id, err.message);
  }
}
console.log(found ? 'All clean.' : 'No sandboxes running.');
