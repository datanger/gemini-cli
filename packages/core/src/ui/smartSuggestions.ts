/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkflowPhase, WorkflowContext } from '../core/workflowStateManager.js';
import { ExecutionResult } from '../core/toolCallCoordinator.js';

/**
 * 建议类型枚举
 */
export enum SuggestionType {
  COMMAND = 'command',
  WORKFLOW = 'workflow',
  TOOL = 'tool',
  OPTIMIZATION = 'optimization',
  ERROR_RECOVERY = 'error_recovery',
  BEST_PRACTICE = 'best_practice'
}

/**
 * 建议优先级枚举
 */
export enum SuggestionPriority {
  LOW = 1,
  MEDIUM = 2,
  HIGH = 3,
  URGENT = 4
}

/**
 * 建议接口
 */
export interface Suggestion {
  id: string;
  type: SuggestionType;
  priority: SuggestionPriority;
  title: string;
  description: string;
  command?: string;
  reason: string;
  context: Record<string, any>;
  timestamp: number;
  applicable: boolean;
}

/**
 * 上下文信息接口
 */
export interface SuggestionContext {
  currentPhase: WorkflowPhase;
  recentErrors: Error[];
  executionHistory: ExecutionResult[];
  userPreferences: Record<string, any>;
  sessionTime: number;
  lastActivity: number;
}

/**
 * 智能提示系统
 */
export class SmartSuggestions {
  private suggestionHistory: Map<string, Suggestion[]> = new Map();
  private contextData: Map<string, SuggestionContext> = new Map();
  private suggestionRules: SuggestionRule[] = [];

  constructor() {
    this.initializeSuggestionRules();
  }

  /**
   * 生成智能建议
   */
  generateSuggestions(sessionId: string, context: WorkflowContext): Suggestion[] {
    const suggestionContext = this.buildSuggestionContext(sessionId, context);
    const suggestions: Suggestion[] = [];

    // 应用所有建议规则
    for (const rule of this.suggestionRules) {
      if (rule.isApplicable(suggestionContext)) {
        const ruleSuggestions = rule.generateSuggestions(suggestionContext);
        suggestions.push(...ruleSuggestions);
      }
    }

    // 排序和去重
    const uniqueSuggestions = this.deduplicateSuggestions(suggestions);
    const sortedSuggestions = this.sortSuggestionsByPriority(uniqueSuggestions);

    // 保存建议历史
    this.suggestionHistory.set(sessionId, sortedSuggestions);

    return sortedSuggestions.slice(0, 5); // 返回前5个建议
  }

  /**
   * 获取快捷命令建议
   */
  getQuickCommands(sessionId: string, currentPhase: WorkflowPhase): string[] {
    const commands: string[] = [];

    switch (currentPhase) {
      case WorkflowPhase.SEARCH:
        commands.push('search', 'grep', 'find');
        break;
      case WorkflowPhase.READ:
        commands.push('read', 'cat', 'view');
        break;
      case WorkflowPhase.MODIFY:
        commands.push('edit', 'modify', 'write');
        break;
      case WorkflowPhase.VERIFY:
        commands.push('test', 'verify', 'check');
        break;
      default:
        commands.push('status', 'help', 'progress');
        break;
    }

    return commands;
  }

  /**
   * 获取错误恢复建议
   */
  getErrorRecoverySuggestions(error: Error, context: SuggestionContext): Suggestion[] {
    const suggestions: Suggestion[] = [];

    if (error.message.includes('timeout')) {
      suggestions.push({
        id: 'timeout-recovery',
        type: SuggestionType.ERROR_RECOVERY,
        priority: SuggestionPriority.HIGH,
        title: '超时错误恢复',
        description: '建议增加超时时间或检查网络连接',
        command: 'retry --timeout=60',
        reason: '检测到超时错误',
        context: { error: error.message },
        timestamp: Date.now(),
        applicable: true
      });
    }

    if (error.message.includes('permission')) {
      suggestions.push({
        id: 'permission-recovery',
        type: SuggestionType.ERROR_RECOVERY,
        priority: SuggestionPriority.URGENT,
        title: '权限错误解决',
        description: '建议检查文件权限或使用管理员权限',
        reason: '检测到权限相关错误',
        context: { error: error.message },
        timestamp: Date.now(),
        applicable: true
      });
    }

    if (error.message.includes('not found')) {
      suggestions.push({
        id: 'notfound-recovery',
        type: SuggestionType.ERROR_RECOVERY,
        priority: SuggestionPriority.MEDIUM,
        title: '资源未找到',
        description: '建议检查文件路径或使用搜索功能',
        command: 'search --pattern="missing-resource"',
        reason: '检测到资源未找到错误',
        context: { error: error.message },
        timestamp: Date.now(),
        applicable: true
      });
    }

    return suggestions;
  }

  /**
   * 获取优化建议
   */
  getOptimizationSuggestions(context: SuggestionContext): Suggestion[] {
    const suggestions: Suggestion[] = [];

    // 执行时间优化
    if (context.sessionTime > 300000) { // 5分钟
      suggestions.push({
        id: 'performance-optimization',
        type: SuggestionType.OPTIMIZATION,
        priority: SuggestionPriority.MEDIUM,
        title: '性能优化建议',
        description: '考虑启用并行模式或跳过非关键阶段',
        command: 'mode parallel',
        reason: '检测到执行时间较长',
        context: { sessionTime: context.sessionTime },
        timestamp: Date.now(),
        applicable: true
      });
    }

    // 错误率优化
    const errorRate = context.recentErrors.length / Math.max(context.executionHistory.length, 1);
    if (errorRate > 0.3) {
      suggestions.push({
        id: 'error-rate-optimization',
        type: SuggestionType.OPTIMIZATION,
        priority: SuggestionPriority.HIGH,
        title: '错误率优化',
        description: '建议检查配置或切换到保守模式',
        command: 'mode conservative',
        reason: `错误率过高 (${Math.round(errorRate * 100)}%)`,
        context: { errorRate },
        timestamp: Date.now(),
        applicable: true
      });
    }

    return suggestions;
  }

  /**
   * 获取最佳实践建议
   */
  getBestPracticeSuggestions(context: SuggestionContext): Suggestion[] {
    const suggestions: Suggestion[] = [];

    // 保存状态建议
    if (context.sessionTime > 600000 && context.currentPhase !== WorkflowPhase.COMPLETED) { // 10分钟
      suggestions.push({
        id: 'save-state-practice',
        type: SuggestionType.BEST_PRACTICE,
        priority: SuggestionPriority.LOW,
        title: '保存状态建议',
        description: '建议保存当前工作流状态以防意外中断',
        command: 'save',
        reason: '长时间运行的工作流',
        context: { sessionTime: context.sessionTime },
        timestamp: Date.now(),
        applicable: true
      });
    }

    // 进度监控建议
    if (context.lastActivity > 120000) { // 2分钟无活动
      suggestions.push({
        id: 'progress-monitoring-practice',
        type: SuggestionType.BEST_PRACTICE,
        priority: SuggestionPriority.LOW,
        title: '进度监控建议',
        description: '建议检查当前进度或启用详细模式',
        command: 'status',
        reason: '长时间无用户交互',
        context: { lastActivity: context.lastActivity },
        timestamp: Date.now(),
        applicable: true
      });
    }

    return suggestions;
  }

  /**
   * 更新上下文信息
   */
  updateContext(sessionId: string, update: Partial<SuggestionContext>): void {
    const currentContext = this.contextData.get(sessionId) || this.createDefaultContext();
    const updatedContext = { ...currentContext, ...update };
    this.contextData.set(sessionId, updatedContext);
  }

  /**
   * 记录用户行为
   */
  recordUserAction(sessionId: string, action: string, success: boolean): void {
    this.updateContext(sessionId, {
      lastActivity: Date.now()
    });

    // 可以在这里分析用户行为模式
  }

  /**
   * 获取建议历史
   */
  getSuggestionHistory(sessionId: string): Suggestion[] {
    return this.suggestionHistory.get(sessionId) || [];
  }

  /**
   * 清理会话数据
   */
  cleanupSession(sessionId: string): void {
    this.suggestionHistory.delete(sessionId);
    this.contextData.delete(sessionId);
  }

  /**
   * 初始化建议规则
   */
  private initializeSuggestionRules(): void {
    this.suggestionRules = [
      new PhaseBasedSuggestionRule(),
      new ErrorBasedSuggestionRule(),
      new PerformanceBasedSuggestionRule(),
      new UserBehaviorBasedSuggestionRule(),
      new BestPracticesSuggestionRule()
    ];
  }

  /**
   * 构建建议上下文
   */
  private buildSuggestionContext(sessionId: string, workflowContext: WorkflowContext): SuggestionContext {
    const storedContext = this.contextData.get(sessionId);
    const now = Date.now();

    return {
      currentPhase: workflowContext.currentPhase,
      recentErrors: storedContext?.recentErrors || [],
      executionHistory: storedContext?.executionHistory || [],
      userPreferences: storedContext?.userPreferences || {},
      sessionTime: now - workflowContext.createdAt,
      lastActivity: storedContext?.lastActivity || now
    };
  }

  /**
   * 创建默认上下文
   */
  private createDefaultContext(): SuggestionContext {
    return {
      currentPhase: WorkflowPhase.IDLE,
      recentErrors: [],
      executionHistory: [],
      userPreferences: {},
      sessionTime: 0,
      lastActivity: Date.now()
    };
  }

  /**
   * 去重建议
   */
  private deduplicateSuggestions(suggestions: Suggestion[]): Suggestion[] {
    const seen = new Set<string>();
    return suggestions.filter(suggestion => {
      if (seen.has(suggestion.id)) {
        return false;
      }
      seen.add(suggestion.id);
      return true;
    });
  }

  /**
   * 按优先级排序建议
   */
  private sortSuggestionsByPriority(suggestions: Suggestion[]): Suggestion[] {
    return suggestions.sort((a, b) => {
      // 优先级排序（高优先级在前）
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      // 时间排序（新的在前）
      return b.timestamp - a.timestamp;
    });
  }
}

/**
 * 建议规则接口
 */
interface SuggestionRule {
  isApplicable(context: SuggestionContext): boolean;
  generateSuggestions(context: SuggestionContext): Suggestion[];
}

/**
 * 基于阶段的建议规则
 */
class PhaseBasedSuggestionRule implements SuggestionRule {
  isApplicable(context: SuggestionContext): boolean {
    return context.currentPhase !== WorkflowPhase.IDLE;
  }

  generateSuggestions(context: SuggestionContext): Suggestion[] {
    const suggestions: Suggestion[] = [];

    switch (context.currentPhase) {
      case WorkflowPhase.SEARCH:
        suggestions.push({
          id: 'search-phase-tip',
          type: SuggestionType.WORKFLOW,
          priority: SuggestionPriority.MEDIUM,
          title: '搜索阶段提示',
          description: '使用更具体的搜索模式以获得更好的结果',
          command: 'search --pattern="specific-term"',
          reason: '当前处于搜索阶段',
          context: { phase: context.currentPhase },
          timestamp: Date.now(),
          applicable: true
        });
        break;

      case WorkflowPhase.READ:
        suggestions.push({
          id: 'read-phase-tip',
          type: SuggestionType.WORKFLOW,
          priority: SuggestionPriority.MEDIUM,
          title: '读取阶段提示',
          description: '关注关键文件和配置，忽略不重要的细节',
          reason: '当前处于读取分析阶段',
          context: { phase: context.currentPhase },
          timestamp: Date.now(),
          applicable: true
        });
        break;

      case WorkflowPhase.MODIFY:
        suggestions.push({
          id: 'modify-phase-tip',
          type: SuggestionType.WORKFLOW,
          priority: SuggestionPriority.HIGH,
          title: '修改阶段提示',
          description: '建议在修改前备份重要文件',
          command: 'backup --target=modified-files',
          reason: '当前处于修改实现阶段',
          context: { phase: context.currentPhase },
          timestamp: Date.now(),
          applicable: true
        });
        break;

      case WorkflowPhase.VERIFY:
        suggestions.push({
          id: 'verify-phase-tip',
          type: SuggestionType.WORKFLOW,
          priority: SuggestionPriority.MEDIUM,
          title: '验证阶段提示',
          description: '运行全面的测试以确保修改的正确性',
          command: 'test --comprehensive',
          reason: '当前处于验证测试阶段',
          context: { phase: context.currentPhase },
          timestamp: Date.now(),
          applicable: true
        });
        break;
    }

    return suggestions;
  }
}

/**
 * 基于错误的建议规则
 */
class ErrorBasedSuggestionRule implements SuggestionRule {
  isApplicable(context: SuggestionContext): boolean {
    return context.recentErrors.length > 0;
  }

  generateSuggestions(context: SuggestionContext): Suggestion[] {
    const suggestions: Suggestion[] = [];
    const smartSuggestions = new SmartSuggestions();

    for (const error of context.recentErrors.slice(-3)) { // 最近3个错误
      const errorSuggestions = smartSuggestions.getErrorRecoverySuggestions(error, context);
      suggestions.push(...errorSuggestions);
    }

    return suggestions;
  }
}

/**
 * 基于性能的建议规则
 */
class PerformanceBasedSuggestionRule implements SuggestionRule {
  isApplicable(context: SuggestionContext): boolean {
    return context.sessionTime > 0;
  }

  generateSuggestions(context: SuggestionContext): Suggestion[] {
    const smartSuggestions = new SmartSuggestions();
    return smartSuggestions.getOptimizationSuggestions(context);
  }
}

/**
 * 基于用户行为的建议规则
 */
class UserBehaviorBasedSuggestionRule implements SuggestionRule {
  isApplicable(context: SuggestionContext): boolean {
    return context.lastActivity > 0;
  }

  generateSuggestions(context: SuggestionContext): Suggestion[] {
    const suggestions: Suggestion[] = [];
    
    // 基于用户活动模式的建议
    const inactiveTime = Date.now() - context.lastActivity;
    
    if (inactiveTime > 300000) { // 5分钟无活动
      suggestions.push({
        id: 'user-inactive-reminder',
        type: SuggestionType.COMMAND,
        priority: SuggestionPriority.LOW,
        title: '活动提醒',
        description: '您已经有一段时间没有交互，是否需要检查进度？',
        command: 'status',
        reason: '长时间无用户交互',
        context: { inactiveTime },
        timestamp: Date.now(),
        applicable: true
      });
    }

    return suggestions;
  }
}

/**
 * 基于最佳实践的建议规则
 */
class BestPracticesSuggestionRule implements SuggestionRule {
  isApplicable(context: SuggestionContext): boolean {
    return true; // 总是适用
  }

  generateSuggestions(context: SuggestionContext): Suggestion[] {
    const smartSuggestions = new SmartSuggestions();
    return smartSuggestions.getBestPracticeSuggestions(context);
  }
} 