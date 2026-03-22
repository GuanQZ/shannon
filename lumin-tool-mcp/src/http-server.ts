import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import cors from 'cors';
import { execSync } from 'child_process';
import { sdkTools } from './tools/sdk-tools.js';

// In-memory todo store (simple global store for now)
const globalTodoStore: Array<{
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}> = [];

// Get target directory from environment - support dynamic update via /set-cwd API
// Default to /app/repos/ as the base for target repos
let BASE_DIR = process.env.LUMIN_TARGET_REPO
  ? `/app/repos/${process.env.LUMIN_TARGET_REPO}`
  : '/app/repos/lumin-target';

// Store active server-transport pairs by session ID
const sessions = new Map<string, { server: Server; transport: SSEServerTransport }>();

// Filter SDK tools: allow all including Write and Bash
const allowedSdkToolNames = ['Read', 'Glob', 'Grep', 'Bash', 'Write'];

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
        description: 'Saves deliverable files with automatic validation. Queue files must have {"vulnerabilities": [...]} structure. For large reports, write the file to disk first then pass file_path instead of inline content to avoid output token limits.',
        inputSchema: {
          type: 'object',
          properties: {
            deliverable_type: { type: 'string', description: 'Type of deliverable (CODE_ANALYSIS, RECON, INJECTION_ANALYSIS, INJECTION_QUEUE, etc.)' },
            content: { type: 'string', description: 'File content (markdown for analysis/evidence, JSON for queues). Optional if file_path is provided.' },
            file_path: { type: 'string', description: 'Path to a file whose contents should be used as the deliverable content. Use this for large reports to avoid output token limits.' },
          },
          required: ['deliverable_type'],
        },
      },
      {
        name: 'generate_totp',
        description: 'Generates 6-digit TOTP code for authentication. Secret must be base32-encoded.',
        inputSchema: {
          type: 'object',
          properties: {
            secret: { type: 'string', description: 'Base32-encoded secret key for TOTP generation' },
          },
          required: ['secret'],
        },
      },
      {
        name: 'TodoWrite',
        description: 'Creates and manages task lists for tracking analysis progress. Use this to track multi-step analysis tasks.',
        inputSchema: {
          type: 'object',
          properties: {
            todos: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  content: { type: 'string', description: 'Task description' },
                  status: { type: 'string', enum: ['pending', 'in_progress', 'completed'], description: 'Task status' },
                  activeForm: { type: 'string', description: 'Active form - use "analyzing" for in_progress' },
                },
              },
              description: 'List of tasks to manage',
            },
          },
        },
      },
      {
        name: 'Task',
        description: 'Launch a new task - execute a sub-task in an isolated environment using LLM. Use this to parallelize independent analysis tasks. Launch multiple agents concurrently whenever possible, to maximize performance.',
        inputSchema: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'A short (3-5 word) description of the task' },
            prompt: { type: 'string', description: 'The task for the agent to perform' },
          },
          required: ['description', 'prompt'],
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

      if (toolName === 'TodoWrite') {
        const todos = (toolArgs as any)?.todos || [];
        const result = {
          status: 'ok',
          todos: todos.map((t: any, index: number) => ({
            id: `todo-${Date.now()}-${index}`,
            content: t.content || '',
            status: t.status || 'pending',
            activeForm: t.activeForm,
          })),
        };
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }

      if (toolName === 'Task') {
        const { executeTask, TaskInputSchema } = await import('./tools/task.js');
        const validatedArgs = TaskInputSchema.parse(toolArgs);
        const result = await executeTask(validatedArgs);
        return { content: [{ type: 'text', text: result.result }] };
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

// Health check endpoint - checks all critical processes
app.get('/health', (req, res) => {
  const checks = {
    mcpServer: true, // This is the current process
    temporalWorker: false,
    dashboard: false,
    playwrightMcp: false,
  };

  try {
    // Check if temporal worker is running
    const temporalProcess = execSync('pgrep -f "node.*temporal/worker"', { encoding: 'utf8' });
    checks.temporalWorker = !!temporalProcess.trim();
  } catch {
    checks.temporalWorker = false;
  }

  try {
    // Check if dashboard is running
    const dashboardProcess = execSync('pgrep -f "node.*dashboard/server"', { encoding: 'utf8' });
    checks.dashboard = !!dashboardProcess.trim();
  } catch {
    checks.dashboard = false;
  }

  try {
    // Check if playwright-mcp is running
    const playwrightProcess = execSync('pgrep -f "playwright-mcp"', { encoding: 'utf8' });
    checks.playwrightMcp = !!playwrightProcess.trim();
  } catch {
    checks.playwrightMcp = false;
  }

  const allHealthy = checks.mcpServer && checks.temporalWorker && checks.dashboard && checks.playwrightMcp;

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'ok' : 'degraded',
    server: 'lumin-tool-mcp',
    processes: checks,
  });
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
