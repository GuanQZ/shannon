// Test SDK locally - minimal
import { query } from '@anthropic-ai/claude-agent-sdk';

(async () => {
  console.log('Starting local SDK test (no path)...');
  let count = 0;
  try {
    for await (const msg of query({
      prompt: 'Say hi',
      options: {
        maxTurns: 1,
        cwd: process.cwd(),
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
      },
    } as any)) {
      console.log('Msg type:', msg.type);
      count++;
      if (count > 5) break;
    }
    console.log('Done after', count, 'messages');
  } catch (e: any) {
    console.error('Error:', e.message);
  }
})();
