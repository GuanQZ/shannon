import { z } from 'zod';

// In-memory todo store (per session)
const todoStore = new Map<string, Array<{
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}>>();

export const TodoWriteInputSchema = z.object({
  todos: z.array(z.object({
    content: z.string(),
    status: z.enum(['pending', 'in_progress', 'completed']).optional(),
    activeForm: z.string().optional(),
  })).optional(),
  todoId: z.string().optional(),
});

export type TodoWriteInput = z.infer<typeof TodoWriteInputSchema>;

export interface TodoWriteOutput {
  status: 'ok';
  todos: Array<{
    id: string;
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    activeForm?: string;
  }>;
}

/**
 * Creates a TodoWrite tool handler with session-specific storage
 */
export function createTodoWriteHandler(getSessionId: () => string) {
  return async function handleTodoWrite(input: TodoWriteInput): Promise<TodoWriteOutput> {
    const sessionId = getSessionId();

    // Initialize session store if not exists
    if (!todoStore.has(sessionId)) {
      todoStore.set(sessionId, []);
    }

    const todos = todoStore.get(sessionId)!;

    // Handle different operations
    if (input.todos) {
      // Replace all todos or add new ones
      const newTodos = input.todos.map((t, index) => ({
        id: `todo-${Date.now()}-${index}`,
        content: t.content,
        status: t.status || 'pending',
        activeForm: t.activeForm,
      }));

      // If replacing all, clear and set new
      // Otherwise append new ones
      const firstTodo = input.todos[0];
      if (input.todos.length > 0 && firstTodo && firstTodo.status === undefined) {
        // New todos being added, append them
        todos.push(...newTodos);
      } else {
        // Status updates, replace
        todos.length = 0;
        todos.push(...newTodos);
      }
    } else if (input.todoId) {
      // Update specific todo status
      const targetTodo = todos.find(t => t.id === input.todoId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const todosArr = input.todos as any;
      if (targetTodo && todosArr && todosArr[0] && todosArr[0].status) {
        targetTodo.status = todosArr[0].status;
      }
    }

    return {
      status: 'ok',
      todos: [...todos],
    };
  };
}

export const TodoWriteOutputSchema = z.object({
  status: z.literal('ok'),
  todos: z.array(z.object({
    id: z.string(),
    content: z.string(),
    status: z.enum(['pending', 'in_progress', 'completed']),
    activeForm: z.string().optional(),
  })),
});
