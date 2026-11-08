// One shared Daytona sandbox, created on first use and reused, so only the
// first analysis waits for a sandbox to start.
import { Daytona } from '@daytona/sdk';

let daytona = null;
let sandboxPromise = null;

export function getSandbox() {
  daytona ??= new Daytona(); // reads DAYTONA_API_KEY
  sandboxPromise ??= daytona
    .create({ language: 'python', ephemeral: true, autoStopInterval: 15 })
    .catch((err) => {
      sandboxPromise = null;
      throw err;
    });
  return sandboxPromise;
}

// Runs fn(sandbox). If the sandbox itself fails (stopped, network), retry once on a fresh one.
export async function withSandbox(fn) {
  try {
    return await fn(await getSandbox());
  } catch (err) {
    console.error('Sandbox error, retrying on a fresh sandbox:', err.message);
    sandboxPromise = null;
    return fn(await getSandbox());
  }
}

export async function closeSandbox() {
  if (!sandboxPromise) return;
  const pending = sandboxPromise;
  sandboxPromise = null;
  try {
    await (await pending).delete();
    console.log('Sandbox deleted.');
  } catch (err) {
    console.error('Could not delete sandbox (run npm run cleanup):', err.message);
  }
}
