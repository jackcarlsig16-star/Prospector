// hkos-mcp-connector-v1 M1 - POST /mcp, Streamable HTTP, stateless: a fresh low-level Server + transport per request,
// JSON responses (no SSE stream). Mounted outside /api so sessionAuth never runs here; the bearer token is the caller.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { bearerAuth } from './bearer.js';
import { originOf } from './oauth.js';
import { toolList, runTool } from './tools.js';

export async function mcpRoute(req, res, d = {}) {
  if (req.method !== 'POST') return res.set('Allow', 'POST').status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed - this server is stateless, POST only' }, id: null });
  const caller = await bearerAuth(req, res, d);
  if (!caller) return;
  const server = new Server({ name: 'humankind-grow', title: 'HumanKind Grow', version: '1.0.0' }, { capabilities: { tools: {} }, instructions: 'HumanKind Grow (Prospector). Check brands before pitching, then save drafts - nothing is ever sent. Every tool acts as the signed-in founder.' });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolList() }));
  server.setRequestHandler(CallToolRequestSchema, async r => runTool({ auth: caller.auth, businessId: caller.businessId, origin: originOf(req), d }, r.params.name, r.params.arguments));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error('[mcp] request:', e.message);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
  }
}
