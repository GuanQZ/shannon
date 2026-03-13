// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 提供生成一次性验证码（`TOTP`）的 `MCP` 工具实现，用于多因子登录场景自动化。
 * 该文件支持渗透流程中受多因子认证保护的目标系统测试。
 * 用于生成六位 `TOTP` 验证码，服务于登录认证流程。

 * 该实现替代原先的 `tools/generate-totp-standalone.mjs` 脚本。
 * generate_totp MCP Tool
 * 算法遵循 `RFC 6238`（`TOTP`）与 `RFC 4226`（`HOTP`）。
 *
 * Generates 6-digit TOTP codes for authentication.
 * Generates 6-digit TOTP codes for authentication.。
 * Replaces tools/generate-totp-standalone.mjs bash script.
 * 对应替换旧脚本实现。
 * Based on RFC 6238 (TOTP) and RFC 4226 (HOTP).
 * 对应实现遵循上述标准。
 */

import { tool } from '@anthropic-ai/claude-agent-sdk';
import { createHmac } from 'crypto';
import { z } from 'zod';
import { createToolResult, type ToolResult, type GenerateTotpResponse } from '../types/tool-responses.js';
import { base32Decode, validateTotpSecret } from '../validation/totp-validator.js';
import { createCryptoError, createGenericError } from '../utils/error-formatter.js';

/**
 * Input schema for generate_totp tool
 * `generate_totp` 工具的输入参数结构。
 * 用途：约束调用方输入，避免非法密钥进入计算链路。
 * 关键参数：`secret` 为共享密钥。
 * 返回值：返回输入结构校验规则。
 * 失败分支：输入不满足约束时由校验器抛出错误。
 */
export const GenerateTotpInputSchema = z.object({
  secret: z
    .string()
    .min(1)
    .regex(/^[A-Z2-7]+$/i, 'Must be base32-encoded')
    .describe('Base32-encoded TOTP secret'),
});

export type GenerateTotpInput = z.infer<typeof GenerateTotpInputSchema>;

/**
 * Generate HOTP code (RFC 4226)
 * 按 `RFC 4226` 生成 `HOTP` 验证码。
 * Ported from generate-totp-standalone.mjs (lines 74-99)
 * 移植自 `generate-totp-standalone.mjs`（74-99 行）。
 * 用途：根据密钥与计数器计算一次性口令。
 * 关键参数：`secret` 是共享密钥，`counter` 是移动计数器，`digits` 指定位数。
 * 返回值：返回定长数字验证码字符串。
 * 失败分支：密钥解码或摘要计算失败时抛出异常。
 */
function generateHOTP(secret: string, counter: number, digits: number = 6): string {
  const key = base32Decode(secret);

  // Convert counter to 8-byte buffer (big-endian)
  // 将 `counter` 转为八字节大端序缓冲区。
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  // Generate HMAC-SHA1
  // 计算摘要值。
  const hmac = createHmac('sha1', key);
  hmac.update(counterBuffer);
  const hash = hmac.digest();

  // Dynamic truncation
  // 动态截断，提取 31 位整数。
  const offset = hash[hash.length - 1]! & 0x0f;
  const code =
    ((hash[offset]! & 0x7f) << 24) |
    ((hash[offset + 1]! & 0xff) << 16) |
    ((hash[offset + 2]! & 0xff) << 8) |
    (hash[offset + 3]! & 0xff);

  // Generate digits
  // 按位数要求补零，得到最终验证码字符串。
  const otp = (code % Math.pow(10, digits)).toString().padStart(digits, '0');
  return otp;
}

/**
 * Generate TOTP code (RFC 6238)
 * 按 `RFC 6238` 生成 `TOTP` 验证码。
 * Ported from generate-totp-standalone.mjs (lines 101-106)
 * 移植自 `generate-totp-standalone.mjs`（101-106 行）。
 * 用途：按时间步长生成当前有效验证码。
 * 关键参数：`secret` 为共享密钥，`timeStep` 为时间窗口秒数，`digits` 为位数。
 * 返回值：返回当前时间窗口对应的验证码。
 * 失败分支：底层口令计算失败时抛出异常。
 */
function generateTOTP(secret: string, timeStep: number = 30, digits: number = 6): string {
  const currentTime = Math.floor(Date.now() / 1000);
  const counter = Math.floor(currentTime / timeStep);
  return generateHOTP(secret, counter, digits);
}

/**
 * Get seconds until TOTP code expires
 * 返回当前 `TOTP` 剩余有效秒数。
 * 用途：给调用方展示验证码剩余有效时间。
 * 关键参数：`timeStep` 为时间窗口秒数。
 * 返回值：返回当前窗口剩余秒数。
 * 失败分支：本函数仅做时间计算，不抛出业务异常。
 */
function getSecondsUntilExpiration(timeStep: number = 30): number {
  const currentTime = Math.floor(Date.now() / 1000);
  return timeStep - (currentTime % timeStep);
}

/**
 * generate_totp tool implementation
 * `generate_totp` 工具实现。
 *
 * 参数：
 * - `secret`：Base32 编码的共享密钥。
 * 返回：
 * - 成功时返回验证码、生成时间与过期秒数。
 * 异常：
 * - 校验或加密相关错误返回可识别的业务错误结构；
 * - 其他异常统一走通用错误结构。
 *
 * 用途：对外提供验证码生成能力。
 * 关键参数：`args.secret` 提供共享密钥原文。
 * 返回值：返回包含验证码或错误信息的工具结果对象。
 * 失败分支：校验或加密异常走专用错误结构，其余异常走通用错误结构。
 */
export async function generateTotp(args: GenerateTotpInput): Promise<ToolResult> {
  try {
    const { secret } = args;

    // Validate secret (throws on error)
    // 校验 `secret`，不合法时会抛出异常。
    validateTotpSecret(secret);

    // Generate TOTP code
    // 生成 `TOTP` 验证码并计算剩余有效期。
    const totpCode = generateTOTP(secret);
    const expiresIn = getSecondsUntilExpiration();
    const timestamp = new Date().toISOString();

    // Success response
    // 组装成功响应。
    const successResponse: GenerateTotpResponse = {
      status: 'success',
      message: 'TOTP code generated successfully',
      totpCode,
      timestamp,
      expiresIn,
    };

    return createToolResult(successResponse);
  } catch (error) {
    // Check if it's a validation/crypto error
    // 判断是否为校验或加密相关错误。
    if (error instanceof Error && (error.message.includes('base32') || error.message.includes('TOTP'))) {
      const errorResponse = createCryptoError(error.message, false);
      return createToolResult(errorResponse);
    }

    // Generic error
    // 其他错误按通用格式返回。
    const errorResponse = createGenericError(error, false);
    return createToolResult(errorResponse);
  }
}

/**
 * Tool definition for MCP server - created using SDK's tool() function
 * `MCP` 服务中的工具定义，基于 `SDK` 的 `tool()` 构建。
 * 用途：向服务注册可调用工具。
 * 关键参数：工具名称、说明、输入结构与处理函数。
 * 返回值：返回可注册的工具对象。
 * 失败分支：定义阶段不执行计算，失败主要来自加载阶段异常。
 */
export const generateTotpTool = tool(
  'generate_totp',
  'Generates 6-digit TOTP code for authentication. Secret must be base32-encoded.',
  GenerateTotpInputSchema.shape,
  generateTotp
);
