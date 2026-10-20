import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { hostConnection } from './host.ts';
test('real discovery and read execution exclude writes and conflicting hints', async () => {
 let calls=0;
 const server=createServer(async (req,res)=>{
  if(req.headers.authorization!=='Bearer fixture-token'){res.writeHead(401).end();return;}
  const mcp=new McpServer({name:'fixture',version:'1'});
  for(const [name,annotations] of Object.entries({read:{readOnlyHint:true},write:{readOnlyHint:false},conflict:{readOnlyHint:true,destructiveHint:true},failed:{readOnlyHint:true}}))
   mcp.registerTool(name,{inputSchema:{},annotations},async()=>{if(name==='failed') throw new Error('sensitive-provider-url');calls++;return {content:[{type:'text',text:'fixture-data'}]};});
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined});
  await mcp.connect(transport);
  res.on('close',()=>{void transport.close();void mcp.close();});
  await transport.handleRequest(req,res);
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=(server.address() as any).port;
 const config={url:`http://127.0.0.1:${port}/mcp`,token:'fixture-token',reads:['read','write','conflict','failed']};
 try{
  const catalog:any=await hostConnection({operation:'list'},config);
  assert.deepEqual(catalog.tools.map((t:any)=>t.name),['read','failed']);
  const result:any=await hostConnection({operation:'call',tool:'read'},config);
  assert.match(JSON.stringify(result),/fixture-data/);
  await assert.rejects(hostConnection({operation:'call',tool:'write'},config));
  const failed=await hostConnection({operation:'call',tool:'failed'},config);
  assert.equal(JSON.stringify(failed).includes('sensitive-provider-url'),false);
  assert.equal(calls,1);
 } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
