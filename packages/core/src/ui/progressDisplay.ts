/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkflowPhase, WorkflowContext } from '../core/workflowStateManager.js';
import { ExecutionResult } from '../core/toolCallCoordinator.js';

/**
 * 进度显示配置接口
 */
export interface ProgressDisplayConfig {
  showPhaseProgress: boolean;
  showToolProgress: boolean;
  showResourceUsage: boolean;
  showExecutionTime: boolean;
  enableEmojis: boolean;
  compactMode: boolean;
}

/**
 * 进度状态接口
 */
export interface ProgressState {
  currentPhase: WorkflowPhase;
  phaseProgress: number; // 0-100
  totalProgress: number; // 0-100
  executedTools: number;
  totalTools: number;
  currentToolName?: string;
  executionTime: number;
  errors: number;
  resourceUsage: Record<string, { used: number; limit: number }>;
}

/**
 * 实时进度显示器
 */
export class ProgressDisplay {
  private config: ProgressDisplayConfig;
  private currentState: ProgressState | null = null;
  private displayUpdateInterval: NodeJS.Timeout | null = null;
  private onUpdateCallback?: (display: string) => void;

  constructor(config: Partial<ProgressDisplayConfig> = {}) {
    this.config = {
      showPhaseProgress: true,
      showToolProgress: true,
      showResourceUsage: false,
      showExecutionTime: true,
      enableEmojis: true,
      compactMode: false,
      ...config
    };
  }

  /**
   * 开始显示进度
   */
  startProgress(sessionId: string, onUpdate?: (display: string) => void): void {
    this.onUpdateCallback = onUpdate;
    
    if (this.displayUpdateInterval) {
      clearInterval(this.displayUpdateInterval);
    }

    // 每500ms更新一次显示
    this.displayUpdateInterval = setInterval(() => {
      if (this.currentState) {
        const display = this.generateProgressDisplay();
        this.onUpdateCallback?.(display);
      }
    }, 500);
  }

  /**
   * 停止显示进度
   */
  stopProgress(): void {
    if (this.displayUpdateInterval) {
      clearInterval(this.displayUpdateInterval);
      this.displayUpdateInterval = null;
    }
    this.currentState = null;
  }

  /**
   * 更新工作流状态
   */
  updateWorkflowState(context: WorkflowContext): void {
    if (!this.currentState) {
      this.currentState = this.initializeProgressState(context);
    }

    this.currentState.currentPhase = context.currentPhase;
    this.currentState.totalProgress = this.calculateTotalProgress(context);
    this.currentState.phaseProgress = this.calculatePhaseProgress(context);
    this.currentState.executionTime = Date.now() - context.createdAt;
    this.currentState.errors = this.countErrors(context);
  }

  /**
   * 更新工具执行状态
   */
  updateToolExecution(result: ExecutionResult): void {
    if (!this.currentState) return;

    if (result.success) {
      this.currentState.executedTools++;
    } else {
      this.currentState.errors++;
    }

    // 从工具ID中提取工具名称
    const toolName = this.extractToolName(result.toolCallId);
    this.currentState.currentToolName = toolName;
  }

  /**
   * 更新资源使用情况
   */
  updateResourceUsage(usage: Record<string, { used: number; limit: number }>): void {
    if (this.currentState) {
      this.currentState.resourceUsage = usage;
    }
  }

  /**
   * 生成进度显示内容
   */
  private generateProgressDisplay(): string {
    if (!this.currentState) return '';

    const lines: string[] = [];

    if (this.config.compactMode) {
      lines.push(this.generateCompactDisplay());
    } else {
      lines.push(this.generateDetailedDisplay());
    }

    return lines.join('\n');
  }

  /**
   * 生成详细显示
   */
  private generateDetailedDisplay(): string {
    if (!this.currentState) return '';

    const lines: string[] = [];
    const { currentPhase, phaseProgress, totalProgress, executedTools, totalTools, currentToolName, executionTime, errors } = this.currentState;

    // 工作流总体进度
    lines.push(this.generateProgressHeader());
    
    // 阶段进度
    if (this.config.showPhaseProgress) {
      lines.push(this.generatePhaseProgress());
    }

    // 工具进度
    if (this.config.showToolProgress) {
      lines.push(this.generateToolProgress());
    }

    // 执行时间
    if (this.config.showExecutionTime) {
      lines.push(this.generateExecutionTime());
    }

    // 资源使用情况
    if (this.config.showResourceUsage) {
      lines.push(this.generateResourceUsage());
    }

    return lines.join('\n');
  }

  /**
   * 生成紧凑显示
   */
  private generateCompactDisplay(): string {
    if (!this.currentState) return '';

    const { currentPhase, totalProgress, executedTools, totalTools, errors } = this.currentState;
    const phaseEmoji = this.getPhaseEmoji(currentPhase);
    const progressBar = this.generateProgressBar(totalProgress, 20);
    
    return `${phaseEmoji} ${this.getPhaseName(currentPhase)} ${progressBar} ${totalProgress}% (${executedTools}/${totalTools}) ${errors > 0 ? `❌${errors}` : ''}`;
  }

  /**
   * 生成进度标题
   */
  private generateProgressHeader(): string {
    if (!this.currentState) return '';

    const { currentPhase, totalProgress } = this.currentState;
    const phaseEmoji = this.config.enableEmojis ? this.getPhaseEmoji(currentPhase) : '';
    const progressBar = this.generateProgressBar(totalProgress, 30);
    
    return `${phaseEmoji} 工作流进度: ${progressBar} ${totalProgress}%`;
  }

  /**
   * 生成阶段进度
   */
  private generatePhaseProgress(): string {
    if (!this.currentState) return '';

    const { currentPhase, phaseProgress } = this.currentState;
    const phaseName = this.getPhaseName(currentPhase);
    const progressBar = this.generateProgressBar(phaseProgress, 20);
    
    return `   当前阶段: ${phaseName} ${progressBar} ${phaseProgress}%`;
  }

  /**
   * 生成工具进度
   */
  private generateToolProgress(): string {
    if (!this.currentState) return '';

    const { executedTools, totalTools, currentToolName } = this.currentState;
    const current = currentToolName ? ` (当前: ${currentToolName})` : '';
    
    return `   工具执行: ${executedTools}/${totalTools}${current}`;
  }

  /**
   * 生成执行时间
   */
  private generateExecutionTime(): string {
    if (!this.currentState) return '';

    const { executionTime, errors } = this.currentState;
    const timeStr = this.formatDuration(executionTime);
    const errorStr = errors > 0 ? ` | ❌ ${errors} 个错误` : '';
    
    return `   执行时间: ${timeStr}${errorStr}`;
  }

  /**
   * 生成资源使用情况
   */
  private generateResourceUsage(): string {
    if (!this.currentState) return '';

    const { resourceUsage } = this.currentState;
    const resourceLines: string[] = [];
    
    for (const [type, info] of Object.entries(resourceUsage)) {
      const percentage = (info.used / info.limit) * 100;
      const bar = this.generateProgressBar(percentage, 10);
      resourceLines.push(`     ${this.getResourceTypeName(type)}: ${bar} ${info.used}/${info.limit}`);
    }

    if (resourceLines.length === 0) return '';
    
    return `   资源使用:\n${resourceLines.join('\n')}`;
  }

  /**
   * 生成进度条
   */
  private generateProgressBar(percentage: number, width: number): string {
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;
    
    if (this.config.enableEmojis) {
      return '■'.repeat(filled) + '□'.repeat(empty);
    } else {
      return '█'.repeat(filled) + '░'.repeat(empty);
    }
  }

  /**
   * 获取阶段表情符号
   */
  private getPhaseEmoji(phase: WorkflowPhase): string {
    if (!this.config.enableEmojis) return '';
    
    const emojiMap: Record<WorkflowPhase, string> = {
      [WorkflowPhase.IDLE]: '⏸️',
      [WorkflowPhase.SEARCH]: '🔍',
      [WorkflowPhase.READ]: '📖',
      [WorkflowPhase.MODIFY]: '✏️',
      [WorkflowPhase.VERIFY]: '🔍',
      [WorkflowPhase.COMPLETED]: '✅'
    };
    
    return emojiMap[phase] || '❓';
  }

  /**
   * 获取阶段名称
   */
  private getPhaseName(phase: WorkflowPhase): string {
    const nameMap: Record<WorkflowPhase, string> = {
      [WorkflowPhase.IDLE]: '空闲',
      [WorkflowPhase.SEARCH]: '搜索发现',
      [WorkflowPhase.READ]: '读取分析',
      [WorkflowPhase.MODIFY]: '修改实现',
      [WorkflowPhase.VERIFY]: '验证测试',
      [WorkflowPhase.COMPLETED]: '已完成'
    };
    
    return nameMap[phase] || '未知';
  }

  /**
   * 获取资源类型名称
   */
  private getResourceTypeName(type: string): string {
    const nameMap: Record<string, string> = {
      'concurrent-file-operations': '文件操作',
      'concurrent-network-requests': '网络请求',
      'concurrent-shell-commands': 'Shell命令',
      'memory-usage-mb': '内存使用'
    };
    
    return nameMap[type] || type;
  }

  /**
   * 初始化进度状态
   */
  private initializeProgressState(context: WorkflowContext): ProgressState {
    return {
      currentPhase: context.currentPhase,
      phaseProgress: 0,
      totalProgress: 0,
      executedTools: 0,
      totalTools: this.estimateTotalTools(context),
      executionTime: 0,
      errors: 0,
      resourceUsage: {}
    };
  }

  /**
   * 计算总体进度
   */
  private calculateTotalProgress(context: WorkflowContext): number {
    const phases = [WorkflowPhase.SEARCH, WorkflowPhase.READ, WorkflowPhase.MODIFY, WorkflowPhase.VERIFY];
    const completedPhases = phases.filter(phase => {
      const phaseData = context.phases[phase];
      return phaseData && phaseData.endTime;
    }).length;
    
    const currentPhaseIndex = phases.indexOf(context.currentPhase);
    const currentPhaseProgress = this.calculatePhaseProgress(context);
    
    if (currentPhaseIndex === -1) {
      return completedPhases * 25; // 每个阶段25%
    }
    
    return (completedPhases * 25) + (currentPhaseProgress * 0.25);
  }

  /**
   * 计算阶段进度
   */
  private calculatePhaseProgress(context: WorkflowContext): number {
    const currentPhaseData = context.phases[context.currentPhase];
    if (!currentPhaseData) return 0;
    
    // 基于工具结果数量估算进度
    const resultsCount = Object.keys(currentPhaseData.results).length;
    const expectedResults = this.getExpectedResultsForPhase(context.currentPhase);
    
    return Math.min(100, (resultsCount / expectedResults) * 100);
  }

  /**
   * 获取阶段预期结果数量
   */
  private getExpectedResultsForPhase(phase: WorkflowPhase): number {
    const expectedMap: Record<WorkflowPhase, number> = {
      [WorkflowPhase.IDLE]: 0,
      [WorkflowPhase.SEARCH]: 3,
      [WorkflowPhase.READ]: 5,
      [WorkflowPhase.MODIFY]: 3,
      [WorkflowPhase.VERIFY]: 2,
      [WorkflowPhase.COMPLETED]: 0
    };
    
    return expectedMap[phase] || 1;
  }

  /**
   * 估算总工具数量
   */
  private estimateTotalTools(context: WorkflowContext): number {
    // 基于任务描述和范围估算
    const baseTools = 8; // 基础工具数量
    
    if (context.scope.includes('complex') || context.scope.includes('comprehensive')) {
      return baseTools * 2;
    }
    if (context.scope.includes('simple') || context.scope.includes('basic')) {
      return Math.max(4, baseTools / 2);
    }
    
    return baseTools;
  }

  /**
   * 统计错误数量
   */
  private countErrors(context: WorkflowContext): number {
    let errors = 0;
    
    for (const phaseData of Object.values(context.phases)) {
      if (phaseData && phaseData.results) {
        for (const result of Object.values(phaseData.results)) {
          if (result && typeof result === 'object' && 'success' in result && !result.success) {
            errors++;
          }
        }
      }
    }
    
    return errors;
  }

  /**
   * 从工具ID中提取工具名称
   */
  private extractToolName(toolCallId: string): string {
    const parts = toolCallId.split('-');
    return parts.length > 1 ? parts[1] : toolCallId;
  }

  /**
   * 格式化持续时间
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    
    if (minutes > 0) {
      return `${minutes}分${seconds % 60}秒`;
    }
    return `${seconds}秒`;
  }

  /**
   * 获取当前进度状态
   */
  getCurrentState(): ProgressState | null {
    return this.currentState;
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<ProgressDisplayConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }
} 