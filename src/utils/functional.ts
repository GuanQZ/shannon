// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 提供函数式编程工具（组合、管道、结果处理）以简化复杂异步流程表达。
 * 该文件帮助业务代码保持可测试与可推理。
 */

/**
 * Functional Programming Utilities
 * Functional Programming Utilities。
 *
 * Generic functional composition patterns for async operations.
 * Generic functional composition patterns for async operations.。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any。
type PipelineFunction = (x: any) => any | Promise<any>;

/**
 * Async pipeline that passes result through a series of functions.
 * Async 流水线 that passes 结果 through a series of 函数.。
 * Clearer than reduce-based pipe and easier to debug.
 * Clearer than reduce-基于 pipe and easier to debug.。
 */
export async function asyncPipe<TResult>(
  initial: unknown,
  ...fns: PipelineFunction[]
): Promise<TResult> {
  let result = initial;
  for (const fn of fns) {
    result = await fn(result);
  }
  return result as TResult;
}
