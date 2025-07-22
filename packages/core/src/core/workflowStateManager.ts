/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 工作流阶段枚举
 */
export enum WorkflowPhase {
  IDLE = 'idle',
  SEARCH = 'search',
  READ = 'read', 
  MODIFY = 'modify',
  VERIFY = 'verify',
  COMPLETED = 'completed'
}

/**
 * 工作流阶段数据接口
 */
export interface PhaseData {
  phase: WorkflowPhase;
  startTime: number;
  endTime?: number;
  tools: string[];
  results: Record<string, any>;
  summary: string;
  nextPhaseInputs?: Record<string, any>;
}

/**
 * 工作流上下文接口
 */
export interface WorkflowContext {
  sessionId: string;
  taskDescription: string;
  objective: string;
  scope: string;
  currentPhase: WorkflowPhase;
  phases: Record<WorkflowPhase, PhaseData | null>;
  createdAt: number;
  updatedAt: number;
  isActive: boolean;
}

/**
 * 阶段转换条件接口
 */
export interface PhaseTransitionCondition {
  requiredTools: string[];
  minimumResults: number;
  maxDuration?: number; // 最大持续时间（毫秒）
  customValidator?: (phaseData: PhaseData) => boolean;
}

/**
 * 工作流状态管理器
 * 
 * 负责管理四步工作流的状态、阶段转换和上下文传递
 */
export class WorkflowStateManager {
  private contexts = new Map<string, WorkflowContext>();
  private phaseTransitionConditions: Record<WorkflowPhase, PhaseTransitionCondition>;
  private listeners: ((context: WorkflowContext) => void)[] = [];

  constructor() {
    console.log('🏗️ [WorkflowStateManager] Initializing WorkflowStateManager');
    
    this.phaseTransitionConditions = {
      [WorkflowPhase.IDLE]: {
        requiredTools: [],
        minimumResults: 0
      },
      [WorkflowPhase.SEARCH]: {
        requiredTools: ['search'],
        minimumResults: 1,
        maxDuration: 60000, // 1分钟
        customValidator: (data) => {
          return data.results && Object.keys(data.results).length > 0;
        }
      },
      [WorkflowPhase.READ]: {
        requiredTools: ['read'],
        minimumResults: 1,
        maxDuration: 120000, // 2分钟
        customValidator: (data) => {
          return data.results && data.summary.length > 0;
        }
      },
      [WorkflowPhase.MODIFY]: {
        requiredTools: ['modify', 'edit'],
        minimumResults: 1,
        maxDuration: 180000, // 3分钟
        customValidator: (data) => {
          return data.results && data.summary.includes('修改') || data.summary.includes('改进');
        }
      },
      [WorkflowPhase.VERIFY]: {
        requiredTools: ['verify', 'test'],
        minimumResults: 1,
        maxDuration: 120000, // 2分钟
        customValidator: (data) => {
          return data.results && (data.summary.includes('验证') || data.summary.includes('测试'));
        }
      },
      [WorkflowPhase.COMPLETED]: {
        requiredTools: [],
        minimumResults: 0
      }
    };
    
    console.log('⚙️ [WorkflowStateManager] Phase transition conditions initialized');
  }

  /**
   * 开始新的工作流
   */
  startWorkflow(sessionId: string, taskDescription: string, objective: string, scope: string): WorkflowContext {
    console.log(`🚀 [WorkflowStateManager] Starting new workflow for session: ${sessionId}`);
    console.log(`📝 [WorkflowStateManager] Task: "${taskDescription}"`);
    console.log(`🎯 [WorkflowStateManager] Objective: "${objective}"`);
    console.log(`📍 [WorkflowStateManager] Scope: "${scope}"`);
    
    const context: WorkflowContext = {
      sessionId,
      taskDescription,
      objective,
      scope,
      currentPhase: WorkflowPhase.SEARCH,
      phases: {
        [WorkflowPhase.IDLE]: null,
        [WorkflowPhase.SEARCH]: {
          phase: WorkflowPhase.SEARCH,
          startTime: Date.now(),
          tools: [],
          results: {},
          summary: ''
        },
        [WorkflowPhase.READ]: null,
        [WorkflowPhase.MODIFY]: null,
        [WorkflowPhase.VERIFY]: null,
        [WorkflowPhase.COMPLETED]: null
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isActive: true
    };

    this.contexts.set(sessionId, context);
    console.log(`✅ [WorkflowStateManager] Workflow context created and stored for session: ${sessionId}`);
    this.notifyListeners(context);
    return context;
  }

  /**
   * 获取工作流上下文
   */
  getWorkflowContext(sessionId: string): WorkflowContext | null {
    const context = this.contexts.get(sessionId);
    if (context) {
      console.log(`📊 [WorkflowStateManager] Retrieved workflow context for session: ${sessionId}, phase: ${context.currentPhase}, active: ${context.isActive}`);
    } else {
      console.log(`⚠️ [WorkflowStateManager] No workflow context found for session: ${sessionId}`);
    }
    return context || null;
  }

  /**
   * 记录工具调用结果
   */
  recordToolResult(sessionId: string, toolName: string, result: any, summary: string): boolean {
    console.log(`🛠️ [WorkflowStateManager] Recording tool result for session: ${sessionId}`);
    console.log(`🔧 [WorkflowStateManager] Tool: ${toolName}, Summary: "${summary}"`);
    
    const context = this.contexts.get(sessionId);
    if (!context || !context.isActive) {
      console.log(`❌ [WorkflowStateManager] Cannot record tool result - no active context for session: ${sessionId}`);
      return false;
    }

    const currentPhaseData = context.phases[context.currentPhase];
    if (!currentPhaseData) {
      console.log(`❌ [WorkflowStateManager] Cannot record tool result - no current phase data for phase: ${context.currentPhase}`);
      return false;
    }

    console.log(`📊 [WorkflowStateManager] Current phase: ${context.currentPhase}, tools count before: ${currentPhaseData.tools.length}`);

    // 更新当前阶段数据
    currentPhaseData.tools.push(toolName);
    currentPhaseData.results[toolName] = result;
    currentPhaseData.summary = summary;
    context.updatedAt = Date.now();

    console.log(`📈 [WorkflowStateManager] Tool result recorded, tools count after: ${currentPhaseData.tools.length}`);

    // 检查是否满足阶段转换条件
    if (this.shouldTransitionToNextPhase(context)) {
      console.log(`🔄 [WorkflowStateManager] Phase transition conditions met, transitioning to next phase`);
      this.transitionToNextPhase(context);
    } else {
      console.log(`⏳ [WorkflowStateManager] Phase transition conditions not yet met, staying in current phase`);
    }

    this.contexts.set(sessionId, context);
    this.notifyListeners(context);
    return true;
  }

  /**
   * 判断是否应该转换到下一阶段
   */
  private shouldTransitionToNextPhase(context: WorkflowContext): boolean {
    console.log(`🔍 [WorkflowStateManager] Checking phase transition conditions for phase: ${context.currentPhase}`);
    
    const currentPhaseData = context.phases[context.currentPhase];
    if (!currentPhaseData) {
      console.log(`❌ [WorkflowStateManager] No phase data found for current phase`);
      return false;
    }

    const condition = this.phaseTransitionConditions[context.currentPhase];
    
    // 检查必需工具
    const hasRequiredTools = condition.requiredTools.length === 0 || 
      condition.requiredTools.some(tool => currentPhaseData.tools.includes(tool));
    console.log(`🔧 [WorkflowStateManager] Required tools check: ${hasRequiredTools} (required: [${condition.requiredTools.join(', ')}], current: [${currentPhaseData.tools.join(', ')}])`);
    
    // 检查最小结果数量
    const hasMinimumResults = Object.keys(currentPhaseData.results).length >= condition.minimumResults;
    console.log(`📊 [WorkflowStateManager] Minimum results check: ${hasMinimumResults} (required: ${condition.minimumResults}, current: ${Object.keys(currentPhaseData.results).length})`);
    
    // 检查自定义验证器
    const passesCustomValidation = !condition.customValidator || 
      condition.customValidator(currentPhaseData);
    console.log(`✅ [WorkflowStateManager] Custom validation check: ${passesCustomValidation}`);

    // 检查超时
    const isNotTimedOut = !condition.maxDuration || 
      (Date.now() - currentPhaseData.startTime) <= condition.maxDuration;
    const elapsed = Date.now() - currentPhaseData.startTime;
    console.log(`⏰ [WorkflowStateManager] Timeout check: ${isNotTimedOut} (elapsed: ${elapsed}ms, max: ${condition.maxDuration || 'none'}ms)`);

    const shouldTransition = hasRequiredTools && hasMinimumResults && passesCustomValidation && isNotTimedOut;
    console.log(`🎯 [WorkflowStateManager] Should transition: ${shouldTransition}`);
    
    return shouldTransition;
  }

  /**
   * 转换到下一阶段
   */
  private transitionToNextPhase(context: WorkflowContext): void {
    console.log(`🔄 [WorkflowStateManager] Transitioning from phase: ${context.currentPhase}`);
    
    const currentPhaseData = context.phases[context.currentPhase];
    if (currentPhaseData) {
      currentPhaseData.endTime = Date.now();
      currentPhaseData.nextPhaseInputs = this.extractNextPhaseInputs(context);
      console.log(`📋 [WorkflowStateManager] Current phase marked as completed, duration: ${currentPhaseData.endTime - currentPhaseData.startTime}ms`);
    }

    // 确定下一阶段
    const nextPhase = this.getNextPhase(context.currentPhase);
    if (nextPhase) {
      console.log(`➡️ [WorkflowStateManager] Next phase: ${nextPhase}`);
      context.currentPhase = nextPhase;
      
      if (nextPhase !== WorkflowPhase.COMPLETED) {
        context.phases[nextPhase] = {
          phase: nextPhase,
          startTime: Date.now(),
          tools: [],
          results: {},
          summary: ''
        };
        console.log(`🆕 [WorkflowStateManager] New phase ${nextPhase} initialized`);
      } else {
        context.isActive = false;
        context.phases[nextPhase] = {
          phase: nextPhase,
          startTime: Date.now(),
          endTime: Date.now(),
          tools: [],
          results: this.generateFinalReport(context),
          summary: 'Workflow completed successfully'
        };
        console.log(`🎉 [WorkflowStateManager] Workflow completed and marked as inactive`);
      }
    } else {
      console.log(`⚠️ [WorkflowStateManager] No next phase found, workflow may be stuck`);
    }

    context.updatedAt = Date.now();
  }

  /**
   * 获取下一阶段
   */
  private getNextPhase(currentPhase: WorkflowPhase): WorkflowPhase | null {
    const phaseOrder = [
      WorkflowPhase.SEARCH,
      WorkflowPhase.READ,
      WorkflowPhase.MODIFY,
      WorkflowPhase.VERIFY,
      WorkflowPhase.COMPLETED
    ];

    const currentIndex = phaseOrder.indexOf(currentPhase);
    if (currentIndex >= 0 && currentIndex < phaseOrder.length - 1) {
      return phaseOrder[currentIndex + 1];
    }
    return null;
  }

  /**
   * 提取下一阶段的输入
   */
  private extractNextPhaseInputs(context: WorkflowContext): Record<string, any> {
    console.log(`🔍 [WorkflowStateManager] Extracting inputs for next phase from current phase: ${context.currentPhase}`);
    
    const inputs: Record<string, any> = {};
    
    switch (context.currentPhase) {
      case WorkflowPhase.SEARCH:
        inputs.foundFiles = this.extractFoundFiles(context);
        inputs.searchPatterns = this.extractSearchPatterns(context);
        break;
      case WorkflowPhase.READ:
        inputs.analyzedContent = this.extractAnalyzedContent(context);
        inputs.issues = this.extractIssues(context);
        inputs.recommendations = this.extractRecommendations(context);
        break;
      case WorkflowPhase.MODIFY:
        inputs.changes = this.extractChanges(context);
        inputs.modifiedFiles = this.extractModifiedFiles(context);
        break;
      case WorkflowPhase.VERIFY:
        inputs.testResults = this.extractTestResults(context);
        inputs.verificationStatus = this.extractVerificationStatus(context);
        break;
    }

    console.log(`📋 [WorkflowStateManager] Extracted inputs:`, Object.keys(inputs));
    return inputs;
  }

  /**
   * 生成工作流进度提示
   */
  generateProgressIndicator(sessionId: string): string {
    const context = this.contexts.get(sessionId);
    if (!context) {
      return '';
    }

    const phaseEmojis: Record<WorkflowPhase, string> = {
      [WorkflowPhase.IDLE]: '💤',
      [WorkflowPhase.SEARCH]: '🔍',
      [WorkflowPhase.READ]: '📖',
      [WorkflowPhase.MODIFY]: '✏️',
      [WorkflowPhase.VERIFY]: '✅',
      [WorkflowPhase.COMPLETED]: '🎉'
    };

    const phases = [WorkflowPhase.SEARCH, WorkflowPhase.READ, WorkflowPhase.MODIFY, WorkflowPhase.VERIFY];
    const currentIndex = phases.indexOf(context.currentPhase);
    const progress = phases.map((phase, index) => 
      index <= currentIndex ? '■' : '□'
    ).join('');

    const emoji = phaseEmojis[context.currentPhase] || '📋';
    const phaseName = this.getPhaseName(context.currentPhase);

    return `Workflow Progress: [${progress}] (${currentIndex + 1}/4) - Current Phase: ${emoji} ${phaseName}`;
  }

  /**
   * 获取阶段名称
   */
  private getPhaseName(phase: WorkflowPhase): string {
    const names = {
      [WorkflowPhase.IDLE]: 'Idle',
      [WorkflowPhase.SEARCH]: 'Searching and discovering',
      [WorkflowPhase.READ]: 'Reading and analyzing',
      [WorkflowPhase.MODIFY]: 'Modifying and improving',
      [WorkflowPhase.VERIFY]: 'Verifying and testing',
      [WorkflowPhase.COMPLETED]: 'Completed'
    };
    return names[phase] || 'Unknown';
  }

  /**
   * 生成最终报告
   */
  private generateFinalReport(context: WorkflowContext): Record<string, any> {
    console.log(`📄 [WorkflowStateManager] Generating final report for session: ${context.sessionId}`);
    
    const report = {
      taskDescription: context.taskDescription,
      objective: context.objective,
      scope: context.scope,
      duration: Date.now() - context.createdAt,
      phases: context.phases,
      summary: 'Four-phase workflow completed successfully'
    };
    
    console.log(`📊 [WorkflowStateManager] Final report generated, duration: ${report.duration}ms`);
    return report;
  }

  /**
   * 添加状态变化监听器
   */
  addListener(listener: (context: WorkflowContext) => void): void {
    console.log(`🔗 [WorkflowStateManager] Adding workflow state listener`);
    this.listeners.push(listener);
  }

  /**
   * 通知监听器
   */
  private notifyListeners(context: WorkflowContext): void {
    console.log(`📢 [WorkflowStateManager] Notifying ${this.listeners.length} listeners of state change`);
    this.listeners.forEach(listener => listener(context));
  }

  /**
   * 强制转换到下一阶段
   */
  forceTransitionToNextPhase(sessionId: string): boolean {
    console.log(`🔧 [WorkflowStateManager] Force transitioning to next phase for session: ${sessionId}`);
    
    const context = this.contexts.get(sessionId);
    if (!context || !context.isActive) {
      console.log(`❌ [WorkflowStateManager] Cannot force transition - no active context`);
      return false;
    }

    this.transitionToNextPhase(context);
    this.contexts.set(sessionId, context);
    this.notifyListeners(context);
    console.log(`✅ [WorkflowStateManager] Force transition completed`);
    return true;
  }

  /**
   * 结束工作流
   */
  endWorkflow(sessionId: string): boolean {
    console.log(`🛑 [WorkflowStateManager] Ending workflow for session: ${sessionId}`);
    
    const context = this.contexts.get(sessionId);
    if (!context) {
      console.log(`❌ [WorkflowStateManager] Cannot end workflow - no context found`);
      return false;
    }

    context.isActive = false;
    context.currentPhase = WorkflowPhase.COMPLETED;
    context.updatedAt = Date.now();

    this.contexts.set(sessionId, context);
    this.notifyListeners(context);
    console.log(`✅ [WorkflowStateManager] Workflow ended successfully`);
    return true;
  }

  // 辅助方法用于提取各种信息
  private extractFoundFiles(context: WorkflowContext): string[] {
    const searchPhase = context.phases[WorkflowPhase.SEARCH];
    if (!searchPhase?.results.search) return [];
    
    // 从搜索结果中提取文件列表
    const searchResult = searchPhase.results.search;
    if (typeof searchResult === 'string') {
      // 尝试从字符串中提取文件路径
      const fileRegex = /[\w\/\\.-]+\.(ts|js|tsx|jsx|py|java|cpp|c|h|css|html|md|json|yaml|yml)/g;
      return searchResult.match(fileRegex) || [];
    }
    return [];
  }

  private extractSearchPatterns(context: WorkflowContext): string[] {
    // 从搜索阶段提取使用的搜索模式
    return [];
  }

  private extractAnalyzedContent(context: WorkflowContext): any {
    const readPhase = context.phases[WorkflowPhase.READ];
    return readPhase?.results || {};
  }

  private extractIssues(context: WorkflowContext): string[] {
    const readPhase = context.phases[WorkflowPhase.READ];
    const summary = readPhase?.summary || '';
    // 从总结中提取问题
    const issueKeywords = ['问题', 'issue', 'bug', 'error', '错误', '缺陷'];
    if (issueKeywords.some(keyword => summary.toLowerCase().includes(keyword))) {
      return [summary];
    }
    return [];
  }

  private extractRecommendations(context: WorkflowContext): string[] {
    const readPhase = context.phases[WorkflowPhase.READ];
    const summary = readPhase?.summary || '';
    // 从总结中提取建议
    const recommendationKeywords = ['建议', 'recommend', 'suggest', '改进', 'improve'];
    if (recommendationKeywords.some(keyword => summary.toLowerCase().includes(keyword))) {
      return [summary];
    }
    return [];
  }

  private extractChanges(context: WorkflowContext): any[] {
    const modifyPhase = context.phases[WorkflowPhase.MODIFY];
    return Object.values(modifyPhase?.results || {});
  }

  private extractModifiedFiles(context: WorkflowContext): string[] {
    const modifyPhase = context.phases[WorkflowPhase.MODIFY];
    return Object.keys(modifyPhase?.results || {});
  }

  private extractTestResults(context: WorkflowContext): any {
    const verifyPhase = context.phases[WorkflowPhase.VERIFY];
    return verifyPhase?.results || {};
  }

  private extractVerificationStatus(context: WorkflowContext): string {
    const verifyPhase = context.phases[WorkflowPhase.VERIFY];
    return verifyPhase?.summary || 'Unknown';
  }
} 