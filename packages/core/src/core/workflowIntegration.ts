/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkflowStateManager, WorkflowPhase, WorkflowContext } from './workflowStateManager.js';
import { Config } from '../config/config.js';
import { FunctionCall } from '@google/genai';

/**
 * 工作流触发器接口
 */
export interface WorkflowTrigger {
  patterns: RegExp[];
  keywords: string[];
  validate: (userInput: string) => boolean;
}

/**
 * 工作流集成服务
 * 
 * 负责将工作流状态管理器集成到Gemini CLI的核心系统中
 */
export class WorkflowIntegrationService {
  private workflowManager: WorkflowStateManager;
  private workflowTriggers: WorkflowTrigger[];
  private config: Config;

  constructor(config: Config) {
    console.log('🔧 [WorkflowIntegration] Initializing WorkflowIntegrationService');
    this.config = config;
    this.workflowManager = new WorkflowStateManager();
    this.workflowTriggers = this.initializeWorkflowTriggers();
    
    // 添加工作流状态监听器
    this.workflowManager.addListener(this.onWorkflowStateChange.bind(this));
    
    console.log(`📋 [WorkflowIntegration] Initialized with ${this.workflowTriggers.length} triggers`);
    this.workflowTriggers.forEach((trigger, index) => {
      console.log(`  Trigger ${index + 1}: patterns=${trigger.patterns.length}, keywords=${trigger.keywords.length}`);
    });
  }

  /**
   * 初始化工作流触发器
   */
  private initializeWorkflowTriggers(): WorkflowTrigger[] {
    const triggers = [
      {
        patterns: [
          /分析.*改进/,
          /系统.*分析/,
          /彻底.*调查/,
          /端到端.*审查/,
          /全面.*检查/,
          /深入.*研究/
        ],
        keywords: [
          'analyze and improve',
          'complete analysis',
          'thoroughly investigate',
          'end-to-end review',
          'systematic improvement',
          'deep dive into',
          'comprehensive analysis',
          'full analysis'
        ],
        validate: (input: string) => {
          const lowerInput = input.toLowerCase();
          return [
            /分析.*改进/,
            /系统.*分析/,
            /彻底.*调查/,
            /端到端.*审查/,
            /全面.*检查/,
            /深入.*研究/
          ].some((pattern: RegExp) => pattern.test(input)) ||
          [
            'analyze and improve',
            'complete analysis',
            'thoroughly investigate',
            'end-to-end review',
            'systematic improvement',
            'deep dive into',
            'comprehensive analysis',
            'full analysis'
          ].some((keyword: string) => lowerInput.includes(keyword.toLowerCase()));
        }
      }
    ];
    
    console.log('🎯 [WorkflowIntegration] Workflow triggers initialized:');
    triggers.forEach((trigger, index) => {
      console.log(`  Trigger ${index + 1}:`);
      console.log(`    Patterns: ${trigger.patterns.map(p => p.toString()).join(', ')}`);
      console.log(`    Keywords: ${trigger.keywords.join(', ')}`);
    });
    
    return triggers;
  }

  /**
   * 检查用户输入是否应该触发工作流
   */
  shouldTriggerWorkflow(userInput: string): boolean {
    console.log(`🔍 [WorkflowIntegration] Checking if input should trigger workflow: "${userInput}"`);
    
    const shouldTrigger = this.workflowTriggers.some(trigger => {
      const result = trigger.validate(userInput);
      if (result) {
        console.log(`✅ [WorkflowIntegration] Trigger matched for input: "${userInput}"`);
      }
      return result;
    });
    
    console.log(`🎯 [WorkflowIntegration] shouldTriggerWorkflow result: ${shouldTrigger}`);
    return shouldTrigger;
  }

  /**
   * 启动工作流
   */
  startWorkflow(sessionId: string, userInput: string): WorkflowContext | null {
    console.log(`🚀 [WorkflowIntegration] Attempting to start workflow for session: ${sessionId}`);
    console.log(`📝 [WorkflowIntegration] User input: "${userInput}"`);
    
    if (!this.shouldTriggerWorkflow(userInput)) {
      console.log(`❌ [WorkflowIntegration] Workflow not triggered - input doesn't match triggers`);
      return null;
    }

    // 从用户输入中提取任务信息
    const taskInfo = this.extractTaskInfo(userInput);
    console.log(`📊 [WorkflowIntegration] Extracted task info:`, taskInfo);
    
    const context = this.workflowManager.startWorkflow(
      sessionId,
      taskInfo.description,
      taskInfo.objective,
      taskInfo.scope
    );
    
    if (context) {
      console.log(`✅ [WorkflowIntegration] Workflow started successfully for session: ${sessionId}`);
      console.log(`📋 [WorkflowIntegration] Initial workflow context:`, {
        sessionId: context.sessionId,
        currentPhase: context.currentPhase,
        isActive: context.isActive,
        objective: context.objective
      });
    } else {
      console.log(`❌ [WorkflowIntegration] Failed to start workflow for session: ${sessionId}`);
    }
    
    return context;
  }

  /**
   * 从用户输入中提取任务信息
   */
  private extractTaskInfo(userInput: string): {
    description: string;
    objective: string;
    scope: string;
  } {
    // 简单的任务信息提取逻辑
    const description = userInput;
    const objective = this.extractObjective(userInput);
    const scope = this.extractScope(userInput);

    return { description, objective, scope };
  }

  /**
   * 提取目标
   */
  private extractObjective(input: string): string {
    // 查找关键动词来确定目标
    const actionVerbs = ['分析', '改进', '优化', '修复', '重构', 'analyze', 'improve', 'optimize', 'fix', 'refactor'];
    
    for (const verb of actionVerbs) {
      if (input.toLowerCase().includes(verb.toLowerCase())) {
        return `To ${verb} the specified components`;
      }
    }
    
    return 'To analyze and improve the specified system';
  }

  /**
   * 提取范围
   */
  private extractScope(input: string): string {
    // 查找可能的范围指示词
    const scopeIndicators = ['项目', '模块', '组件', '系统', '代码', 'project', 'module', 'component', 'system', 'code'];
    
    for (const indicator of scopeIndicators) {
      if (input.toLowerCase().includes(indicator.toLowerCase())) {
        return indicator;
      }
    }
    
    return 'general';
  }

  /**
   * 处理工具调用结果
   */
  handleToolCallResult(sessionId: string, functionCall: FunctionCall, result: any): boolean {
    console.log(`🛠️ [WorkflowIntegration] Handling tool call result for session: ${sessionId}`);
    console.log(`🔧 [WorkflowIntegration] Tool: ${functionCall.name}, Args:`, functionCall.args);
    
    const context = this.workflowManager.getWorkflowContext(sessionId);
    if (!context || !context.isActive) {
      console.log(`⚠️ [WorkflowIntegration] No active workflow context found for session: ${sessionId}`);
      return false;
    }

    console.log(`📊 [WorkflowIntegration] Current workflow phase: ${context.currentPhase}`);

    // 根据工具名称生成总结
    const summary = this.generateToolResultSummary(functionCall, result);
    console.log(`📝 [WorkflowIntegration] Generated summary: ${summary}`);
    
    const recorded = this.workflowManager.recordToolResult(
      sessionId,
      functionCall.name as string,
      result,
      summary
    );
    
    console.log(`📈 [WorkflowIntegration] Tool result recorded: ${recorded}`);
    return recorded;
  }

  /**
   * 生成工具结果总结
   */
  private generateToolResultSummary(functionCall: FunctionCall, result: any): string {
    const toolName = functionCall.name as string;
    
    if (toolName.includes('search')) {
      return `搜索完成，发现了相关的代码文件和模式`;
    } else if (toolName.includes('read')) {
      return `读取和分析完成，识别了关键内容和潜在问题`;
    } else if (toolName.includes('modify') || toolName.includes('edit')) {
      return `修改实施完成，代码已根据分析结果进行改进`;
    } else if (toolName.includes('verify') || toolName.includes('test')) {
      return `验证完成，确认了更改的正确性和有效性`;
    } else {
      return `工具 ${toolName} 执行完成`;
    }
  }

  /**
   * 获取当前工作流状态
   */
  getCurrentWorkflowState(sessionId: string): WorkflowContext | null {
    return this.workflowManager.getWorkflowContext(sessionId);
  }

  /**
   * 生成工作流状态提示
   */
  generateWorkflowPrompt(sessionId: string): string {
    const context = this.workflowManager.getWorkflowContext(sessionId);
    if (!context || !context.isActive) {
      return '';
    }

    const progressIndicator = this.workflowManager.generateProgressIndicator(sessionId);
    const phaseGuidance = this.generatePhaseGuidance(context);
    const contextSummary = this.generateContextSummary(context);

    return `
## Current Workflow Status
${progressIndicator}

### Phase Guidance
${phaseGuidance}

### Context from Previous Phases
${contextSummary}

### Instructions
Based on the current phase and previous results, proceed with the appropriate tools and actions.
`.trim();
  }

  /**
   * 生成阶段指导
   */
  private generatePhaseGuidance(context: WorkflowContext): string {
    switch (context.currentPhase) {
      case WorkflowPhase.SEARCH:
        return `Focus on discovering relevant files, patterns, and components related to: ${context.objective}`;
      case WorkflowPhase.READ:
        return `Analyze the discovered files and understand the current implementation. Identify issues and improvement opportunities.`;
      case WorkflowPhase.MODIFY:
        return `Implement improvements based on the analysis. Make targeted changes to address identified issues.`;
      case WorkflowPhase.VERIFY:
        return `Test and validate the implemented changes. Ensure everything works correctly and meets the objectives.`;
      default:
        return `Continue with the current workflow phase.`;
    }
  }

  /**
   * 生成上下文总结
   */
  private generateContextSummary(context: WorkflowContext): string {
    const summaries: string[] = [];
    
    for (const [phase, data] of Object.entries(context.phases)) {
      if (data && data.endTime) {
        summaries.push(`**${phase.toUpperCase()}**: ${data.summary}`);
        
        if (data.nextPhaseInputs && Object.keys(data.nextPhaseInputs).length > 0) {
          const inputs = Object.entries(data.nextPhaseInputs)
            .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
            .join(', ');
          summaries.push(`  → Inputs for next phase: ${inputs}`);
        }
      }
    }
    
    return summaries.length > 0 ? summaries.join('\n') : 'No completed phases yet.';
  }

  /**
   * 强制转换到下一阶段
   */
  forceNextPhase(sessionId: string): boolean {
    return this.workflowManager.forceTransitionToNextPhase(sessionId);
  }

  /**
   * 结束工作流
   */
  endWorkflow(sessionId: string): boolean {
    return this.workflowManager.endWorkflow(sessionId);
  }

  /**
   * 生成最终报告
   */
  generateFinalReport(sessionId: string): string {
    const context = this.workflowManager.getWorkflowContext(sessionId);
    if (!context) {
      return '';
    }

    const completedPhase = context.phases[WorkflowPhase.COMPLETED];
    if (!completedPhase || !completedPhase.results) {
      return '';
    }

    const report = completedPhase.results;
    
    return `
## 🎉 Workflow Execution Report

### 📋 Task Overview
- **Description**: ${report.taskDescription}
- **Objective**: ${report.objective}
- **Scope**: ${report.scope}
- **Duration**: ${this.formatDuration(report.duration)}

### 📊 Phase Results

#### 🔍 Discovery Phase
${this.formatPhaseResult(context.phases[WorkflowPhase.SEARCH])}

#### 📖 Analysis Phase
${this.formatPhaseResult(context.phases[WorkflowPhase.READ])}

#### ✏️ Implementation Phase
${this.formatPhaseResult(context.phases[WorkflowPhase.MODIFY])}

#### ✅ Verification Phase
${this.formatPhaseResult(context.phases[WorkflowPhase.VERIFY])}

### 🎯 Summary & Recommendations
${report.summary}

---
*Workflow completed at ${new Date().toLocaleString()}*
`.trim();
  }

  /**
   * 格式化阶段结果
   */
  private formatPhaseResult(phaseData: any): string {
    if (!phaseData) {
      return 'Phase not completed';
    }

    const duration = phaseData.endTime ? 
      this.formatDuration(phaseData.endTime - phaseData.startTime) : 
      'In progress';

    return `
- **Tools used**: ${phaseData.tools.join(', ') || 'None'}
- **Duration**: ${duration}
- **Summary**: ${phaseData.summary || 'No summary available'}
`.trim();
  }

  /**
   * 格式化持续时间
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * 工作流状态变化监听器
   */
  private onWorkflowStateChange(context: WorkflowContext): void {
    console.log(`🔄 [WorkflowIntegration] Workflow state changed for session: ${context.sessionId}`);
    console.log(`📊 [WorkflowIntegration] Phase: ${context.currentPhase}, Active: ${context.isActive}`);
    console.log(`⏰ [WorkflowIntegration] Updated at: ${new Date(context.updatedAt).toISOString()}`);
    
    // 可以在这里添加更多的状态变化处理逻辑
    if (context.currentPhase === WorkflowPhase.COMPLETED) {
      console.log(`🎉 [WorkflowIntegration] Workflow completed for session: ${context.sessionId}`);
    }
  }

  /**
   * 检查是否有活跃的工作流
   */
  hasActiveWorkflow(sessionId: string): boolean {
    const context = this.workflowManager.getWorkflowContext(sessionId);
    return context?.isActive || false;
  }

  /**
   * 获取工作流管理器实例（用于测试）
   */
  getWorkflowManager(): WorkflowStateManager {
    return this.workflowManager;
  }
} 