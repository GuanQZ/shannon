import { glob } from 'glob';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

// Execute command using spawn (more reliable than exec for shell commands)
function execCommand(command: string, cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], {
      cwd,
      env: { ...process.env, HOME: process.env.HOME || '/tmp' }
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });

    child.on('close', (code) => {
      resolve(stdout || stderr || `Process exited with code ${code}`);
    });

    child.on('error', (err) => {
      resolve(`Error: ${err.message}`);
    });
  });
}

export interface SDKTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
  handler: (args: Record<string, unknown>, context: { cwd: string }) => Promise<unknown>;
}

const REPO_DIR = process.env.LUMIN_TARGET_REPO || 'default';
const BASE_DIR = `/app/deliverables/${REPO_DIR}`;

export const sdkTools: SDKTool[] = [
  {
    name: 'Read',
    description: 'Read a file from the repository. Returns the file content.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to file relative to repo root' },
      },
      required: ['file_path'],
    },
    handler: async (args: Record<string, unknown>, context: { cwd: string }) => {
      const file_path = args.file_path as string;
      const fullPath = path.join(context.cwd, file_path);
      const content = await fs.readFile(fullPath, 'utf-8');
      return content;
    },
  },
  {
    name: 'Glob',
    description: 'Find files matching a pattern in the repository.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g., **/*.ts)' },
      },
      required: ['pattern'],
    },
    handler: async (args: Record<string, unknown>, context: { cwd: string }) => {
      const pattern = args.pattern as string;
      const files = await glob(pattern, { cwd: context.cwd });
      return JSON.stringify(files);
    },
  },
  {
    name: 'Grep',
    description: 'Search for patterns in files.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Search pattern' },
        path: { type: 'string', description: 'File path or directory to search' },
      },
      required: ['pattern'],
    },
    handler: async (args: Record<string, unknown>, context: { cwd: string }) => {
      const pattern = args.pattern as string;
      const searchPath = args.path as string | undefined;
      const searchDir = searchPath ? path.join(context.cwd, searchPath) : context.cwd;
      try {
        const { stdout } = await execAsync(`rg -n "${pattern}" "${searchDir}" || true`);
        return stdout || 'No matches found';
      } catch {
        return 'No matches found';
      }
    },
  },
  {
    name: 'Bash',
    description: 'Run a shell command in the repository.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to run' },
      },
      required: ['command'],
    },
    handler: async (args: Record<string, unknown>, context: { cwd: string }) => {
      const command = args.command as string;
      try {
        // Use spawn for more reliable shell execution
        return await execCommand(command, context.cwd);
      } catch (error: unknown) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },
  {
    name: 'Write',
    description: 'Write content to a file in the repository.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to file relative to repo root' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['file_path', 'content'],
    },
    handler: async (args: Record<string, unknown>, context: { cwd: string }) => {
      const file_path = args.file_path as string;
      const content = args.content as string;
      const fullPath = path.join(context.cwd, file_path);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, 'utf-8');
      return `File written: ${file_path}`;
    },
  },
];
