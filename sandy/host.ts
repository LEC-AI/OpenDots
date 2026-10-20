import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { ConnectionStore } from '../src/server/connection-store.ts';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ConnectionService } from '../src/server/connections.ts';

/** Reuse the real discovery, schema limits, timeouts and result normalizer.
 * Only the host's explicitly allowed tools are exposed. Writes require the
 * approved catalog fingerprint; the host journals intent before this call. The ephemeral
 * store is a discovery cache; no task or approval is created in OpenDots.
 */
export async function hostConnection(request: {
  operation: 'list' | 'call' | 'write';
  schema_sha256?: string;
  tool?: string;
  arguments?: Record<string, unknown>;
}, config: { url: string; token: string; reads: string[]; writes?: string[]; authHeader?: string }) {
  const database = new DatabaseSync(':memory:');
  try {
    const authHeader = config.authHeader ?? 'authorization';
    if (!['authorization', 'x-api-key'].includes(authHeader)) throw new Error('Unsupported auth header');
    const service = new ConnectionService(new ConnectionStore(database), ({url, token, signal}) =>
      new StreamableHTTPClientTransport(new URL(url), {
        requestInit: token ? {headers: {[authHeader]: authHeader === 'authorization' ? `Bearer ${token}` : token}} : undefined,
        fetch: (input, init) => fetch(input, {...init, signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])])}),
      }));
    await service.add('host', {
      name: 'connected_apps', url: config.url, token: config.token,
    });
    const permitted = service.tools('host').filter(
      ({ tool }) => (config.reads.includes(tool.name) && tool.readOnly) || (config.writes ?? []).includes(tool.name),
    );
    const describe = (tool: typeof permitted[number]['tool']) => ({
      ...tool,
      mode: (config.writes ?? []).includes(tool.name) ? 'write' : 'read',
      schema_sha256: createHash('sha256').update(JSON.stringify({
        name: tool.name, description: tool.description, inputSchema: tool.inputSchema,
      })).digest('hex'),
    });
    if (request.operation === 'list')
      return { tools: permitted.map(({ tool }) => describe(tool)) };
    if (!['call','write'].includes(request.operation)) throw new Error('Unknown operation');
    const selected = permitted.find(({ tool }) => tool.name === request.tool);
    if (!selected) throw new Error('This action is not permitted by the host');
    const description = describe(selected.tool);
    if (request.operation === 'write') {
      if (description.mode !== 'write' || request.schema_sha256 !== description.schema_sha256)
        throw new Error('Write requires the approved catalog fingerprint');
    } else if (description.mode !== 'read') {
      throw new Error('Writes cannot use the read path');
    }
    const result = await service.call(selected, request.arguments ?? {});
    return result.isError ? {isError:true,text:"Connected app request failed."} : result;
  } finally {
    database.close();
  }
}
