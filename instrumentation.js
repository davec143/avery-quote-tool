// Startup self-check for the member portal (Node runtime only). See instrumentation-node.js.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('./instrumentation-node.js');
}
