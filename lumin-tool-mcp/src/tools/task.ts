import { z } from 'zod';

/**
 * Task Tool - Execute a sub-task using LLM
 *
 * This tool allows the LLM to spawn a sub-agent to handle independent tasks.
 * Similar to Claude Code's Task tool with parameters:
 * - description: Brief task description (3-5 words)
 * - prompt: Detailed task instructions
 */

export const TaskInputSchema = z.object({
  description: z.string().describe('A short (3-5 word) description of the task'),
  prompt: z.string().describe('The task for the agent to perform'),
});

export type TaskInput = z.infer<typeof TaskInputSchema>;

/**
 * Task tool handler
 *
 * Calls the internal agent chat API to execute a sub-task.
 * Uses environment variables to configure the agent endpoint.
 */
export async function executeTask(input: TaskInput): Promise<{ result: string }> {
  // Inject restrictions to prevent sub-agents from using save_deliverable
  // Only the main agent should create official deliverables
  const restrictedPrompt = `
[SYSTEM RESTRICTION - AUTOMATICALLY APPLIED]
- DO NOT call save_deliverable MCP tool

- Choose ONE of the following approaches:

  Approach 1 - Return as text (only if content is brief, a few sentences):
  - Return the result directly as text
  - Do NOT write to file

  Approach 2 - Save to file (if content is detailed):
  - Use Write tool to save to deliverables/ directory
  - Return ONLY: "Saved to <file_path> - <brief description>. Please read this file for details."
  - Do NOT include the full content in the response

- Do NOT do both: do NOT return full content AND write to file

${input.prompt}
`;

  const {
    INTERNAL_AGENT_BASE_URL = 'http://mock-server:3000',
    INTERNAL_AGENT_INIT_SESSION_APP_ID = 'mock-app-id',
    INTERNAL_AGENT_INIT_SESSION_TR_CODE = 'mock-tr-code',
    INTERNAL_AGENT_INIT_SESSION_TR_VERSION = '1',
    INTERNAL_AGENT_INIT_SESSION_AGENT_ID = 'tool-agent-1',
    INTERNAL_AGENT_CHAT_APP_ID = 'mock-app-id',
    INTERNAL_AGENT_CHAT_TR_CODE = 'mock-tr-code',
    INTERNAL_AGENT_CHAT_TR_VERSION = '1',
    INTERNAL_AGENT_CHAT_STREAM = 'true',
  } = process.env;

  const baseUrl = INTERNAL_AGENT_BASE_URL.replace(/\/$/, '');
  const agentId = INTERNAL_AGENT_INIT_SESSION_AGENT_ID;
  const timestamp = Date.now();
  const requestId = `task-${timestamp}`;

  // Step 1: Initialize session
  const initUrl = `${baseUrl}/agent-api/${agentId}/chatabc/init_session`;
  const initBody = {
    appId: INTERNAL_AGENT_INIT_SESSION_APP_ID,
    trCode: INTERNAL_AGENT_INIT_SESSION_TR_CODE,
    trVersion: INTERNAL_AGENT_INIT_SESSION_TR_VERSION,
    timestamp,
    requestId,
    data: {
      prompt_variables: [],
    },
  };

  console.log(`[Task] Initializing session: ${initUrl}`);

  const initResponse = await fetch(initUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(initBody),
  });

  if (!initResponse.ok) {
    throw new Error(`Task init_session failed: ${initResponse.status} ${initResponse.statusText}`);
  }

  const initData = await initResponse.json() as { data: { session_id?: string } };
  const sessionId = initData.data.session_id;

  if (!sessionId) {
    throw new Error('Task failed to get session_id');
  }

  console.log(`[Task] Session initialized: ${sessionId}`);

  // Step 2: Send chat request
  const chatUrl = `${baseUrl}/agent-api/${agentId}/chatabc/chat`;
  const chatBody = {
    appId: INTERNAL_AGENT_CHAT_APP_ID,
    trCode: INTERNAL_AGENT_CHAT_TR_CODE,
    trVersion: INTERNAL_AGENT_CHAT_TR_VERSION,
    timestamp: Date.now(),
    requestId: `task-${Date.now()}`,
    data: {
      session_id: sessionId,
      txt: restrictedPrompt,
      stream: INTERNAL_AGENT_CHAT_STREAM === 'true',
      files: [],
    },
  };

  console.log(`[Task] Sending chat request, prompt length: ${input.prompt.length} chars`);

  const chatResponse = await fetch(chatUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(chatBody),
  });

  if (!chatResponse.ok) {
    throw new Error(`Task chat failed: ${chatResponse.status} ${chatResponse.statusText}`);
  }

  // Parse SSE stream
  const body = chatResponse.body;
  if (!body) {
    throw new Error('Task chat response body is null');
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = '';
  let result = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmedLine = line.trim();

        if (trimmedLine.startsWith('event:')) {
          currentEvent = trimmedLine.slice(6).trim();
          continue;
        }

        if (trimmedLine.startsWith('data:')) {
          const data = trimmedLine.slice(6).trim();

          // Infer event type from data content if currentEvent is empty
          let eventType = currentEvent || 'message';
          if (!currentEvent || currentEvent === 'message') {
            if (data.includes('"chat_id"')) {
              eventType = 'chat_started';
            } else if (data.includes('"code"') && data.includes('"success"')) {
              eventType = 'done';
            }
          }

          // Check for done event - only break on actual done event
          if (eventType === 'done') {
            break;
          }

          if (data.startsWith('{') && eventType === 'message') {
            try {
              const eventData = JSON.parse(data);

              // Extract text content from AIMessageChunk
              if (eventData.type === 'AIMessageChunk' && eventData.content) {
                result += eventData.content;
              }

              // Also check for other message types with content
              if (eventData.content && typeof eventData.content === 'string') {
                result += eventData.content;
              }
            } catch {
              // Skip invalid JSON
            }
          }

          currentEvent = '';
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  console.log(`[Task] Completed, result length: ${result.length} chars`);

  return { result: result || '[No response from agent]' };
}

export const TaskOutputSchema = z.object({
  result: z.string(),
});
