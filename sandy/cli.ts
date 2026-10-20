import { hostConnection } from './host.ts';

let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 100_000) throw new Error('Request too large');
}
try {
  const result = await hostConnection(JSON.parse(input), {
    url: process.env.RUNTIME_CONNECTORS_MCP_URL ?? '',
    token: process.env.RUNTIME_CONNECTORS_MCP_TOKEN ?? '',
    authHeader: process.env.RUNTIME_CONNECTORS_AUTH_HEADER || 'authorization',
    writes: (process.env.RUNTIME_CONNECTORS_ALLOWED_WRITES ?? '').split(',').map(s => s.trim()).filter(Boolean),
    reads: (process.env.RUNTIME_CONNECTORS_ALLOWED_READS ?? '').split(',').map(s => s.trim()).filter(Boolean),
  });
  process.stdout.write(JSON.stringify(result));
} catch {
  // Upstream errors can contain a provider URL. Return no credentials or body.
  process.stdout.write(JSON.stringify({ isError: true, text: 'Connected app request failed or was refused.' }));
  process.exitCode = 1;
}
