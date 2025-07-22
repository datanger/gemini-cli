/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ExecutionResult } from '../core/toolCallCoordinator.js';
import { WorkflowPhase, WorkflowContext } from '../core/workflowStateManager.js';

/**
 * 格式化配置接口
 */
export interface FormatterConfig {
  enableColors: boolean;
  enableIcons: boolean;
  compactMode: boolean;
  maxWidth: number;
  indentSize: number;
  showTimestamps: boolean;
  showMetadata: boolean;
  language: 'zh' | 'en';
}

/**
 * 格式化样式枚举
 */
export enum FormatStyle {
  MINIMAL = 'minimal',
  STANDARD = 'standard',
  DETAILED = 'detailed',
  JSON = 'json',
  MARKDOWN = 'markdown',
  HTML = 'html'
}

/**
 * 结果类型枚举
 */
export enum ResultType {
  TOOL_EXECUTION = 'tool_execution',
  WORKFLOW_REPORT = 'workflow_report',
  ERROR_REPORT = 'error_report',
  PROGRESS_UPDATE = 'progress_update',
  SYSTEM_STATUS = 'system_status'
}

/**
 * 格式化结果接口
 */
export interface FormattedResult {
  content: string;
  metadata: {
    type: ResultType;
    style: FormatStyle;
    timestamp: number;
    size: number;
  };
}

/**
 * 结果格式化器
 */
export class ResultFormatter {
  private config: FormatterConfig;
  private colorTheme: ColorTheme;
  private iconSet: IconSet;

  constructor(config: Partial<FormatterConfig> = {}) {
    this.config = {
      enableColors: true,
      enableIcons: true,
      compactMode: false,
      maxWidth: 80,
      indentSize: 2,
      showTimestamps: true,
      showMetadata: false,
      language: 'zh',
      ...config
    };

    this.colorTheme = new ColorTheme();
    this.iconSet = new IconSet();
  }

  /**
   * 格式化工具执行结果
   */
  formatToolExecutionResult(result: ExecutionResult, style: FormatStyle = FormatStyle.STANDARD): FormattedResult {
    let content = '';

    switch (style) {
      case FormatStyle.MINIMAL:
        content = this.formatMinimalToolResult(result);
        break;
      case FormatStyle.STANDARD:
        content = this.formatStandardToolResult(result);
        break;
      case FormatStyle.DETAILED:
        content = this.formatDetailedToolResult(result);
        break;
      case FormatStyle.JSON:
        content = this.formatJsonToolResult(result);
        break;
      case FormatStyle.MARKDOWN:
        content = this.formatMarkdownToolResult(result);
        break;
      case FormatStyle.HTML:
        content = this.formatHtmlToolResult(result);
        break;
    }

    return {
      content,
      metadata: {
        type: ResultType.TOOL_EXECUTION,
        style,
        timestamp: Date.now(),
        size: content.length
      }
    };
  }

  /**
   * 格式化工作流报告
   */
  formatWorkflowReport(context: WorkflowContext, results: ExecutionResult[], style: FormatStyle = FormatStyle.DETAILED): FormattedResult {
    let content = '';

    switch (style) {
      case FormatStyle.MINIMAL:
        content = this.formatMinimalWorkflowReport(context, results);
        break;
      case FormatStyle.STANDARD:
        content = this.formatStandardWorkflowReport(context, results);
        break;
      case FormatStyle.DETAILED:
        content = this.formatDetailedWorkflowReport(context, results);
        break;
      case FormatStyle.MARKDOWN:
        content = this.formatMarkdownWorkflowReport(context, results);
        break;
      case FormatStyle.JSON:
        content = this.formatJsonWorkflowReport(context, results);
        break;
      case FormatStyle.HTML:
        content = this.formatHtmlWorkflowReport(context, results);
        break;
    }

    return {
      content,
      metadata: {
        type: ResultType.WORKFLOW_REPORT,
        style,
        timestamp: Date.now(),
        size: content.length
      }
    };
  }

  /**
   * 格式化错误报告
   */
  formatErrorReport(errors: Error[], context?: any, style: FormatStyle = FormatStyle.STANDARD): FormattedResult {
    let content = '';

    switch (style) {
      case FormatStyle.MINIMAL:
        content = this.formatMinimalErrorReport(errors);
        break;
      case FormatStyle.STANDARD:
        content = this.formatStandardErrorReport(errors, context);
        break;
      case FormatStyle.DETAILED:
        content = this.formatDetailedErrorReport(errors, context);
        break;
      case FormatStyle.MARKDOWN:
        content = this.formatMarkdownErrorReport(errors, context);
        break;
      case FormatStyle.JSON:
        content = this.formatJsonErrorReport(errors, context);
        break;
    }

    return {
      content,
      metadata: {
        type: ResultType.ERROR_REPORT,
        style,
        timestamp: Date.now(),
        size: content.length
      }
    };
  }

  /**
   * 格式化系统状态
   */
  formatSystemStatus(status: any, style: FormatStyle = FormatStyle.STANDARD): FormattedResult {
    let content = '';

    switch (style) {
      case FormatStyle.MINIMAL:
        content = this.formatMinimalSystemStatus(status);
        break;
      case FormatStyle.STANDARD:
        content = this.formatStandardSystemStatus(status);
        break;
      case FormatStyle.DETAILED:
        content = this.formatDetailedSystemStatus(status);
        break;
      case FormatStyle.JSON:
        content = JSON.stringify(status, null, this.config.indentSize);
        break;
      case FormatStyle.MARKDOWN:
        content = this.formatMarkdownSystemStatus(status);
        break;
    }

    return {
      content,
      metadata: {
        type: ResultType.SYSTEM_STATUS,
        style,
        timestamp: Date.now(),
        size: content.length
      }
    };
  }

  /**
   * 更新格式化配置
   */
  updateConfig(newConfig: Partial<FormatterConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * 获取当前配置
   */
  getConfig(): FormatterConfig {
    return { ...this.config };
  }

  // 私有格式化方法 - 工具执行结果

  private formatMinimalToolResult(result: ExecutionResult): string {
    const icon = this.getResultIcon(result.success);
    const status = result.success ? '成功' : '失败';
    return `${icon} ${this.extractToolName(result.toolCallId)}: ${status}`;
  }

  private formatStandardToolResult(result: ExecutionResult): string {
    const lines: string[] = [];
    const icon = this.getResultIcon(result.success);
    const color = this.getResultColor(result.success);
    const toolName = this.extractToolName(result.toolCallId);

    // 标题行
    lines.push(this.colorize(`${icon} 工具执行结果: ${toolName}`, color));
    
    // 基本信息
    lines.push(`  状态: ${result.success ? '✅ 成功' : '❌ 失败'}`);
    lines.push(`  执行时间: ${result.executionTime}ms`);
    
    if (result.retryCount > 0) {
      lines.push(`  重试次数: ${result.retryCount}`);
    }

    // 结果内容
    if (result.result) {
      lines.push(`  结果:`);
      lines.push(this.indentText(this.formatResultContent(result.result), 4));
    }

    // 错误信息
    if (result.error) {
      lines.push(`  错误: ${this.colorize(result.error.message, 'red')}`);
    }

    return lines.join('\n');
  }

  private formatDetailedToolResult(result: ExecutionResult): string {
    const lines: string[] = [];
    const separator = '─'.repeat(this.config.maxWidth);
    
    lines.push(separator);
    lines.push(this.formatStandardToolResult(result));
    
    if (this.config.showMetadata) {
      lines.push('');
      lines.push('  元数据:');
      lines.push(`    工具ID: ${result.toolCallId}`);
      
      if (this.config.showTimestamps) {
        lines.push(`    时间戳: ${new Date().toLocaleString()}`);
      }
    }
    
    lines.push(separator);
    return lines.join('\n');
  }

  private formatJsonToolResult(result: ExecutionResult): string {
    return JSON.stringify(result, null, this.config.indentSize);
  }

  private formatMarkdownToolResult(result: ExecutionResult): string {
    const toolName = this.extractToolName(result.toolCallId);
    const status = result.success ? '✅ 成功' : '❌ 失败';
    
    const lines: string[] = [
      `## 工具执行结果: ${toolName}`,
      '',
      `**状态**: ${status}`,
      `**执行时间**: ${result.executionTime}ms`,
    ];

    if (result.retryCount > 0) {
      lines.push(`**重试次数**: ${result.retryCount}`);
    }

    if (result.result) {
      lines.push('', '### 执行结果', '', '```json', JSON.stringify(result.result, null, 2), '```');
    }

    if (result.error) {
      lines.push('', '### 错误信息', '', '```', result.error.message, '```');
    }

    return lines.join('\n');
  }

  private formatHtmlToolResult(result: ExecutionResult): string {
    const toolName = this.extractToolName(result.toolCallId);
    const statusColor = result.success ? 'green' : 'red';
    const statusText = result.success ? '成功' : '失败';

    return `
<div class="tool-result">
  <h3>工具执行结果: ${toolName}</h3>
  <p><strong>状态</strong>: <span style="color: ${statusColor}">${statusText}</span></p>
  <p><strong>执行时间</strong>: ${result.executionTime}ms</p>
  ${result.retryCount > 0 ? `<p><strong>重试次数</strong>: ${result.retryCount}</p>` : ''}
  ${result.result ? `<div><strong>结果</strong>: <pre>${JSON.stringify(result.result, null, 2)}</pre></div>` : ''}
  ${result.error ? `<div><strong>错误</strong>: <pre style="color: red">${result.error.message}</pre></div>` : ''}
</div>
    `.trim();
  }

  // 私有格式化方法 - 工作流报告

  private formatMinimalWorkflowReport(context: WorkflowContext, results: ExecutionResult[]): string {
    const successCount = results.filter(r => r.success).length;
    const totalCount = results.length;
    const duration = Date.now() - context.createdAt;
    
    return `📊 工作流完成: ${successCount}/${totalCount} 成功, 用时 ${this.formatDuration(duration)}`;
  }

  private formatStandardWorkflowReport(context: WorkflowContext, results: ExecutionResult[]): string {
    const lines: string[] = [];
    const duration = Date.now() - context.createdAt;
    const successCount = results.filter(r => r.success).length;
    const errorCount = results.filter(r => !r.success).length;

    lines.push('📊 工作流执行报告');
    lines.push('');
    lines.push(`任务描述: ${context.taskDescription}`);
    lines.push(`执行范围: ${context.scope}`);
    lines.push(`总执行时间: ${this.formatDuration(duration)}`);
    lines.push('');
    lines.push('执行统计:');
    lines.push(`  ✅ 成功: ${successCount}`);
    lines.push(`  ❌ 失败: ${errorCount}`);
    lines.push(`  📊 总计: ${results.length}`);

    if (results.length > 0) {
      lines.push('');
      lines.push('阶段执行情况:');
      this.getPhasesSummary(context).forEach(phaseSummary => {
        lines.push(`  ${phaseSummary}`);
      });
    }

    return lines.join('\n');
  }

  private formatDetailedWorkflowReport(context: WorkflowContext, results: ExecutionResult[]): string {
    const lines: string[] = [];
    
    lines.push(this.formatStandardWorkflowReport(context, results));
    lines.push('');
    lines.push('详细执行结果:');
    lines.push('');

    results.forEach((result, index) => {
      lines.push(`${index + 1}. ${this.formatMinimalToolResult(result)}`);
      if (result.error) {
        lines.push(`   错误: ${result.error.message}`);
      }
    });

    return lines.join('\n');
  }

  private formatMarkdownWorkflowReport(context: WorkflowContext, results: ExecutionResult[]): string {
    const duration = Date.now() - context.createdAt;
    const successCount = results.filter(r => r.success).length;
    const errorCount = results.filter(r => !r.success).length;

    const lines: string[] = [
      '# 工作流执行报告',
      '',
      '## 基本信息',
      `- **任务描述**: ${context.taskDescription}`,
      `- **执行范围**: ${context.scope}`,
      `- **总执行时间**: ${this.formatDuration(duration)}`,
      '',
      '## 执行统计',
      `- ✅ **成功**: ${successCount}`,
      `- ❌ **失败**: ${errorCount}`,
      `- 📊 **总计**: ${results.length}`,
      '',
      '## 阶段执行情况'
    ];

    this.getPhasesSummary(context).forEach(phaseSummary => {
      lines.push(`- ${phaseSummary}`);
    });

    if (results.length > 0) {
      lines.push('', '## 详细执行结果', '');
      results.forEach((result, index) => {
        const status = result.success ? '✅' : '❌';
        const toolName = this.extractToolName(result.toolCallId);
        lines.push(`${index + 1}. ${status} **${toolName}** (${result.executionTime}ms)`);
        if (result.error) {
          lines.push(`   - 错误: \`${result.error.message}\``);
        }
      });
    }

    return lines.join('\n');
  }

  private formatJsonWorkflowReport(context: WorkflowContext, results: ExecutionResult[]): string {
    const report = {
      workflow: {
        sessionId: context.sessionId,
        taskDescription: context.taskDescription,
        scope: context.scope,
        currentPhase: context.currentPhase,
        isActive: context.isActive,
        duration: Date.now() - context.createdAt,
        createdAt: context.createdAt,
        updatedAt: context.updatedAt
      },
      statistics: {
        total: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        averageExecutionTime: results.length > 0 ? 
          results.reduce((sum, r) => sum + r.executionTime, 0) / results.length : 0
      },
      phases: context.phases,
      results
    };

    return JSON.stringify(report, null, this.config.indentSize);
  }

  private formatHtmlWorkflowReport(context: WorkflowContext, results: ExecutionResult[]): string {
    const duration = Date.now() - context.createdAt;
    const successCount = results.filter(r => r.success).length;
    const errorCount = results.filter(r => !r.success).length;

    return `
<div class="workflow-report">
  <h1>工作流执行报告</h1>
  
  <div class="basic-info">
    <h2>基本信息</h2>
    <p><strong>任务描述</strong>: ${context.taskDescription}</p>
    <p><strong>执行范围</strong>: ${context.scope}</p>
    <p><strong>总执行时间</strong>: ${this.formatDuration(duration)}</p>
  </div>

  <div class="statistics">
    <h2>执行统计</h2>
    <ul>
      <li style="color: green">成功: ${successCount}</li>
      <li style="color: red">失败: ${errorCount}</li>
      <li>总计: ${results.length}</li>
    </ul>
  </div>

  <div class="results">
    <h2>详细执行结果</h2>
    <ol>
      ${results.map(result => {
        const status = result.success ? '✅' : '❌';
        const toolName = this.extractToolName(result.toolCallId);
        return `<li>${status} <strong>${toolName}</strong> (${result.executionTime}ms)${result.error ? `<br>错误: <code>${result.error.message}</code>` : ''}</li>`;
      }).join('')}
    </ol>
  </div>
</div>
    `.trim();
  }

  // 私有格式化方法 - 错误报告

  private formatMinimalErrorReport(errors: Error[]): string {
    return `❌ ${errors.length} 个错误`;
  }

  private formatStandardErrorReport(errors: Error[], context?: any): string {
    const lines: string[] = [];
    
    lines.push(`❌ 错误报告 (${errors.length} 个错误)`);
    lines.push('');

    errors.forEach((error, index) => {
      lines.push(`${index + 1}. ${error.message}`);
      if (error.stack && this.config.showMetadata) {
        lines.push(this.indentText(error.stack, 4));
      }
    });

    return lines.join('\n');
  }

  private formatDetailedErrorReport(errors: Error[], context?: any): string {
    const lines: string[] = [];
    
    lines.push(this.formatStandardErrorReport(errors, context));
    
    if (context) {
      lines.push('');
      lines.push('上下文信息:');
      lines.push(this.indentText(JSON.stringify(context, null, 2), 2));
    }

    return lines.join('\n');
  }

  private formatMarkdownErrorReport(errors: Error[], context?: any): string {
    const lines: string[] = [
      `# 错误报告 (${errors.length} 个错误)`,
      ''
    ];

    errors.forEach((error, index) => {
      lines.push(`## 错误 ${index + 1}`);
      lines.push(`**消息**: ${error.message}`);
      if (error.stack) {
        lines.push('**堆栈跟踪**:');
        lines.push('```');
        lines.push(error.stack);
        lines.push('```');
      }
      lines.push('');
    });

    if (context) {
      lines.push('## 上下文信息');
      lines.push('```json');
      lines.push(JSON.stringify(context, null, 2));
      lines.push('```');
    }

    return lines.join('\n');
  }

  private formatJsonErrorReport(errors: Error[], context?: any): string {
    const report = {
      errorCount: errors.length,
      errors: errors.map(error => ({
        message: error.message,
        name: error.name,
        stack: error.stack
      })),
      context,
      timestamp: Date.now()
    };

    return JSON.stringify(report, null, this.config.indentSize);
  }

  // 私有格式化方法 - 系统状态

  private formatMinimalSystemStatus(status: any): string {
    return `⚙️ 系统状态: ${status.active ? '活跃' : '空闲'}`;
  }

  private formatStandardSystemStatus(status: any): string {
    const lines: string[] = [];
    
    lines.push('⚙️ 系统状态');
    lines.push('');
    
    Object.entries(status).forEach(([key, value]) => {
      lines.push(`  ${key}: ${this.formatValue(value)}`);
    });

    return lines.join('\n');
  }

  private formatDetailedSystemStatus(status: any): string {
    const lines: string[] = [];
    
    lines.push('⚙️ 详细系统状态');
    lines.push('='.repeat(this.config.maxWidth));
    lines.push('');
    
    this.formatObjectRecursively(status, lines, 0);
    
    lines.push('');
    lines.push('='.repeat(this.config.maxWidth));
    
    return lines.join('\n');
  }

  private formatMarkdownSystemStatus(status: any): string {
    const lines: string[] = ['# 系统状态', ''];
    
    Object.entries(status).forEach(([key, value]) => {
      lines.push(`## ${key}`);
      lines.push(`- 值: \`${this.formatValue(value)}\``);
      lines.push('');
    });

    return lines.join('\n');
  }

  // 工具方法

  private extractToolName(toolCallId: string): string {
    const parts = toolCallId.split('-');
    return parts.length > 1 ? parts[1] : toolCallId;
  }

  private getResultIcon(success: boolean): string {
    if (!this.config.enableIcons) return '';
    return success ? this.iconSet.success : this.iconSet.error;
  }

  private getResultColor(success: boolean): string {
    return success ? 'green' : 'red';
  }

  private colorize(text: string, color: string): string {
    if (!this.config.enableColors) return text;
    return this.colorTheme.colorize(text, color);
  }

  private indentText(text: string, spaces: number): string {
    const indent = ' '.repeat(spaces);
    return text.split('\n').map(line => indent + line).join('\n');
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}时${minutes % 60}分${seconds % 60}秒`;
    } else if (minutes > 0) {
      return `${minutes}分${seconds % 60}秒`;
    } else {
      return `${seconds}秒`;
    }
  }

  private formatResultContent(result: any): string {
    if (typeof result === 'string') {
      return result;
    }
    if (typeof result === 'object') {
      return JSON.stringify(result, null, this.config.indentSize);
    }
    return String(result);
  }

  private formatValue(value: any): string {
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  }

  private formatObjectRecursively(obj: any, lines: string[], depth: number): void {
    const indent = ' '.repeat(depth * this.config.indentSize);
    
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'object' && value !== null) {
        lines.push(`${indent}${key}:`);
        this.formatObjectRecursively(value, lines, depth + 1);
      } else {
        lines.push(`${indent}${key}: ${this.formatValue(value)}`);
      }
    }
  }

  private getPhasesSummary(context: WorkflowContext): string[] {
    const phases = [WorkflowPhase.SEARCH, WorkflowPhase.READ, WorkflowPhase.MODIFY, WorkflowPhase.VERIFY];
    const summary: string[] = [];

    phases.forEach(phase => {
      const phaseData = context.phases[phase];
      if (phaseData) {
        const status = phaseData.endTime ? '✅ 完成' : '🔄 进行中';
        const duration = phaseData.endTime ? 
          phaseData.endTime - phaseData.startTime : 
          Date.now() - phaseData.startTime;
        
        summary.push(`${this.getPhaseName(phase)}: ${status} (${this.formatDuration(duration)})`);
      }
    });

    return summary;
  }

  private getPhaseName(phase: WorkflowPhase): string {
    const nameMap: Record<WorkflowPhase, string> = {
      [WorkflowPhase.IDLE]: '空闲',
      [WorkflowPhase.SEARCH]: '🔍 搜索发现',
      [WorkflowPhase.READ]: '📖 读取分析',
      [WorkflowPhase.MODIFY]: '✏️ 修改实现',
      [WorkflowPhase.VERIFY]: '🔍 验证测试',
      [WorkflowPhase.COMPLETED]: '✅ 已完成'
    };
    
    return nameMap[phase] || '未知';
  }
}

/**
 * 颜色主题类
 */
class ColorTheme {
  private colors: Record<string, string> = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    reset: '\x1b[0m'
  };

  colorize(text: string, color: string): string {
    const colorCode = this.colors[color];
    if (!colorCode) return text;
    return `${colorCode}${text}${this.colors.reset}`;
  }
}

/**
 * 图标集合类
 */
class IconSet {
  public success = '✅';
  public error = '❌';
  public warning = '⚠️';
  public info = 'ℹ️';
  public progress = '🔄';
  public search = '🔍';
  public read = '📖';
  public modify = '✏️';
  public verify = '🔍';
  public completed = '✅';
} 