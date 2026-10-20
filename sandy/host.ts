import { DatabaseSync } from 'node:sqlite';
import { ConnectionStore } from '../src/server/connection-store.ts';
import { ConnectionService } from '../src/server/connections.ts';

/** Reuse the real discovery, schema limits, timeouts and result normalizer.
 * Only the host's explicitly allowed read tools are exposed. The ephemeral
 * store is a discovery cache; no task or approval is created in OpenDots.
 */
export async function hostConnection(request: {
  operation: 'list' | 'call';
  tool?: string;
  arguments?: Record<string, unknown>;
}, config: { url: string; token: string; reads: string[] }) {
  const database = new DatabaseSync(':memory:');
  try {
    const service = new ConnectionService(new ConnectionStore(database));
    await service.add('host', {
      name: 'connected_apps', url: config.url, token: config.token,
    });
    const permitted = service.tools('host').filter(
      ({ tool }) => config.reads.includes(tool.name) && tool.readOnly,
    );
    if (request.operation === 'list')
      return { tools: permitted.map(({ tool }) => tool) };
    if (request.operation !== 'call') throw new Error('Unknown operation');
    const selected = permitted.find(({ tool }) => tool.name === request.tool);
    if (!selected) throw new Error('This read action is not permitted by the host');
    const result = await service.call(selected, request.arguments ?? {});
    return result.isError ? {isError:true,text:"Connected app request failed."} : result;
  } finally {
    database.close();
  }
}
