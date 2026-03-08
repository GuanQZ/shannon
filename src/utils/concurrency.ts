// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 提供并发控制辅助函数，用于限制并行任务数量与协调异步执行节奏。
 * 该文件帮助在效率与资源占用之间取得平衡。
 */

/**
 * Concurrency Control Utilities
 * Concurrency Control Utilities。
 *
 * Provides mutex implementation for preventing race conditions during
 * Provides mutex implementation for preventing race conditions during。
 * concurrent session operations.
 * concurrent session operations.。
 */

type UnlockFunction = () => void;

/**
 * SessionMutex - Promise-based mutex for session file operations
 * SessionMutex - Promise-基于 mutex for session 文件 operations。
 *
 * Prevents race conditions when multiple agents or operations attempt to
 * Prevents race conditions 当 multiple agents or operations attempt to。
 * modify the same session data simultaneously. This is particularly important
 * modify the same session data simultaneously. This is particularly important。
 * during parallel execution of vulnerability analysis and exploitation phases.
 * during 并行 execution of 漏洞 analysis and 利用 phases.。
 *
 * Usage:
 * Usage:。
 * ```ts
 * ```ts。
 * const mutex = new SessionMutex();
 * const mutex = new SessionMutex();。
 * const unlock = await mutex.lock(sessionId);
 * const unlock = await mutex.lock(sessionId);。
 * try {
 * try {。
 *   // Critical section - modify session data
 * // Critical section - modify session data。
 * } finally {
 * } finally {。
 *   unlock(); // Always release the lock
 * unlock(); // Always release the lock。
 * }
 * ```
 */
// Promise-based mutex with queue semantics - safe for parallel agents on same session
// Promise-基于 mutex with 队列 semantics - 安全 for 并行 agents 于 same session。
export class SessionMutex {
  // Map of sessionId -> Promise (represents active lock)
  // Map of sessionId -> Promise (represents active lock)。
  private locks: Map<string, Promise<void>> = new Map();

  // Wait for existing lock, then acquire. Queue ensures FIFO ordering.
  // Wait for existing lock, then acquire. 队列 ensures FIFO ordering.。
  async lock(sessionId: string): Promise<UnlockFunction> {
    if (this.locks.has(sessionId)) {
      // Wait for existing lock to be released
      // Wait for existing lock to be released。
      await this.locks.get(sessionId);
    }

    // Create new lock promise
    // 创建 new lock promise。
    let resolve: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    this.locks.set(sessionId, promise);

    // Return unlock function
    // 返回 unlock 函数。
    return () => {
      this.locks.delete(sessionId);
      resolve!();
    };
  }
}
