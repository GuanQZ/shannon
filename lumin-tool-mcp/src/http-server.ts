import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import cors from 'cors';
import { sdkTools } from './tools/sdk-tools.js';

// Get target directory from environment - support dynamic update via /set-cwd API
// Default to /app/repos/ as the base for target repos
let BASE_DIR = process.env.LUMIN_TARGET_REPO
  ? `/app/repos/${process.env.LUMIN_TARGET_REPO}`
  : '/app/repos/lumin-target';

// Store active server-transport pairs by session ID
const sessions = new Map<string, { server: Server; transport: SSEServerTransport }>();

// Filter SDK tools: exclude Bash and Write (only keep Read, Glob, Grep)
const allowedSdkToolNames = ['Read', 'Glob', 'Grep'];

/**
 * Create a new MCP server instance with all tools registered.
 * This is required because MCP Server doesn't support multiple simultaneous connections.
 */
function createMcpServer(): Server {
  const server = new Server(
    { name: 'lumin-helper', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  // Register tools - tools/list
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Custom tools
    const customTools = [
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
    ];

    // Filter SDK tools (exclude Bash and Write)
    const filteredSdkTools = sdkTools
      .filter(tool => allowedSdkToolNames.includes(tool.name))
      .map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));

    return {
      tools: [...customTools, ...filteredSdkTools],
    };
  });

  // Register tools - tools/call
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const { name, arguments: toolArgs } = request.params;
      const toolName = name;

      // Custom tools
      if (toolName === 'save_deliverable') {
        const { createSaveDeliverableHandler, SaveDeliverableInputSchema } = await import('./tools/save-deliverable.js');
        const validatedArgs = SaveDeliverableInputSchema.parse(toolArgs);
        const handler = createSaveDeliverableHandler(BASE_DIR);
        const result = await handler(validatedArgs);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }

      if (toolName === 'generate_totp') {
        const { generateTotp, GenerateTotpInputSchema } = await import('./tools/generate-totp.js');
        const validatedArgs = GenerateTotpInputSchema.parse(toolArgs);
        const result = await generateTotp(validatedArgs);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }

      // SDK tools - find matching tool and execute
      const sdkTool = sdkTools.find(t => t.name === toolName);
      if (sdkTool) {
        const args = toolArgs || {};
        const result = await sdkTool.handler(args, { cwd: BASE_DIR });
        return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }] };
      }

      throw new Error(`Unknown tool: ${toolName}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: JSON.stringify({ status: 'error', message }) }],
        isError: true,
      };
    }
  });

  return server;
}

// Create Express app
const app = express();
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', server: 'lumin-tool-mcp' });
});

// Set working directory endpoint - allows dynamic update of BASE_DIR
app.put('/set-cwd', (req, res) => {
  const { cwd } = req.body;
  if (!cwd || typeof cwd !== 'string') {
    return res.status(400).json({ error: 'cwd is required and must be a string' });
  }
  BASE_DIR = cwd;
  console.log(`Working directory updated to: ${BASE_DIR}`);
  res.json({ status: 'ok', cwd: BASE_DIR });
});

// SSE endpoint - MCP standard: GET /sse
app.get('/sse', async (req, res) => {
  try {
    const server = createMcpServer();
    const transport = new SSEServerTransport('/sse', res);

    // Store session
    sessions.set(transport.sessionId, { server, transport });

    // Connect server to transport
    await server.connect(transport);

    // Cleanup on close
    transport.onclose = () => {
      sessions.delete(transport.sessionId);
    };
  } catch (error) {
    console.error('Error in /sse endpoint:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// SSE endpoint - GET /messages (fastmcp compatible)
app.get('/messages', async (req, res) => {
  try {
    const server = createMcpServer();
    const transport = new SSEServerTransport('/messages', res);

    // Store session
    sessions.set(transport.sessionId, { server, transport });

    // Connect server to transport
    await server.connect(transport);

    // Cleanup on close
    transport.onclose = () => {
      sessions.delete(transport.sessionId);
    };
  } catch (error) {
    console.error('Error in /messages endpoint:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Helper to get session ID from query params - supports both sessionId and session_id
function getSessionId(query: Record<string, unknown>): string | undefined {
  return (query.sessionId as string) || (query.session_id as string) || undefined;
}

// Message endpoint - MCP standard: POST /sse with sessionId
app.post('/sse', express.json(), async (req, res) => {
  try {
    const sessionId = getSessionId(req.query);

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }

    const session = sessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Use the transport's handlePostMessage method
    await session.transport.handlePostMessage(req, res, req.body);
  } catch (error) {
    console.error('Error in /sse POST endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Also support /messages as alternative (fastmcp compatible)
app.post('/messages', express.json(), async (req, res) => {
  try {
    const sessionId = getSessionId(req.query);

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }

    const session = sessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    await session.transport.handlePostMessage(req, res, req.body);
  } catch (error) {
    console.error('Error in /messages endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create /bin/sh symlink if not exists (Node.js exec requires it)
import { existsSync, symlinkSync } from 'fs';
import { dirname } from 'path';
try {
  const binSh = '/bin/sh';
  const usrBinSh = '/usr/bin/sh';
  if (!existsSync(binSh) && existsSync(usrBinSh)) {
    // Create parent directory if needed
    const binDir = dirname(binSh);
    if (!existsSync(binDir)) {
      // Can't create /bin, skip
      console.log('Note: /bin does not exist, skipping /bin/sh symlink');
    } else {
      symlinkSync(usrBinSh, binSh);
      console.log('Created /bin/sh symlink');
    }
  }
} catch (e) {
  console.log('Note: Could not create /bin/sh symlink:', e);
}

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Lumin MCP Server running on port ${PORT}`);
  console.log(`Target directory: ${BASE_DIR}`);
});

export { app };
