// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 负责进度显示组件的适配与降级控制，向执行流程提供统一的“进度管理器”接口。
 * 通过空对象模式保证在关闭进度显示时仍可无缝调用，减少主逻辑分支。
 */

// Null Object pattern for progress indicator - callers never check for null
// 进度指示器采用空对象模式，调用方无需判空。

import { ProgressIndicator } from '../progress-indicator.js';
import { extractAgentType } from '../utils/formatting.js';

export interface ProgressContext {
  description: string;
  useCleanOutput: boolean;
}

export interface ProgressManager {
  start(): void;
  stop(): void;
  finish(message: string): void;
  isActive(): boolean;
}

class RealProgressManager implements ProgressManager {
  private indicator: ProgressIndicator;
  private active: boolean = false;

  constructor(message: string) {
    this.indicator = new ProgressIndicator(message);
  }

  start(): void {
    this.indicator.start();
    this.active = true;
  }

  stop(): void {
    this.indicator.stop();
    this.active = false;
  }

  finish(message: string): void {
    this.indicator.finish(message);
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }
}

/** Null Object implementation - all methods are safe no-ops */
/* * 空值 对象 implementation - all methods are 安全 no-ops。 */
class NullProgressManager implements ProgressManager {
  start(): void {}

  stop(): void {}

  finish(_message: string): void {}

  isActive(): boolean {
    return false;
  }
}

// Returns no-op when disabled
// 禁用时返回空操作实现。
export function createProgressManager(
  context: ProgressContext,
  disableLoader: boolean
): ProgressManager {
  if (!context.useCleanOutput || disableLoader) {
    return new NullProgressManager();
  }

  const agentType = extractAgentType(context.description);
  return new RealProgressManager(`Running ${agentType}...`);
}
