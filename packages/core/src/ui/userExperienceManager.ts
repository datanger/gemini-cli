/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkflowOrchestrator } from '../core/workflowOrchestrator.js';
import { ProgressDisplay } from './progressDisplay.js';
import { InteractiveController } from './interactiveController.js';
import { SmartSuggestions } from './smartSuggestions.js';
import { ResultFormatter, FormatStyle } from './resultFormatter.js';
import { WorkflowContext, WorkflowPhase } from '../core/workflowStateManager.js';
import { ExecutionResult } from '../core/toolCallCoordinator.js';
import { Config } from '../config/config.js';
import { ToolRegistry } from '../tools/tool-registry.js';

/**
 * 用户体验配置接口
 */
export interface UXConfig {
  enableProgress: boolean;
  enableInteractiveControl: boolean;
  enableSuggestions: boolean;
  autoFormatResults: boolean;
  progressUpdateInterval: number;
  defaultFormatStyle: FormatStyle;
}

/**
 * 执行统计接口
 */
export interface ExecutionStats {
  totalSessions: number;
  completedSessions: number;
  averageExecutionTime: number;
  successRate: number;
  mostUsedTools: string[];
}

/**
 * 简化的用户体验管理器
 * 
 * 整合各个UI组件，提供统一的用户体验接口，重点关注工作流执行
 */
export class UserExperienceManager {
  private orchestrator: WorkflowOrchestrator;
  private progressDisplay: ProgressDisplay;
  private interactiveController: InteractiveController;
  private smartSuggestions: SmartSuggestions;
  private resultFormatter: ResultFormatter;
  private config: UXConfig;
  private activeSessions: Map<string, SessionContext> = new Map();
  private executionStats: ExecutionStats;

  constructor(
    config: Config,
    toolRegistry: ToolRegistry,
    uxConfig: Partial<UXConfig> = {}
  ) {
    // 初始化配置
    this.config = {
      enableProgress: true,
      enableInteractiveControl: true,
      enableSuggestions: true,
      autoFormatResults: true,
      progressUpdateInterval: 1000,
      defaultFormatStyle: FormatStyle.STANDARD,
      ...uxConfig
    };

    // 初始化核心组件
    this.orchestrator = new WorkflowOrchestrator(config, toolRegistry);
    this.progressDisplay = new ProgressDisplay({
      compactMode: false,
      enableEmojis: true,
      showExecutionTime: true
    });
    this.interactiveController = new InteractiveController(this.orchestrator, this.progressDisplay);
    this.smartSuggestions = new SmartSuggestions();
    this.resultFormatter = new ResultFormatter({
      enableColors: true,
      enableIcons: true,
      language: 'zh'
    });

    // 初始化统计信息
    this.executionStats = {
      totalSessions: 0,
      completedSessions: 0,
      averageExecutionTime: 0,
      successRate: 0,
      mostUsedTools: []
    };
  }

  /**
   * 启动工作流执行
   */
  async startWorkflowExecution(
    sessionId: string,
    userInput: string,
    functionCalls: any[],
    onProgress?: (update: string) => void,
    onComplete?: (result: any) => void
  ): Promise<void> {
    console.log(`🚀 启动工作流执行: ${sessionId}`);
    
    try {
      // 创建会话上下文
      const sessionContext: SessionContext = {
        sessionId,
        userInput,
        startTime: Date.now(),
        onProgress,
        onComplete,
        isActive: true
      };
      
      this.activeSessions.set(sessionId, sessionContext);
      this.executionStats.totalSessions++;

      // 启动进度显示
      if (this.config.enableProgress && onProgress) {
        this.progressDisplay.startProgress(sessionId, onProgress);
      }

      // 执行工作流
      const result = await this.orchestrator.orchestrateExecution(
        sessionId,
        userInput,
        functionCalls
      );

      // 处理执行结果
      await this.handleExecutionResult(sessionId, result);

    } catch (error) {
      console.error(`❌ 工作流执行失败: ${sessionId}`, error);
      await this.handleExecutionError(sessionId, error as Error);
    } finally {
      // 清理会话
      this.cleanupSession(sessionId);
    }
  }

  /**
   * 处理用户交互命令
   */
  handleUserCommand(sessionId: string, command: string): string {
    if (!this.config.enableInteractiveControl) {
      return '交互控制已禁用';
    }

    const result = this.interactiveController.handleCommand(sessionId, command);
    return result.message;
  }

  /**
   * 获取智能建议
   */
  getSuggestions(sessionId: string, workflowContext: WorkflowContext): string[] {
    if (!this.config.enableSuggestions) {
      return [];
    }

    const suggestions = this.smartSuggestions.generateSuggestions(sessionId, workflowContext);
    return suggestions.map(s => `💡 ${s.title}: ${s.description}`);
  }

  /**
   * 格式化执行结果
   */
  formatResult(result: any, style?: FormatStyle): string {
    if (!this.config.autoFormatResults) {
      return JSON.stringify(result, null, 2);
    }

    const formatStyle = style || this.config.defaultFormatStyle;
    
    if (result.toolResults) {
      // 工作流结果
      return this.resultFormatter.formatWorkflowReport(
        result.workflowContext,
        result.toolResults,
        formatStyle
      ).content;
    } else if (result.toolCallId) {
      // 单个工具结果
      return this.resultFormatter.formatToolExecutionResult(result, formatStyle).content;
    } else {
      // 系统状态
      return this.resultFormatter.formatSystemStatus(result, formatStyle).content;
    }
  }

  /**
   * 获取当前执行状态
   */
  getExecutionStatus(sessionId: string): ExecutionStatusInfo {
    const sessionContext = this.activeSessions.get(sessionId);
    const progressState = this.progressDisplay.getCurrentState();
    const controlState = this.interactiveController.getControlState(sessionId);

    return {
      isActive: sessionContext?.isActive || false,
      sessionId,
      progress: progressState ? {
        currentPhase: progressState.currentPhase,
        totalProgress: progressState.totalProgress,
        executedTools: progressState.executedTools,
        totalTools: progressState.totalTools,
        executionTime: progressState.executionTime,
        errors: progressState.errors
      } : null,
      control: controlState ? {
        isPaused: controlState.isPaused,
        canSkip: controlState.canSkip,
        canAbort: controlState.canAbort,
        availableCommands: controlState.availableCommands
      } : null,
      runtime: sessionContext ? Date.now() - sessionContext.startTime : 0
    };
  }

  /**
   * 获取系统统计信息
   */
  getSystemStats(): ExecutionStats & { activeSessions: number } {
    return {
      ...this.executionStats,
      activeSessions: this.activeSessions.size
    };
  }

  /**
   * 生成执行摘要
   */
  generateExecutionSummary(sessionId: string): string {
    const status = this.getExecutionStatus(sessionId);
    const stats = this.getSystemStats();
    
    const lines = [
      `📊 执行摘要 - 会话 ${sessionId}`,
      ``,
      `⏱️  运行时间: ${this.formatDuration(status.runtime)}`,
      `📈 总体进度: ${status.progress?.totalProgress || 0}%`,
      `🔧 已执行工具: ${status.progress?.executedTools || 0}/${status.progress?.totalTools || 0}`,
      `❌ 错误数量: ${status.progress?.errors || 0}`,
      ``,
      `🏁 当前阶段: ${this.getPhaseName(status.progress?.currentPhase)}`,
      `⚙️  系统状态: ${status.isActive ? '🟢 活跃' : '🔴 空闲'}`,
      ``,
      `📋 系统统计:`,
      `   总会话数: ${stats.totalSessions}`,
      `   完成会话: ${stats.completedSessions}`,
      `   成功率: ${Math.round(stats.successRate * 100)}%`,
      `   活跃会话: ${stats.activeSessions}`
    ];

    return lines.join('\n');
  }

  /**
   * 停止所有活跃的工作流
   */
  stopAllWorkflows(): number {
    const count = this.activeSessions.size;
    
    for (const sessionId of this.activeSessions.keys()) {
      this.orchestrator.abortOrchestration(sessionId);
      this.cleanupSession(sessionId);
    }

    return count;
  }

  /**
   * 清理系统资源
   */
  cleanup(): void {
    this.stopAllWorkflows();
    this.progressDisplay.stopProgress();
    this.orchestrator.cleanup();
  }

  /**
   * 处理执行结果
   */
  private async handleExecutionResult(sessionId: string, result: any): Promise<void> {
    const sessionContext = this.activeSessions.get(sessionId);
    if (!sessionContext) return;

    // 更新统计信息
    this.executionStats.completedSessions++;
    const executionTime = Date.now() - sessionContext.startTime;
    this.updateAverageExecutionTime(executionTime);
    
    // 计算成功率
    const success = result.errors.length === 0;
    this.updateSuccessRate(success);

    // 格式化结果
    const formattedResult = this.formatResult(result);

    // 停止进度显示
    if (this.config.enableProgress) {
      this.progressDisplay.stopProgress();
    }

    // 调用完成回调
    if (sessionContext.onComplete) {
      sessionContext.onComplete({
        sessionId,
        success,
        result: formattedResult,
        executionTime,
        stats: this.getSystemStats()
      });
    }

    console.log(`✅ 工作流执行完成: ${sessionId} (${this.formatDuration(executionTime)})`);
  }

  /**
   * 处理执行错误
   */
  private async handleExecutionError(sessionId: string, error: Error): Promise<void> {
    const sessionContext = this.activeSessions.get(sessionId);
    if (!sessionContext) return;

    // 格式化错误报告
    const errorReport = this.resultFormatter.formatErrorReport([error], {
      sessionId,
      userInput: sessionContext.userInput,
      timestamp: Date.now()
    }).content;

    // 停止进度显示
    if (this.config.enableProgress) {
      this.progressDisplay.stopProgress();
    }

    // 调用完成回调（错误情况）
    if (sessionContext.onComplete) {
      sessionContext.onComplete({
        sessionId,
        success: false,
        error: errorReport,
        executionTime: Date.now() - sessionContext.startTime,
        stats: this.getSystemStats()
      });
    }
  }

  /**
   * 清理会话
   */
  private cleanupSession(sessionId: string): void {
    this.activeSessions.delete(sessionId);
    this.interactiveController.cleanupSession(sessionId);
    this.smartSuggestions.cleanupSession(sessionId);
  }

  /**
   * 更新平均执行时间
   */
  private updateAverageExecutionTime(newTime: number): void {
    const { completedSessions, averageExecutionTime } = this.executionStats;
    this.executionStats.averageExecutionTime = 
      ((averageExecutionTime * (completedSessions - 1)) + newTime) / completedSessions;
  }

  /**
   * 更新成功率
   */
  private updateSuccessRate(success: boolean): void {
    const { completedSessions, successRate } = this.executionStats;
    const successCount = Math.round(successRate * (completedSessions - 1));
    const newSuccessCount = successCount + (success ? 1 : 0);
    this.executionStats.successRate = newSuccessCount / completedSessions;
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
   * 获取阶段名称
   */
  private getPhaseName(phase?: WorkflowPhase): string {
    if (!phase) return '未知';
    
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
 * 会话上下文接口
 */
interface SessionContext {
  sessionId: string;
  userInput: string;
  startTime: number;
  onProgress?: (update: string) => void;
  onComplete?: (result: any) => void;
  isActive: boolean;
}

/**
 * 执行状态信息接口
 */
export interface ExecutionStatusInfo {
  isActive: boolean;
  sessionId: string;
  progress: {
    currentPhase: WorkflowPhase;
    totalProgress: number;
    executedTools: number;
    totalTools: number;
    executionTime: number;
    errors: number;
  } | null;
  control: {
    isPaused: boolean;
    canSkip: boolean;
    canAbort: boolean;
    availableCommands: string[];
  } | null;
  runtime: number;
} 