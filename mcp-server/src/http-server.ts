import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';
import cors from 'cors';

// Get target directory from environment
const targetRepo = process.env.LUMIN_TARGET_REPO || 'default';
const targetDir = `/app/deliverables/${targetRepo}`;

// Create MCP server
const server = new Server(
  { name: 'lumin-helper', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// Register tools - tools/list
server.setRequestHandler('tools/list', async () => {
  return {
    tools: [
      {
        name: 'save_deliverable',
        description: 'Saves deliverable files with automatic validation.',
        inputSchema: {
          type: 'object',
          properties: {
            deliverable_type: { type: 'string' },
            content: { type: 'string' },
            file_path: { type: 'string' },
          },
          required: ['deliverable_type'],
        },
      },
      {
        name: 'generate_totp',
        description: 'Generates 6-digit TOTP code for authentication.',
        inputSchema: {
          type: 'object',
          properties: {
            secret: { type: 'string' },
          },
          required: ['secret'],
        },
      },
    ],
  };
});

// Register tools - tools/call
server.setRequestHandler('tools/call', async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'save_deliverable') {
    // Actually call existing tool
    const { createSaveDeliverableTool } = await import('./tools/save-deliverable.js');
    const handler = createSaveDeliverableTool(targetDir);
    const result = await handler(args as any);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  if (name === 'generate_totp') {
    const { generateTotp } = await import('./tools/generate-totp.js');
    const result = await generateTotp(args as any);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// Create Express app
const app = express();
app.use(cors());
app.use(express.json());

// SSE endpoint
app.get('/mcp', async (req, res) => {
  const transport = new SSEServerTransport('/mcp', res);
  await transport.start();
  await server.connect(transport);
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Lumin MCP Server running on port ${PORT}`);
  console.log(`Target directory: ${targetDir}`);
});

export { server, app };
