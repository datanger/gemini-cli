/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { FunctionCall } from '@google/genai';
import { Config } from '../config/config.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { WorkflowIntegrationService } from './workflowIntegration.js';
import { ToolCallCoordinator, ExecutionResult, ToolCallStatus } from './toolCallCoordinator.js';
import { WorkflowPhase, WorkflowContext } from './workflowStateManager.js';

/**
 * 编排策略接口
 */
export interface OrchestrationStrategy {
  enableWorkflowMode: boolean;
  enableIntelligentCoordination: boolean;
  maxConcurrentPhases: number;
  phaseTimeout: number;
  adaptiveRetry: boolean;
}

/**
 * 编排结果接口
 */
export interface OrchestrationResult {
  sessionId: string;
  workflowTriggered: boolean;
  phasesExecuted: WorkflowPhase[];
  toolResults: ExecutionResult[];
  totalExecutionTime: number;
  finalReport?: string;
  errors: Error[];
}

/**
 * 工作流编排器
 * 
 * 负责协调第二层（AI决策逻辑）和第三层（工具调用协调）的工作
 */
export class WorkflowOrchestrator {
  private config: Config;
  private toolRegistry: ToolRegistry;
  private workflowService: WorkflowIntegrationService;
  private toolCoordinator: ToolCallCoordinator;
  private strategy: OrchestrationStrategy;
  private activeOrchestrations: Map<string, OrchestrationContext> = new Map();

  constructor(
    config: Config,
    toolRegistry: ToolRegistry,
    strategy?: Partial<OrchestrationStrategy>
  ) {
    console.log('🏗️ [WorkflowOrchestrator] Initializing WorkflowOrchestrator');
    
    this.config = config;
    this.toolRegistry = toolRegistry;
    
    this.strategy = {
      enableWorkflowMode: true,
      enableIntelligentCoordination: true,
      maxConcurrentPhases: 1, // 串行执行阶段
      phaseTimeout: 120000, // 2分钟
      adaptiveRetry: true,
      ...strategy
    };

    console.log('⚙️ [WorkflowOrchestrator] Strategy configuration:', this.strategy);

    this.workflowService = new WorkflowIntegrationService(config);
    this.toolCoordinator = new ToolCallCoordinator(
      config,
      toolRegistry,
      this.workflowService,
      {
        maxConcurrentCalls: 3,
        enableParallel: true,
        priorityBased: true
      }
    );

    this.setupListeners();
    console.log('✅ [WorkflowOrchestrator] WorkflowOrchestrator initialization complete');
  }

  /**
   * 设置监听器
   */
  private setupListeners(): void {
    console.log('🔗 [WorkflowOrchestrator] Setting up listeners');
    // 可以在这里添加各种事件监听器
  }

  /**
   * 编排工具调用执行
   */
  async orchestrateExecution(
    sessionId: string,
    userInput: string,
    functionCalls: FunctionCall[],
    signal?: AbortSignal
  ): Promise<OrchestrationResult> {
    console.log('🎯 [WorkflowOrchestrator] Starting orchestration execution');
    console.log(`📋 [WorkflowOrchestrator] Session: ${sessionId}`);
    console.log(`💬 [WorkflowOrchestrator] User input: "${userInput}"`);
    console.log(`🔧 [WorkflowOrchestrator] Function calls count: ${functionCalls.length}`);
    functionCalls.forEach((call, index) => {
      console.log(`  ${index + 1}. ${call.name} - Args:`, call.args);
    });
    
    const startTime = Date.now();
    const result: OrchestrationResult = {
      sessionId,
      workflowTriggered: false,
      phasesExecuted: [],
      toolResults: [],
      totalExecutionTime: 0,
      errors: []
    };

    try {
      console.log(`⚙️ [WorkflowOrchestrator] Workflow mode enabled: ${this.strategy.enableWorkflowMode}`);
      
      // 检查是否应该启动工作流模式
      if (this.strategy.enableWorkflowMode && this.workflowService.shouldTriggerWorkflow(userInput)) {
        console.log('🔄 [WorkflowOrchestrator] Workflow mode triggered - entering workflow execution');
        result.workflowTriggered = true;
        return await this.executeWorkflowMode(sessionId, userInput, functionCalls, signal, result);
      } else {
        console.log('⚡ [WorkflowOrchestrator] Standard mode - direct tool coordination');
        console.log(`   Reason: enableWorkflowMode=${this.strategy.enableWorkflowMode}, shouldTrigger=${this.workflowService.shouldTriggerWorkflow(userInput)}`);
        // 标准模式：直接协调工具调用
        return await this.executeStandardMode(sessionId, functionCalls, signal, result);
      }
    } catch (error) {
      console.error('❌ [WorkflowOrchestrator] Orchestration execution failed:', error);
      result.errors.push(error instanceof Error ? error : new Error(String(error)));
      return result;
    } finally {
      result.totalExecutionTime = Date.now() - startTime;
      console.log(`⏱️ [WorkflowOrchestrator] Total execution time: ${result.totalExecutionTime}ms`);
      this.activeOrchestrations.delete(sessionId);
    }
  }

  /**
   * 执行工作流模式
   */
  private async executeWorkflowMode(
    sessionId: string,
    userInput: string,
    functionCalls: FunctionCall[],
    signal: AbortSignal | undefined,
    result: OrchestrationResult
  ): Promise<OrchestrationResult> {
    console.log(`🔄 [WorkflowOrchestrator] Starting workflow mode execution for session: ${sessionId}`);

    // 启动工作流
    const workflowContext = this.workflowService.startWorkflow(sessionId, userInput);
    if (!workflowContext) {
      console.error('❌ [WorkflowOrchestrator] Failed to start workflow');
      throw new Error('Failed to start workflow');
    }

    console.log(`📊 [WorkflowOrchestrator] Workflow context created:`, {
      sessionId: workflowContext.sessionId,
      currentPhase: workflowContext.currentPhase,
      isActive: workflowContext.isActive
    });

    // 创建编排上下文
    const orchestrationContext: OrchestrationContext = {
      sessionId,
      workflowContext,
      currentPhase: workflowContext.currentPhase,
      phaseStartTime: Date.now(),
      pendingFunctionCalls: [...functionCalls],
      executedTools: [],
      errors: []
    };

    this.activeOrchestrations.set(sessionId, orchestrationContext);
    console.log(`📝 [WorkflowOrchestrator] Orchestration context created with ${functionCalls.length} pending function calls`);

    // 逐阶段执行工作流
    let phaseCount = 0;
    while (workflowContext.isActive && !signal?.aborted) {
      phaseCount++;
      const currentPhase = workflowContext.currentPhase;
      console.log(`📍 [WorkflowOrchestrator] Executing phase ${phaseCount}: ${currentPhase}`);

      try {
        const phaseResult = await this.executeWorkflowPhase(
          orchestrationContext,
          signal
        );

        console.log(`✅ [WorkflowOrchestrator] Phase ${currentPhase} completed:`, {
          success: phaseResult.success,
          toolCount: phaseResult.toolResults.length,
          executionTime: phaseResult.executionTime
        });

        result.toolResults.push(...phaseResult.toolResults);
        result.phasesExecuted.push(currentPhase);

        // 检查阶段是否完成
        const updatedContext = this.workflowService.getCurrentWorkflowState(sessionId);
        if (!updatedContext || !updatedContext.isActive) {
          console.log(`🏁 [WorkflowOrchestrator] Workflow completed or deactivated`);
          break;
        }

        // 更新编排上下文
        orchestrationContext.workflowContext = updatedContext;
        orchestrationContext.currentPhase = updatedContext.currentPhase;
        orchestrationContext.phaseStartTime = Date.now();

        console.log(`🔄 [WorkflowOrchestrator] Moving to next phase: ${updatedContext.currentPhase}`);

      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        console.error(`❌ [WorkflowOrchestrator] Phase ${currentPhase} failed:`, err.message);
        result.errors.push(err);
        orchestrationContext.errors.push(err);

        // 决定是否继续或中止
        if (this.shouldAbortWorkflow(err, orchestrationContext)) {
          console.log(`🛑 [WorkflowOrchestrator] Aborting workflow due to error`);
          break;
        }
      }

      // 防止无限循环
      if (phaseCount > 10) {
        console.warn(`⚠️ [WorkflowOrchestrator] Too many phases executed (${phaseCount}), breaking loop`);
        break;
      }
    }

    // 生成最终报告
    if (workflowContext.currentPhase === WorkflowPhase.COMPLETED) {
      console.log(`🎉 [WorkflowOrchestrator] Workflow completed successfully`);
      result.finalReport = this.workflowService.generateFinalReport(sessionId);
    }

    return result;
  }

  /**
   * 执行标准模式
   */
  private async executeStandardMode(
    sessionId: string,
    functionCalls: FunctionCall[],
    signal: AbortSignal | undefined,
    result: OrchestrationResult
  ): Promise<OrchestrationResult> {
    console.log(`⚡ [WorkflowOrchestrator] Executing standard mode for session: ${sessionId}`);
    console.log(`🔧 [WorkflowOrchestrator] Processing ${functionCalls.length} function calls`);

    if (this.strategy.enableIntelligentCoordination) {
      console.log(`🧠 [WorkflowOrchestrator] Using intelligent coordination`);
      // 使用智能协调
      const toolResults = await this.toolCoordinator.coordinateExecution(
        sessionId,
        functionCalls,
        signal
      );
      result.toolResults = toolResults;
      console.log(`✅ [WorkflowOrchestrator] Intelligent coordination completed with ${toolResults.length} results`);
    } else {
      console.log(`📋 [WorkflowOrchestrator] Using simple sequential execution`);
      // 简单顺序执行
      for (const functionCall of functionCalls) {
        if (signal?.aborted) {
          console.log(`🛑 [WorkflowOrchestrator] Execution aborted by signal`);
          break;
        }

        console.log(`🔧 [WorkflowOrchestrator] Executing function call: ${functionCall.name}`);

        try {
          const toolResult = await this.toolCoordinator.coordinateExecution(
            sessionId,
            [functionCall],
            signal
          );
          result.toolResults.push(...toolResult);
          console.log(`✅ [WorkflowOrchestrator] Function call ${functionCall.name} completed`);
        } catch (error) {
          console.error(`❌ [WorkflowOrchestrator] Function call ${functionCall.name} failed:`, error);
          result.errors.push(error instanceof Error ? error : new Error(String(error)));
        }
      }
    }

    return result;
  }

  /**
   * 执行工作流阶段
   */
  private async executeWorkflowPhase(
    context: OrchestrationContext,
    signal?: AbortSignal
  ): Promise<PhaseExecutionResult> {
    const phaseStartTime = Date.now();
    const phaseResult: PhaseExecutionResult = {
      phase: context.currentPhase,
      toolResults: [],
      executionTime: 0,
      success: false
    };

    try {
      // 根据阶段筛选合适的工具调用
      const phaseFunctionCalls = this.selectToolsForPhase(
        context.currentPhase,
        context.pendingFunctionCalls
      );

      if (phaseFunctionCalls.length === 0) {
        // 没有匹配的工具，尝试生成阶段所需的工具调用
        const generatedCalls = this.generatePhaseTools(context.currentPhase, context.sessionId);
        phaseFunctionCalls.push(...generatedCalls);
      }

      // 执行阶段工具调用
      if (phaseFunctionCalls.length > 0) {
        const toolResults = await this.toolCoordinator.coordinateExecution(
          context.sessionId,
          phaseFunctionCalls,
          signal
        );

        phaseResult.toolResults = toolResults;
        context.executedTools.push(...toolResults);

        // 移除已执行的工具调用
        context.pendingFunctionCalls = context.pendingFunctionCalls.filter(
          call => !phaseFunctionCalls.some(executed => 
            executed.name === call.name && 
            JSON.stringify(executed.args) === JSON.stringify(call.args)
          )
        );
      }

      phaseResult.success = phaseResult.toolResults.some(r => r.success);
      
    } catch (error) {
      throw error;
    } finally {
      phaseResult.executionTime = Date.now() - phaseStartTime;
    }

    return phaseResult;
  }

  /**
   * 为阶段选择合适的工具调用
   */
  private selectToolsForPhase(
    phase: WorkflowPhase,
    functionCalls: FunctionCall[]
  ): FunctionCall[] {
    const phaseToolMap: Record<WorkflowPhase, string[]> = {
      [WorkflowPhase.IDLE]: [],
      [WorkflowPhase.SEARCH]: ['search', 'grep', 'find', 'glob'],
      [WorkflowPhase.READ]: ['read', 'cat', 'view', 'read_file'],
      [WorkflowPhase.MODIFY]: ['modify', 'edit', 'write', 'write_file'],
      [WorkflowPhase.VERIFY]: ['verify', 'test', 'check', 'run'],
      [WorkflowPhase.COMPLETED]: []
    };

    const phaseTools = phaseToolMap[phase] || [];
    return functionCalls.filter(call => 
      phaseTools.some(tool => 
        (call.name as string).toLowerCase().includes(tool.toLowerCase())
      )
    );
  }

  /**
   * 为阶段生成所需的工具调用
   */
  private generatePhaseTools(phase: WorkflowPhase, sessionId: string): FunctionCall[] {
    const workflowContext = this.workflowService.getCurrentWorkflowState(sessionId);
    if (!workflowContext) return [];

    const generatedCalls: FunctionCall[] = [];

    switch (phase) {
      case WorkflowPhase.SEARCH:
        generatedCalls.push({
          name: 'search',
          args: {
            pattern: this.extractSearchPattern(workflowContext),
            scope: 'code'
          }
        } as FunctionCall);
        break;

      case WorkflowPhase.READ:
        const searchResults = this.getPhaseResults(workflowContext, WorkflowPhase.SEARCH);
        if (searchResults?.foundFiles?.length > 0) {
          generatedCalls.push({
            name: 'read',
            args: {
              path: searchResults.foundFiles[0],
              focus: 'analysis'
            }
          } as FunctionCall);
        }
        break;

      case WorkflowPhase.VERIFY:
        generatedCalls.push({
          name: 'verify',
          args: {
            type: 'test',
            scope: 'modified_files'
          }
        } as FunctionCall);
        break;
    }

    return generatedCalls;
  }

  /**
   * 提取搜索模式
   */
  private extractSearchPattern(context: WorkflowContext): string {
    const description = context.taskDescription.toLowerCase();
    
    if (description.includes('认证') || description.includes('auth')) {
      return 'authentication';
    }
    if (description.includes('用户') || description.includes('user')) {
      return 'user';
    }
    if (description.includes('界面') || description.includes('ui')) {
      return 'interface';
    }
    
    return context.scope || 'general';
  }

  /**
   * 获取阶段结果
   */
  private getPhaseResults(context: WorkflowContext, phase: WorkflowPhase): any {
    const phaseData = context.phases[phase];
    return phaseData?.nextPhaseInputs;
  }

  /**
   * 判断是否应该中止工作流
   */
  private shouldAbortWorkflow(error: Error, context: OrchestrationContext): boolean {
    // 连续失败次数超过阈值
    if (context.errors.length >= 3) {
      return true;
    }

    // 关键错误类型
    if (error.message.includes('permission denied') || 
        error.message.includes('access denied')) {
      return true;
    }

    // 阶段超时
    const phaseTime = Date.now() - context.phaseStartTime;
    if (phaseTime > this.strategy.phaseTimeout) {
      return true;
    }

    return false;
  }

  /**
   * 工具执行完成回调
   */
  private onToolExecutionComplete(result: ExecutionResult): void {
    console.log(`🔧 工具执行完成: ${result.toolCallId}, 成功: ${result.success}`);
    
    // 可以在这里添加额外的逻辑，如更新统计信息、发送通知等
  }

  /**
   * 获取活跃编排信息
   */
  getActiveOrchestrations(): Record<string, OrchestrationSummary> {
    const summaries: Record<string, OrchestrationSummary> = {};
    
    for (const [sessionId, context] of this.activeOrchestrations.entries()) {
      summaries[sessionId] = {
        sessionId,
        currentPhase: context.currentPhase,
        executedTools: context.executedTools.length,
        pendingTools: context.pendingFunctionCalls.length,
        errors: context.errors.length,
        isActive: context.workflowContext.isActive
      };
    }

    return summaries;
  }

  /**
   * 强制中止编排
   */
  abortOrchestration(sessionId: string): boolean {
    const context = this.activeOrchestrations.get(sessionId);
    if (!context) {
      return false;
    }

    this.workflowService.endWorkflow(sessionId);
    this.activeOrchestrations.delete(sessionId);
    return true;
  }

  /**
   * 获取编排统计信息
   */
  getOrchestrationStats(): {
    activeOrchestrations: number;
    toolCoordinatorStats: ReturnType<ToolCallCoordinator['getExecutionStats']>;
    strategy: OrchestrationStrategy;
  } {
    return {
      activeOrchestrations: this.activeOrchestrations.size,
      toolCoordinatorStats: this.toolCoordinator.getExecutionStats(),
      strategy: this.strategy
    };
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.activeOrchestrations.clear();
    this.toolCoordinator.cleanup();
  }
}

/**
 * 编排上下文接口
 */
interface OrchestrationContext {
  sessionId: string;
  workflowContext: WorkflowContext;
  currentPhase: WorkflowPhase;
  phaseStartTime: number;
  pendingFunctionCalls: FunctionCall[];
  executedTools: ExecutionResult[];
  errors: Error[];
}

/**
 * 阶段执行结果接口
 */
interface PhaseExecutionResult {
  phase: WorkflowPhase;
  toolResults: ExecutionResult[];
  executionTime: number;
  success: boolean;
}

/**
 * 编排摘要接口
 */
interface OrchestrationSummary {
  sessionId: string;
  currentPhase: WorkflowPhase;
  executedTools: number;
  pendingTools: number;
  errors: number;
  isActive: boolean;
} 