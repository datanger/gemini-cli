/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { FunctionCall } from '@google/genai';
import { WorkflowIntegrationService } from './workflowIntegration.js';
import { Config } from '../config/config.js';
import { ToolRegistry } from '../tools/tool-registry.js';

/**
 * 工具调用状态枚举
 */
export enum ToolCallStatus {
  PENDING = 'pending',
  QUEUED = 'queued',
  EXECUTING = 'executing',
  SUCCESS = 'success',
  FAILED = 'failed',
  RETRYING = 'retrying',
  CANCELLED = 'cancelled',
  TIMEOUT = 'timeout'
}

/**
 * 工具调用信息接口
 */
export interface ToolCallInfo {
  id: string;
  sessionId: string;
  toolName: string;
  args: Record<string, any>;
  status: ToolCallStatus;
  priority: number;
  dependencies: string[];
  retryCount: number;
  maxRetries: number;
  timeoutMs: number;
  startTime?: number;
  endTime?: number;
  result?: any;
  error?: Error;
  metadata: Record<string, any>;
}

/**
 * 执行结果接口
 */
export interface ExecutionResult {
  success: boolean;
  toolCallId: string;
  result?: any;
  error?: Error;
  executionTime: number;
  retryCount: number;
}

/**
 * 执行策略接口
 */
export interface ExecutionStrategy {
  maxConcurrentCalls: number;
  defaultTimeout: number;
  retryDelay: number;
  enableParallel: boolean;
  priorityBased: boolean;
}

/**
 * 依赖关系解析器
 */
export class DependencyResolver {
  /**
   * 解析工具调用的依赖关系
   */
  resolveDependencies(toolCalls: ToolCallInfo[]): {
    executable: ToolCallInfo[];
    blocked: ToolCallInfo[];
    circular: ToolCallInfo[];
  } {
    const completed = new Set<string>();
    const executable: ToolCallInfo[] = [];
    const blocked: ToolCallInfo[] = [];
    const circular: ToolCallInfo[] = [];

    // 检测循环依赖
    const circularDeps = this.detectCircularDependencies(toolCalls);
    circular.push(...circularDeps);

    // 分离可执行和被阻塞的工具调用
    for (const toolCall of toolCalls) {
      if (circular.includes(toolCall)) {
        continue;
      }

      if (this.canExecute(toolCall, completed)) {
        executable.push(toolCall);
      } else {
        blocked.push(toolCall);
      }
    }

    return { executable, blocked, circular };
  }

  /**
   * 检查工具调用是否可以执行
   */
  private canExecute(toolCall: ToolCallInfo, completed: Set<string>): boolean {
    return toolCall.dependencies.every(dep => completed.has(dep));
  }

  /**
   * 检测循环依赖
   */
  private detectCircularDependencies(toolCalls: ToolCallInfo[]): ToolCallInfo[] {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const circular: ToolCallInfo[] = [];
    const dependencyMap = new Map<string, string[]>();

    // 构建依赖映射
    for (const toolCall of toolCalls) {
      dependencyMap.set(toolCall.id, toolCall.dependencies);
    }

    // DFS检测循环
    const dfs = (id: string): boolean => {
      if (recursionStack.has(id)) {
        return true; // 发现循环
      }
      if (visited.has(id)) {
        return false;
      }

      visited.add(id);
      recursionStack.add(id);

      const deps = dependencyMap.get(id) || [];
      for (const dep of deps) {
        if (dfs(dep)) {
          return true;
        }
      }

      recursionStack.delete(id);
      return false;
    };

    for (const toolCall of toolCalls) {
      if (!visited.has(toolCall.id) && dfs(toolCall.id)) {
        circular.push(toolCall);
      }
    }

    return circular;
  }

  /**
   * 根据优先级排序
   */
  sortByPriority(toolCalls: ToolCallInfo[]): ToolCallInfo[] {
    return [...toolCalls].sort((a, b) => b.priority - a.priority);
  }

  /**
   * 更新依赖关系（当工具调用完成时）
   */
  updateDependencies(completedId: string, remainingCalls: ToolCallInfo[]): ToolCallInfo[] {
    return remainingCalls.filter(call => !call.dependencies.includes(completedId));
  }
}

/**
 * 执行队列管理器
 */
export class ExecutionQueue {
  private queue: ToolCallInfo[] = [];
  private executing: Set<string> = new Set();
  private completed: Set<string> = new Set();
  private maxConcurrent: number;

  constructor(maxConcurrent: number = 3) {
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * 添加工具调用到队列
   */
  enqueue(toolCall: ToolCallInfo): void {
    toolCall.status = ToolCallStatus.QUEUED;
    this.queue.push(toolCall);
  }

  /**
   * 批量添加工具调用
   */
  enqueueBatch(toolCalls: ToolCallInfo[]): void {
    toolCalls.forEach(call => this.enqueue(call));
  }

  /**
   * 获取下一个可执行的工具调用
   */
  dequeue(): ToolCallInfo | null {
    if (this.executing.size >= this.maxConcurrent) {
      return null;
    }

    const resolver = new DependencyResolver();
    const { executable } = resolver.resolveDependencies(
      this.queue.filter(call => call.status === ToolCallStatus.QUEUED)
    );

    if (executable.length === 0) {
      return null;
    }

    // 选择最高优先级的可执行工具调用
    const sorted = resolver.sortByPriority(executable);
    const selected = sorted[0];

    if (selected) {
      selected.status = ToolCallStatus.EXECUTING;
      this.executing.add(selected.id);
      this.queue = this.queue.filter(call => call.id !== selected.id);
    }

    return selected;
  }

  /**
   * 标记工具调用完成
   */
  markCompleted(toolCallId: string, success: boolean): void {
    this.executing.delete(toolCallId);
    if (success) {
      this.completed.add(toolCallId);
    }
  }

  /**
   * 获取队列状态
   */
  getStatus(): {
    queued: number;
    executing: number;
    completed: number;
    canExecuteMore: boolean;
  } {
    return {
      queued: this.queue.length,
      executing: this.executing.size,
      completed: this.completed.size,
      canExecuteMore: this.executing.size < this.maxConcurrent
    };
  }

  /**
   * 清空队列
   */
  clear(): void {
    this.queue = [];
    this.executing.clear();
    this.completed.clear();
  }
}

/**
 * 错误处理器
 */
export class ErrorHandler {
  private retryStrategies: Map<string, (error: Error, attempt: number) => boolean> = new Map();

  constructor() {
    this.initializeDefaultStrategies();
  }

  /**
   * 初始化默认重试策略
   */
  private initializeDefaultStrategies(): void {
    // 网络错误重试策略
    this.retryStrategies.set('network', (error, attempt) => {
      return attempt < 3 && (
        error.message.includes('timeout') ||
        error.message.includes('ECONNRESET') ||
        error.message.includes('ETIMEDOUT')
      );
    });

    // 工具不可用重试策略
    this.retryStrategies.set('tool-unavailable', (error, attempt) => {
      return attempt < 2 && error.message.includes('not available');
    });

    // 参数错误不重试
    this.retryStrategies.set('parameter', () => false);

    // 默认重试策略
    this.retryStrategies.set('default', (error, attempt) => {
      return attempt < 2;
    });
  }

  /**
   * 判断是否应该重试
   */
  shouldRetry(toolCall: ToolCallInfo, error: Error): boolean {
    if (toolCall.retryCount >= toolCall.maxRetries) {
      return false;
    }

    // 根据错误类型选择重试策略
    const strategy = this.getRetryStrategy(error);
    return strategy(error, toolCall.retryCount);
  }

  /**
   * 获取重试策略
   */
  private getRetryStrategy(error: Error): (error: Error, attempt: number) => boolean {
    if (error.message.includes('timeout') || error.message.includes('network')) {
      return this.retryStrategies.get('network')!;
    }
    if (error.message.includes('not available') || error.message.includes('not found')) {
      return this.retryStrategies.get('tool-unavailable')!;
    }
    if (error.message.includes('parameter') || error.message.includes('argument')) {
      return this.retryStrategies.get('parameter')!;
    }
    return this.retryStrategies.get('default')!;
  }

  /**
   * 计算重试延迟（指数退避）
   */
  calculateRetryDelay(attempt: number, baseDelay: number = 1000): number {
    return Math.min(baseDelay * Math.pow(2, attempt), 10000); // 最大10秒
  }

  /**
   * 生成降级工具调用
   */
  generateFallbackCall(failedCall: ToolCallInfo): ToolCallInfo | null {
    // 根据失败的工具生成替代方案
    const fallbackMap: Record<string, string> = {
      'search': 'grep', // 搜索失败时使用grep
      'read': 'cat',    // 读取失败时使用基础读取
      'modify': 'edit', // 修改失败时使用基础编辑
      'verify': 'test'  // 验证失败时使用基础测试
    };

    const fallbackTool = fallbackMap[failedCall.toolName];
    if (!fallbackTool) {
      return null;
    }

    return {
      ...failedCall,
      id: `${failedCall.id}-fallback`,
      toolName: fallbackTool,
      priority: failedCall.priority - 1,
      maxRetries: 1,
      retryCount: 0,
      status: ToolCallStatus.PENDING,
      metadata: {
        ...failedCall.metadata,
        isFallback: true,
        originalTool: failedCall.toolName
      }
    };
  }
}

/**
 * 资源管理器
 */
export class ResourceManager {
  private activeConnections: Set<string> = new Set();
  private resourceLimits: Map<string, number> = new Map();
  private resourceUsage: Map<string, number> = new Map();

  constructor() {
    this.initializeResourceLimits();
  }

  /**
   * 初始化资源限制
   */
  private initializeResourceLimits(): void {
    this.resourceLimits.set('concurrent-file-operations', 5);
    this.resourceLimits.set('concurrent-network-requests', 3);
    this.resourceLimits.set('concurrent-shell-commands', 2);
    this.resourceLimits.set('memory-usage-mb', 500);
  }

  /**
   * 检查资源可用性
   */
  checkResourceAvailability(toolCall: ToolCallInfo): boolean {
    const resourceType = this.getResourceType(toolCall.toolName);
    const currentUsage = this.resourceUsage.get(resourceType) || 0;
    const limit = this.resourceLimits.get(resourceType) || 10;

    return currentUsage < limit;
  }

  /**
   * 分配资源
   */
  allocateResource(toolCall: ToolCallInfo): boolean {
    if (!this.checkResourceAvailability(toolCall)) {
      return false;
    }

    const resourceType = this.getResourceType(toolCall.toolName);
    const currentUsage = this.resourceUsage.get(resourceType) || 0;
    this.resourceUsage.set(resourceType, currentUsage + 1);
    this.activeConnections.add(toolCall.id);

    return true;
  }

  /**
   * 释放资源
   */
  releaseResource(toolCall: ToolCallInfo): void {
    const resourceType = this.getResourceType(toolCall.toolName);
    const currentUsage = this.resourceUsage.get(resourceType) || 0;
    this.resourceUsage.set(resourceType, Math.max(0, currentUsage - 1));
    this.activeConnections.delete(toolCall.id);
  }

  /**
   * 获取资源类型
   */
  private getResourceType(toolName: string): string {
    if (['read', 'write', 'edit', 'modify'].includes(toolName)) {
      return 'concurrent-file-operations';
    }
    if (['search', 'fetch', 'web'].includes(toolName)) {
      return 'concurrent-network-requests';
    }
    if (['shell', 'command', 'run'].includes(toolName)) {
      return 'concurrent-shell-commands';
    }
    return 'general';
  }

  /**
   * 获取资源使用情况
   */
  getResourceUsage(): Record<string, { used: number; limit: number }> {
    const usage: Record<string, { used: number; limit: number }> = {};
    
    for (const [type, limit] of this.resourceLimits.entries()) {
      usage[type] = {
        used: this.resourceUsage.get(type) || 0,
        limit
      };
    }

    return usage;
  }
}

/**
 * 工具调用协调器主类
 */
export class ToolCallCoordinator {
  private executionQueue: ExecutionQueue;
  private errorHandler: ErrorHandler;
  private resourceManager: ResourceManager;
  private workflowService: WorkflowIntegrationService;
  private config: Config;
  private toolRegistry: ToolRegistry;
  private strategy: ExecutionStrategy;
  private listeners: ((result: ExecutionResult) => void)[] = [];

  constructor(
    config: Config,
    toolRegistry: ToolRegistry,
    workflowService: WorkflowIntegrationService,
    strategy?: Partial<ExecutionStrategy>
  ) {
    this.config = config;
    this.toolRegistry = toolRegistry;
    this.workflowService = workflowService;
    
    this.strategy = {
      maxConcurrentCalls: 3,
      defaultTimeout: 30000,
      retryDelay: 1000,
      enableParallel: true,
      priorityBased: true,
      ...strategy
    };

    this.executionQueue = new ExecutionQueue(this.strategy.maxConcurrentCalls);
    this.errorHandler = new ErrorHandler();
    this.resourceManager = new ResourceManager();
  }

  /**
   * 协调执行工具调用
   */
  async coordinateExecution(
    sessionId: string,
    functionCalls: FunctionCall[],
    signal?: AbortSignal
  ): Promise<ExecutionResult[]> {
    const toolCalls = this.createToolCallInfos(sessionId, functionCalls);
    const results: ExecutionResult[] = [];

    // 将工具调用加入队列
    this.executionQueue.enqueueBatch(toolCalls);

    // 执行工具调用
    while (this.hasRemainingWork()) {
      if (signal?.aborted) {
        break;
      }

      const executableCalls = this.getExecutableCalls();
      const promises = executableCalls.map(call => this.executeToolCall(call, signal));
      
      if (promises.length > 0) {
        const batchResults = await Promise.allSettled(promises);
        
        for (let i = 0; i < batchResults.length; i++) {
          const result = batchResults[i];
          const toolCall = executableCalls[i];
          
          if (result.status === 'fulfilled') {
            results.push(result.value);
            this.executionQueue.markCompleted(toolCall.id, result.value.success);
          } else {
            const failureResult: ExecutionResult = {
              success: false,
              toolCallId: toolCall.id,
              error: result.reason,
              executionTime: 0,
              retryCount: toolCall.retryCount
            };
            results.push(failureResult);
            this.executionQueue.markCompleted(toolCall.id, false);
          }
        }
      } else {
        // 没有可执行的工具调用，等待一下再检查
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return results;
  }

  /**
   * 创建工具调用信息
   */
  private createToolCallInfos(sessionId: string, functionCalls: FunctionCall[]): ToolCallInfo[] {
    return functionCalls.map((call, index) => ({
      id: `${sessionId}-${call.name}-${Date.now()}-${index}`,
      sessionId,
      toolName: call.name as string,
      args: call.args as Record<string, any>,
      status: ToolCallStatus.PENDING,
      priority: this.calculatePriority(call.name as string, sessionId),
      dependencies: this.extractDependencies(call),
      retryCount: 0,
      maxRetries: 2,
      timeoutMs: this.strategy.defaultTimeout,
      metadata: {
        originalIndex: index,
        phase: this.getCurrentPhase(sessionId)
      }
    }));
  }

  /**
   * 计算工具调用优先级
   */
  private calculatePriority(toolName: string, sessionId: string): number {
    const workflowContext = this.workflowService.getCurrentWorkflowState(sessionId);
    if (!workflowContext) {
      return 5; // 默认优先级
    }

    // 根据当前阶段调整优先级
    const phasePriorities: Record<string, Record<string, number>> = {
      'search': { 'search': 10, 'grep': 8, 'find': 7 },
      'read': { 'read': 10, 'cat': 8, 'view': 7 },
      'modify': { 'modify': 10, 'edit': 9, 'write': 8 },
      'verify': { 'verify': 10, 'test': 9, 'check': 8 }
    };

    const currentPhase = workflowContext.currentPhase;
    const toolPriorities = phasePriorities[currentPhase] || {};
    
    return toolPriorities[toolName] || 5;
  }

  /**
   * 提取工具调用依赖
   */
  private extractDependencies(call: FunctionCall): string[] {
    // 基于工具类型的简单依赖推断
    const dependencies: string[] = [];
    
    if (call.name === 'modify' || call.name === 'edit') {
      // 修改类工具依赖于读取类工具
      dependencies.push('read');
    }
    if (call.name === 'verify' || call.name === 'test') {
      // 验证类工具依赖于修改类工具
      dependencies.push('modify');
    }

    return dependencies;
  }

  /**
   * 获取当前阶段
   */
  private getCurrentPhase(sessionId: string): string {
    const context = this.workflowService.getCurrentWorkflowState(sessionId);
    return context?.currentPhase || 'unknown';
  }

  /**
   * 检查是否还有剩余工作
   */
  private hasRemainingWork(): boolean {
    const status = this.executionQueue.getStatus();
    return status.queued > 0 || status.executing > 0;
  }

  /**
   * 获取可执行的工具调用
   */
  private getExecutableCalls(): ToolCallInfo[] {
    const executableCalls: ToolCallInfo[] = [];
    
    while (this.executionQueue.getStatus().canExecuteMore) {
      const toolCall = this.executionQueue.dequeue();
      if (!toolCall) {
        break;
      }
      
      if (this.resourceManager.checkResourceAvailability(toolCall)) {
        executableCalls.push(toolCall);
      } else {
        // 资源不足，重新入队
        this.executionQueue.enqueue(toolCall);
        break;
      }
    }

    return executableCalls;
  }

  /**
   * 执行单个工具调用
   */
  private async executeToolCall(
    toolCall: ToolCallInfo,
    signal?: AbortSignal
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    toolCall.startTime = startTime;

    try {
      // 分配资源
      if (!this.resourceManager.allocateResource(toolCall)) {
        throw new Error('Resource allocation failed');
      }

      // 执行工具调用
      const result = await this.performToolExecution(toolCall, signal);
      
      const endTime = Date.now();
      toolCall.endTime = endTime;
      toolCall.status = ToolCallStatus.SUCCESS;
      toolCall.result = result;

      // 通知工作流服务
      this.workflowService.handleToolCallResult(
        toolCall.sessionId,
        { name: toolCall.toolName, args: toolCall.args } as FunctionCall,
        result
      );

      const executionResult: ExecutionResult = {
        success: true,
        toolCallId: toolCall.id,
        result,
        executionTime: endTime - startTime,
        retryCount: toolCall.retryCount
      };

      this.notifyListeners(executionResult);
      return executionResult;

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      toolCall.error = err;
      toolCall.status = ToolCallStatus.FAILED;

      // 检查是否应该重试
      if (this.errorHandler.shouldRetry(toolCall, err)) {
        return await this.retryToolCall(toolCall, signal);
      }

      // 尝试降级执行
      const fallbackCall = this.errorHandler.generateFallbackCall(toolCall);
      if (fallbackCall) {
        return await this.executeToolCall(fallbackCall, signal);
      }

      const executionResult: ExecutionResult = {
        success: false,
        toolCallId: toolCall.id,
        error: err,
        executionTime: Date.now() - startTime,
        retryCount: toolCall.retryCount
      };

      this.notifyListeners(executionResult);
      return executionResult;

    } finally {
      this.resourceManager.releaseResource(toolCall);
    }
  }

  /**
   * 执行具体的工具调用
   */
  private async performToolExecution(
    toolCall: ToolCallInfo,
    signal?: AbortSignal
  ): Promise<any> {
    // 这里应该调用实际的工具执行逻辑
    // 为了演示，我们返回模拟结果
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Tool call ${toolCall.toolName} timed out`));
      }, toolCall.timeoutMs);

      // 模拟工具执行
      setTimeout(() => {
        clearTimeout(timeoutId);
        if (signal?.aborted) {
          reject(new Error('Tool call was aborted'));
        } else {
          resolve({
            tool: toolCall.toolName,
            args: toolCall.args,
            result: `Mock result for ${toolCall.toolName}`,
            timestamp: Date.now()
          });
        }
      }, Math.random() * 1000 + 500); // 0.5-1.5秒的模拟执行时间
    });
  }

  /**
   * 重试工具调用
   */
  private async retryToolCall(
    toolCall: ToolCallInfo,
    signal?: AbortSignal
  ): Promise<ExecutionResult> {
    toolCall.retryCount++;
    toolCall.status = ToolCallStatus.RETRYING;

    const delay = this.errorHandler.calculateRetryDelay(
      toolCall.retryCount,
      this.strategy.retryDelay
    );

    await new Promise(resolve => setTimeout(resolve, delay));

    return await this.executeToolCall(toolCall, signal);
  }

  /**
   * 添加执行结果监听器
   */
  addListener(listener: (result: ExecutionResult) => void): void {
    this.listeners.push(listener);
  }

  /**
   * 通知监听器
   */
  private notifyListeners(result: ExecutionResult): void {
    this.listeners.forEach(listener => listener(result));
  }

  /**
   * 获取执行统计
   */
  getExecutionStats(): {
    queueStatus: ReturnType<ExecutionQueue['getStatus']>;
    resourceUsage: ReturnType<ResourceManager['getResourceUsage']>;
    strategy: ExecutionStrategy;
  } {
    return {
      queueStatus: this.executionQueue.getStatus(),
      resourceUsage: this.resourceManager.getResourceUsage(),
      strategy: this.strategy
    };
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.executionQueue.clear();
    this.listeners = [];
  }
} 