// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * 文件说明：
 * 管理提示词模板加载、变量替换与共享片段拼装，向执行器输出可直接调用模型的完整提示。
 * 该文件是“配置驱动提示工程”的核心实现。
 */

import { fs, path } from 'zx';
import chalk from 'chalk';
import { PentestError, handlePromptError } from '../error-handling.js';
import { MCP_AGENT_MAPPING } from '../constants.js';
import type { Authentication, DistributedConfig } from '../types/config.js';

const GLOBAL_OUTPUT_LANGUAGE_POLICY = [
  '## Global Output Language Policy',
  '- All external-facing content MUST be written in Simplified Chinese (zh-CN).',
  '- This includes: progress narration, findings, recommendations, and final report text.',
  '- Keep technical identifiers (e.g., API names, CVE IDs, payloads, file paths, HTTP methods) in original form.',
  '- If source material is in English, translate the explanation to Chinese while preserving technical meaning.',
  '- Do not respond in English unless explicitly requested by the user.',
].join('\n');

interface PromptVariables {
  webUrl: string;
  repoPath: string;
  MCP_SERVER?: string;
}

interface IncludeReplacement {
  placeholder: string;
  content: string;
}

// Pure function: Build complete login instructions from config
// Pure 函数: Build complete login instructions 来自 配置。
async function buildLoginInstructions(authentication: Authentication): Promise<string> {
  try {
    // Load the login instructions template
    // 加载 the login instructions template。
    const loginInstructionsPath = path.join(import.meta.dirname, '..', '..', 'prompts', 'shared', 'login-instructions.txt');

    if (!await fs.pathExists(loginInstructionsPath)) {
      throw new PentestError(
        'Login instructions template not found',
        'filesystem',
        false,
        { loginInstructionsPath }
      );
    }

    const fullTemplate = await fs.readFile(loginInstructionsPath, 'utf8');

    // Helper function to extract sections based on markers
    // 辅助 函数 to extract sections 基于 于 markers。
    const getSection = (content: string, sectionName: string): string => {
      const regex = new RegExp(`<!-- BEGIN:${sectionName} -->([\\s\\S]*?)<!-- END:${sectionName} -->`, 'g');
      const match = regex.exec(content);
      return match ? match[1]!.trim() : '';
    };

    // Extract sections based on login type
    // Extract sections 基于 于 login 类型。
    const loginType = authentication.login_type?.toUpperCase();
    let loginInstructions = '';

    // Build instructions with only relevant sections
    // Build instructions with 仅 relevant sections。
    const commonSection = getSection(fullTemplate, 'COMMON');
    const authSection = loginType ? getSection(fullTemplate, loginType) : ''; // FORM or SSO
    const verificationSection = getSection(fullTemplate, 'VERIFICATION');

    // Fallback to full template if markers are missing (backward compatibility)
    // 回退 to full template 如果 markers are 缺失 (backward compatibility)。
    if (!commonSection && !authSection && !verificationSection) {
      console.log(chalk.yellow('⚠️ Section markers not found, using full login instructions template'));
      loginInstructions = fullTemplate;
    } else {
      // Combine relevant sections
      // Combine relevant sections。
      loginInstructions = [commonSection, authSection, verificationSection]
        .filter(section => section) // Remove empty sections
        .join('\n\n');
    }

    // Replace the user instructions placeholder with the login flow from config
    // Replace the user instructions placeholder with the login flow 来自 配置。
    let userInstructions = (authentication.login_flow ?? []).join('\n');

    // Replace credential placeholders within the user instructions
    // Replace credential placeholders within the user instructions。
    if (authentication.credentials) {
      if (authentication.credentials.username) {
        userInstructions = userInstructions.replace(/\$username/g, authentication.credentials.username);
      }
      if (authentication.credentials.password) {
        userInstructions = userInstructions.replace(/\$password/g, authentication.credentials.password);
      }
      if (authentication.credentials.totp_secret) {
        userInstructions = userInstructions.replace(/\$totp/g, `generated TOTP code using secret "${authentication.credentials.totp_secret}"`);
      }
    }

    loginInstructions = loginInstructions.replace(/{{user_instructions}}/g, userInstructions);

    // Replace TOTP secret placeholder if present in template
    // Replace TOTP secret placeholder 如果 present in template。
    if (authentication.credentials?.totp_secret) {
      loginInstructions = loginInstructions.replace(/{{totp_secret}}/g, authentication.credentials.totp_secret);
    }

    return loginInstructions;
  } catch (error) {
    if (error instanceof PentestError) {
      throw error;
    }
    const errMsg = error instanceof Error ? error.message : String(error);
    throw new PentestError(
      `Failed to build login instructions: ${errMsg}`,
      'config',
      false,
      { authentication, originalError: errMsg }
    );
  }
}

// Pure function: Process @include() directives
// Pure 函数: Process @include() directives。
async function processIncludes(content: string, baseDir: string): Promise<string> {
  const includeRegex = /@include\(([^)]+)\)/g;
  // Use a Promise.all to handle all includes concurrently
  // 使用 a Promise.all to 处理 all includes concurrently。
  const replacements: IncludeReplacement[] = await Promise.all(
    Array.from(content.matchAll(includeRegex)).map(async (match) => {
      const includePath = path.join(baseDir, match[1]!);
      const sharedContent = await fs.readFile(includePath, 'utf8');
      return {
        placeholder: match[0],
        content: sharedContent,
      };
    })
  );

  for (const replacement of replacements) {
    content = content.replace(replacement.placeholder, replacement.content);
  }
  return content;
}

// Pure function: Variable interpolation
// Pure 函数: Variable interpolation。
async function interpolateVariables(
  template: string,
  variables: PromptVariables,
  config: DistributedConfig | null = null
): Promise<string> {
  try {
    if (!template || typeof template !== 'string') {
      throw new PentestError(
        'Template must be a non-empty string',
        'validation',
        false,
        { templateType: typeof template, templateLength: template?.length }
      );
    }

    if (!variables || !variables.webUrl || !variables.repoPath) {
      throw new PentestError(
        'Variables must include webUrl and repoPath',
        'validation',
        false,
        { variables: Object.keys(variables || {}) }
      );
    }

    let result = template
      .replace(/{{WEB_URL}}/g, variables.webUrl)
      .replace(/{{REPO_PATH}}/g, variables.repoPath)
      .replace(/{{MCP_SERVER}}/g, variables.MCP_SERVER || 'playwright-agent1');

    if (config) {
      // Handle rules section - if both are empty, use cleaner messaging
      // 处理 规则 section - 如果 both are empty, 使用 cleaner messaging。
      const hasAvoidRules = config.avoid && config.avoid.length > 0;
      const hasFocusRules = config.focus && config.focus.length > 0;

      if (!hasAvoidRules && !hasFocusRules) {
        // Replace the entire rules section with a clean message
        // Replace the entire 规则 section with a clean 消息。
        const cleanRulesSection = '<rules>\nNo specific rules or focus areas provided for this test.\n</rules>';
        result = result.replace(/<rules>[\s\S]*?<\/rules>/g, cleanRulesSection);
      } else {
        const avoidRules = hasAvoidRules ? config.avoid!.map(r => `- ${r.description}`).join('\n') : 'None';
        const focusRules = hasFocusRules ? config.focus!.map(r => `- ${r.description}`).join('\n') : 'None';

        result = result
          .replace(/{{RULES_AVOID}}/g, avoidRules)
          .replace(/{{RULES_FOCUS}}/g, focusRules);
      }

      // Extract and inject login instructions from config
      // Extract and inject login instructions 来自 配置。
      if (config.authentication?.login_flow) {
        const loginInstructions = await buildLoginInstructions(config.authentication);
        result = result.replace(/{{LOGIN_INSTRUCTIONS}}/g, loginInstructions);
      } else {
        result = result.replace(/{{LOGIN_INSTRUCTIONS}}/g, '');
      }
    } else {
      // Replace the entire rules section with a clean message when no config provided
      // Replace the entire 规则 section with a clean 消息 当 no 配置 provided。
      const cleanRulesSection = '<rules>\nNo specific rules or focus areas provided for this test.\n</rules>';
      result = result.replace(/<rules>[\s\S]*?<\/rules>/g, cleanRulesSection);
      result = result.replace(/{{LOGIN_INSTRUCTIONS}}/g, '');
    }

    // Validate that all placeholders have been replaced (excluding instructional text)
    // 校验 that all placeholders have been replaced (excluding instructional text)。
    const remainingPlaceholders = result.match(/\{\{[^}]+\}\}/g);
    if (remainingPlaceholders) {
      console.log(chalk.yellow(`⚠️ Warning: Found unresolved placeholders in prompt: ${remainingPlaceholders.join(', ')}`));
    }

    return result;
  } catch (error) {
    if (error instanceof PentestError) {
      throw error;
    }
    const errMsg = error instanceof Error ? error.message : String(error);
    throw new PentestError(
      `Variable interpolation failed: ${errMsg}`,
      'prompt',
      false,
      { originalError: errMsg }
    );
  }
}

// Pure function: Load and interpolate prompt template
// Pure 函数: 加载 and interpolate prompt template。
export async function loadPrompt(
  promptName: string,
  variables: PromptVariables,
  config: DistributedConfig | null = null,
  pipelineTestingMode: boolean = false
): Promise<string> {
  try {
    // Use pipeline testing prompts if pipeline testing mode is enabled
    // 使用 流水线 testing prompts 如果 流水线 testing 模式 is enabled。
    const baseDir = pipelineTestingMode ? 'prompts/pipeline-testing' : 'prompts';
    const promptsDir = path.join(import.meta.dirname, '..', '..', baseDir);
    const promptPath = path.join(promptsDir, `${promptName}.txt`);

    // Debug message for pipeline testing mode
    // Debug 消息 for 流水线 testing 模式。
    if (pipelineTestingMode) {
      console.log(chalk.yellow(`⚡ Using pipeline testing prompt: ${promptPath}`));
    }

    // Check if file exists first
    // 检查 如果 文件 exists first。
    if (!await fs.pathExists(promptPath)) {
      throw new PentestError(
        `Prompt file not found: ${promptPath}`,
        'prompt',
        false,
        { promptName, promptPath }
      );
    }

    // Add MCP server assignment to variables
    // Add MCP 服务 assignment to variables。
    const enhancedVariables: PromptVariables = { ...variables };

    // Assign MCP server based on prompt name (agent name)
    // Assign MCP 服务 基于 于 prompt name (代理 name)。
    const mcpServer = MCP_AGENT_MAPPING[promptName as keyof typeof MCP_AGENT_MAPPING];
    if (mcpServer) {
      enhancedVariables.MCP_SERVER = mcpServer;
      console.log(chalk.gray(`    🎭 Assigned ${promptName} → ${enhancedVariables.MCP_SERVER}`));
    } else {
      // Fallback for unknown agents
      // 回退 for unknown agents。
      enhancedVariables.MCP_SERVER = 'playwright-agent1';
      console.log(chalk.yellow(`    🎭 Unknown agent ${promptName}, using fallback → ${enhancedVariables.MCP_SERVER}`));
    }

    let template = await fs.readFile(promptPath, 'utf8');

    // Pre-process the template to handle @include directives
    // Pre-process the template to 处理 @include directives。
    template = await processIncludes(template, promptsDir);

    const interpolatedPrompt = await interpolateVariables(template, enhancedVariables, config);
    return `${GLOBAL_OUTPUT_LANGUAGE_POLICY}\n\n${interpolatedPrompt}`;
  } catch (error) {
    if (error instanceof PentestError) {
      throw error;
    }
    const promptError = handlePromptError(promptName, error as Error);
    throw promptError.error;
  }
}
