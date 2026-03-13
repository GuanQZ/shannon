// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 校验 TOTP 相关输入参数与安全边界，避免无效密钥或异常格式进入生成流程。
 * 该文件用于提升 MFA 工具调用可靠性。
 */

/**
 * TOTP Validator
 * TOTP Validator。
 *
 * Validates TOTP secrets and provides base32 decoding.
 * 校验 TOTP 密钥并提供 base32 解码能力。
 * Ported from tools/generate-totp-standalone.mjs (lines 43-72).
 * 逻辑移植自 tools/generate-totp-standalone.mjs（43-72 行）。
 */

/**
 * Base32 decode function
 * Base32 解码函数。
 * Ported from generate-totp-standalone.mjs
 * 逻辑移植自 generate-totp-standalone.mjs。
 */
export function base32Decode(encoded: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleanInput = encoded.toUpperCase().replace(/[^A-Z2-7]/g, '');

  if (cleanInput.length === 0) {
    return Buffer.alloc(0);
  }

  const output: number[] = [];
  let bits = 0;
  let value = 0;

  for (const char of cleanInput) {
    const index = alphabet.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid base32 character: ${char}`);
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(output);
}

/**
 * Validate TOTP secret
 * 校验 TOTP 密钥。
 * Must be base32-encoded string
 * 输入必须是 base32 编码字符串。
 *
 * @returns true if valid, throws Error if invalid
 * @returns 校验通过返回 true，校验失败抛出 Error。
 */
export function validateTotpSecret(secret: string): boolean {
  if (!secret || secret.length === 0) {
    throw new Error('TOTP secret cannot be empty');
  }

  // Check if it's valid base32 (only A-Z and 2-7, case-insensitive)
  // 检查是否为合法 base32（仅允许 A-Z 与 2-7，大小写不敏感）。
  const base32Regex = /^[A-Z2-7]+$/i;
  if (!base32Regex.test(secret.replace(/[^A-Z2-7]/gi, ''))) {
    throw new Error('TOTP secret must be base32-encoded (characters A-Z and 2-7)');
  }

  // Try to decode to ensure it's valid
  // 通过实际解码再次确认密钥合法。
  try {
    base32Decode(secret);
  } catch (error) {
    throw new Error(`Invalid TOTP secret: ${error instanceof Error ? error.message : String(error)}`);
  }

  return true;
}
