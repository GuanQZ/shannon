import { glob } from 'glob';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

// Resolve file path: use absolute path directly if provided, otherwise join with cwd
function resolvePath(filePath: string, cwd: string): string {
  // If it's an absolute path (starts with /), use it directly
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  // Otherwise, join with cwd
  return path.join(cwd, filePath);
}

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
    description: 'Reads local files, supports images/PDFs, defaults to 2000 lines. Returns the file content.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to file relative to repo root' },
      },
      required: ['file_path'],
    },
    handler: async (args: Record<string, unknown>, context: { cwd: string }) => {
      const file_path = args.file_path as string;
      const fullPath = resolvePath(file_path, context.cwd);
      const content = await fs.readFile(fullPath, 'utf-8');
      return content;
    },
  },
  {
    name: 'Glob',
    description: "Fast file pattern matching tool that works with any codebase size. Supports glob patterns like '**/*.js' or 'src/**/*.ts'. Returns matching file paths sorted by modification time. Use this tool when you need to find files by name patterns.",
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
    description: "Search for patterns in files. Use this tool when you need to find files containing specific patterns. Supports full regex syntax.",
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
      const searchDir = searchPath ? resolvePath(searchPath, context.cwd) : context.cwd;
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
    description: 'Executes bash commands in a persistent shell session with timeout support.',
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
    description: 'Writes/overwrites files to the local filesystem.',
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
      const fullPath = resolvePath(file_path, context.cwd);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, 'utf-8');
      return `File written: ${file_path}`;
    },
  },
];
