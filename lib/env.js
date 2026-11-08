// Loads .env (Node 22+ built-in, no dotenv needed) and fails clearly if a value is missing.
try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  // No .env yet: need() below explains what's missing.
}

export function need(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name} in .env`);
    process.exit(1);
  }
  return value;
}
