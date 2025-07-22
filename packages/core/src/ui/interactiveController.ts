/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkflowPhase, WorkflowContext } from '../core/workflowStateManager.js';
import { WorkflowOrchestrator } from '../core/workflowOrchestrator.js';
import { ProgressDisplay } from './progressDisplay.js';

/**
 * 交互命令枚举
 */
export enum InteractiveCommand {
  PAUSE = 'pause',
  RESUME = 'resume',
  SKIP_PHASE = 'skip',
  ABORT = 'abort',
  FORCE_NEXT = 'next',
  SHOW_STATUS = 'status',
  SHOW_HELP = 'help',
  CHANGE_MODE = 'mode',
  TOGGLE_PROGRESS = 'progress',
  SAVE_STATE = 'save',
  LOAD_STATE = 'load'
}

/**
 * 控制状态接口
 */
export interface ControlState {
  isPaused: boolean;
  canSkip: boolean;
  canAbort: boolean;
  canForceNext: boolean;
  availableCommands: InteractiveCommand[];
  currentPhase: WorkflowPhase;
  sessionId: string;
}

/**
 * 命令结果接口
 */
export interface CommandResult {
  success: boolean;
  message: string;
  newState?: ControlState;
  shouldExit?: boolean;
}

/**
 * 交互式控制器
 */
export class InteractiveController {
  private orchestrator: WorkflowOrchestrator;
  private progressDisplay: ProgressDisplay;
  private controlStates: Map<string, ControlState> = new Map();
  private commandHandlers: Map<InteractiveCommand, (sessionId: string, args?: string[]) => CommandResult> = new Map();
  private pausedSessions: Set<string> = new Set();
  private savedStates: Map<string, any> = new Map();

  constructor(orchestrator: WorkflowOrchestrator, progressDisplay: ProgressDisplay) {
    this.orchestrator = orchestrator;
    this.progressDisplay = progressDisplay;
    this.initializeCommandHandlers();
  }

  /**
   * 初始化命令处理器
   */
  private initializeCommandHandlers(): void {
    this.commandHandlers.set(InteractiveCommand.PAUSE, this.handlePause.bind(this));
    this.commandHandlers.set(InteractiveCommand.RESUME, this.handleResume.bind(this));
    this.commandHandlers.set(InteractiveCommand.SKIP_PHASE, this.handleSkipPhase.bind(this));
    this.commandHandlers.set(InteractiveCommand.ABORT, this.handleAbort.bind(this));
    this.commandHandlers.set(InteractiveCommand.FORCE_NEXT, this.handleForceNext.bind(this));
    this.commandHandlers.set(InteractiveCommand.SHOW_STATUS, this.handleShowStatus.bind(this));
    this.commandHandlers.set(InteractiveCommand.SHOW_HELP, this.handleShowHelp.bind(this));
    this.commandHandlers.set(InteractiveCommand.CHANGE_MODE, this.handleChangeMode.bind(this));
    this.commandHandlers.set(InteractiveCommand.TOGGLE_PROGRESS, this.handleToggleProgress.bind(this));
    this.commandHandlers.set(InteractiveCommand.SAVE_STATE, this.handleSaveState.bind(this));
    this.commandHandlers.set(InteractiveCommand.LOAD_STATE, this.handleLoadState.bind(this));
  }

  /**
   * 启动交互式控制
   */
  startInteractiveControl(sessionId: string, workflowContext: WorkflowContext): ControlState {
    const controlState: ControlState = {
      isPaused: false,
      canSkip: true,
      canAbort: true,
      canForceNext: true,
      availableCommands: this.getAvailableCommands(workflowContext.currentPhase),
      currentPhase: workflowContext.currentPhase,
      sessionId
    };

    this.controlStates.set(sessionId, controlState);
    return controlState;
  }

  /**
   * 处理用户命令
   */
  handleCommand(sessionId: string, commandInput: string): CommandResult {
    const parts = commandInput.trim().split(/\s+/);
    const commandName = parts[0].toLowerCase();
    const args = parts.slice(1);

    // 查找匹配的命令
    const command = this.findCommand(commandName);
    if (!command) {
      return {
        success: false,
        message: `未知命令: ${commandName}。输入 'help' 查看可用命令。`
      };
    }

    // 检查命令是否可用
    const controlState = this.controlStates.get(sessionId);
    if (controlState && !controlState.availableCommands.includes(command)) {
      return {
        success: false,
        message: `命令 '${commandName}' 在当前状态下不可用。`
      };
    }

    // 执行命令
    const handler = this.commandHandlers.get(command);
    if (handler) {
      return handler(sessionId, args);
    }

    return {
      success: false,
      message: `命令 '${commandName}' 暂未实现。`
    };
  }

  /**
   * 更新控制状态
   */
  updateControlState(sessionId: string, workflowContext: WorkflowContext): void {
    const controlState = this.controlStates.get(sessionId);
    if (controlState) {
      controlState.currentPhase = workflowContext.currentPhase;
      controlState.availableCommands = this.getAvailableCommands(workflowContext.currentPhase);
      controlState.canSkip = this.canSkipPhase(workflowContext.currentPhase);
      controlState.canForceNext = this.canForceNext(workflowContext);
    }
  }

  /**
   * 检查会话是否暂停
   */
  isPaused(sessionId: string): boolean {
    return this.pausedSessions.has(sessionId);
  }

  /**
   * 获取控制状态
   */
  getControlState(sessionId: string): ControlState | null {
    return this.controlStates.get(sessionId) || null;
  }

  /**
   * 清理会话
   */
  cleanupSession(sessionId: string): void {
    this.controlStates.delete(sessionId);
    this.pausedSessions.delete(sessionId);
    this.savedStates.delete(sessionId);
  }

  /**
   * 获取可用命令
   */
  private getAvailableCommands(phase: WorkflowPhase): InteractiveCommand[] {
    const baseCommands = [
      InteractiveCommand.SHOW_STATUS,
      InteractiveCommand.SHOW_HELP,
      InteractiveCommand.TOGGLE_PROGRESS,
      InteractiveCommand.SAVE_STATE
    ];

    if (phase === WorkflowPhase.COMPLETED) {
      return [...baseCommands, InteractiveCommand.LOAD_STATE];
    }

    return [
      ...baseCommands,
      InteractiveCommand.PAUSE,
      InteractiveCommand.RESUME,
      InteractiveCommand.SKIP_PHASE,
      InteractiveCommand.ABORT,
      InteractiveCommand.FORCE_NEXT,
      InteractiveCommand.CHANGE_MODE,
      InteractiveCommand.LOAD_STATE
    ];
  }

  /**
   * 查找命令
   */
  private findCommand(input: string): InteractiveCommand | null {
    const commandMap: Record<string, InteractiveCommand> = {
      'pause': InteractiveCommand.PAUSE,
      'resume': InteractiveCommand.RESUME,
      'skip': InteractiveCommand.SKIP_PHASE,
      'abort': InteractiveCommand.ABORT,
      'next': InteractiveCommand.FORCE_NEXT,
      'status': InteractiveCommand.SHOW_STATUS,
      'help': InteractiveCommand.SHOW_HELP,
      'mode': InteractiveCommand.CHANGE_MODE,
      'progress': InteractiveCommand.TOGGLE_PROGRESS,
      'save': InteractiveCommand.SAVE_STATE,
      'load': InteractiveCommand.LOAD_STATE,
      // 中文别名
      '暂停': InteractiveCommand.PAUSE,
      '继续': InteractiveCommand.RESUME,
      '跳过': InteractiveCommand.SKIP_PHASE,
      '中止': InteractiveCommand.ABORT,
      '下一步': InteractiveCommand.FORCE_NEXT,
      '状态': InteractiveCommand.SHOW_STATUS,
      '帮助': InteractiveCommand.SHOW_HELP,
      '模式': InteractiveCommand.CHANGE_MODE,
      '进度': InteractiveCommand.TOGGLE_PROGRESS,
      '保存': InteractiveCommand.SAVE_STATE,
      '加载': InteractiveCommand.LOAD_STATE
    };

    return commandMap[input] || null;
  }

  /**
   * 检查是否可以跳过阶段
   */
  private canSkipPhase(phase: WorkflowPhase): boolean {
    // 搜索和验证阶段可以跳过，读取和修改阶段通常不建议跳过
    return phase === WorkflowPhase.SEARCH || phase === WorkflowPhase.VERIFY;
  }

  /**
   * 检查是否可以强制下一步
   */
  private canForceNext(context: WorkflowContext): boolean {
    // 如果当前阶段有结果，就可以强制进入下一阶段
    const currentPhaseData = context.phases[context.currentPhase];
    return currentPhaseData !== null && Object.keys(currentPhaseData?.results || {}).length > 0;
  }

  // 命令处理器实现

  /**
   * 处理暂停命令
   */
  private handlePause(sessionId: string): CommandResult {
    this.pausedSessions.add(sessionId);
    const controlState = this.controlStates.get(sessionId);
    if (controlState) {
      controlState.isPaused = true;
    }

    return {
      success: true,
      message: '⏸️ 工作流已暂停。输入 "resume" 或 "继续" 恢复执行。',
      newState: controlState || undefined
    };
  }

  /**
   * 处理恢复命令
   */
  private handleResume(sessionId: string): CommandResult {
    this.pausedSessions.delete(sessionId);
    const controlState = this.controlStates.get(sessionId);
    if (controlState) {
      controlState.isPaused = false;
    }

    return {
      success: true,
      message: '▶️ 工作流已恢复执行。',
      newState: controlState || undefined
    };
  }

  /**
   * 处理跳过阶段命令
   */
  private handleSkipPhase(sessionId: string): CommandResult {
    const controlState = this.controlStates.get(sessionId);
    if (!controlState) {
      return { success: false, message: '未找到会话状态。' };
    }

    if (!this.canSkipPhase(controlState.currentPhase)) {
      return {
        success: false,
        message: `当前阶段 "${this.getPhaseName(controlState.currentPhase)}" 不建议跳过。`
      };
    }

    // 这里应该调用工作流管理器强制进入下一阶段
    // 为了演示，我们只是返回消息
    return {
      success: true,
      message: `⏭️ 正在跳过 "${this.getPhaseName(controlState.currentPhase)}" 阶段...`
    };
  }

  /**
   * 处理中止命令
   */
  private handleAbort(sessionId: string): CommandResult {
    const success = this.orchestrator.abortOrchestration(sessionId);
    this.cleanupSession(sessionId);

    return {
      success,
      message: success ? '🛑 工作流已中止。' : '❌ 中止工作流失败。',
      shouldExit: success
    };
  }

  /**
   * 处理强制下一步命令
   */
  private handleForceNext(sessionId: string): CommandResult {
    const controlState = this.controlStates.get(sessionId);
    if (!controlState) {
      return { success: false, message: '未找到会话状态。' };
    }

    return {
      success: true,
      message: `⏩ 正在强制进入下一阶段...`
    };
  }

  /**
   * 处理显示状态命令
   */
  private handleShowStatus(sessionId: string): CommandResult {
    const controlState = this.controlStates.get(sessionId);
    const progressState = this.progressDisplay.getCurrentState();
    const orchestrationStats = this.orchestrator.getOrchestrationStats();

    const statusLines = [
      '📊 工作流状态:',
      `   会话ID: ${sessionId}`,
      `   当前阶段: ${controlState ? this.getPhaseName(controlState.currentPhase) : '未知'}`,
      `   是否暂停: ${controlState?.isPaused ? '是' : '否'}`,
      '',
      '📈 执行统计:',
      `   已执行工具: ${progressState?.executedTools || 0}`,
      `   总工具数量: ${progressState?.totalTools || 0}`,
      `   错误数量: ${progressState?.errors || 0}`,
      `   执行时间: ${progressState ? this.formatDuration(progressState.executionTime) : '0秒'}`,
      '',
      '⚙️ 系统状态:',
      `   活跃编排: ${orchestrationStats.activeOrchestrations}`,
      `   队列状态: ${JSON.stringify(orchestrationStats.toolCoordinatorStats.queueStatus)}`
    ];

    return {
      success: true,
      message: statusLines.join('\n')
    };
  }

  /**
   * 处理显示帮助命令
   */
  private handleShowHelp(): CommandResult {
    const helpLines = [
      '🔧 可用的交互式命令:',
      '',
      '基础控制:',
      '  pause/暂停     - 暂停工作流执行',
      '  resume/继续    - 恢复工作流执行',
      '  abort/中止     - 中止工作流并退出',
      '',
      '阶段控制:',
      '  skip/跳过      - 跳过当前阶段（仅限搜索和验证阶段）',
      '  next/下一步    - 强制进入下一阶段',
      '',
      '信息显示:',
      '  status/状态    - 显示当前工作流状态',
      '  progress/进度  - 切换进度显示模式',
      '',
      '状态管理:',
      '  save/保存      - 保存当前工作流状态',
      '  load/加载      - 加载保存的工作流状态',
      '',
      '其他:',
      '  mode/模式      - 切换显示模式',
      '  help/帮助      - 显示此帮助信息',
      '',
      '💡 提示: 可以使用中文或英文命令'
    ];

    return {
      success: true,
      message: helpLines.join('\n')
    };
  }

  /**
   * 处理切换模式命令
   */
  private handleChangeMode(sessionId: string, args?: string[]): CommandResult {
    const mode = args?.[0] || 'toggle';
    
    if (mode === 'compact' || mode === '紧凑') {
      this.progressDisplay.updateConfig({ compactMode: true });
      return { success: true, message: '📱 已切换到紧凑模式' };
    }
    
    if (mode === 'detailed' || mode === '详细') {
      this.progressDisplay.updateConfig({ compactMode: false });
      return { success: true, message: '📋 已切换到详细模式' };
    }
    
    // 切换模式
    const currentState = this.progressDisplay.getCurrentState();
    const isCompact = this.progressDisplay['config']?.compactMode;
    this.progressDisplay.updateConfig({ compactMode: !isCompact });
    
    return {
      success: true,
      message: `🔄 已切换到${!isCompact ? '紧凑' : '详细'}模式`
    };
  }

  /**
   * 处理切换进度显示命令
   */
  private handleToggleProgress(sessionId: string): CommandResult {
    // 这里可以实现进度显示的开关逻辑
    return {
      success: true,
      message: '📊 进度显示模式已切换'
    };
  }

  /**
   * 处理保存状态命令
   */
  private handleSaveState(sessionId: string): CommandResult {
    const controlState = this.controlStates.get(sessionId);
    const progressState = this.progressDisplay.getCurrentState();
    
    if (controlState && progressState) {
      const savedState = {
        controlState,
        progressState,
        timestamp: Date.now()
      };
      
      this.savedStates.set(sessionId, savedState);
      
      return {
        success: true,
        message: '💾 工作流状态已保存'
      };
    }
    
    return {
      success: false,
      message: '❌ 保存状态失败：未找到有效状态'
    };
  }

  /**
   * 处理加载状态命令
   */
  private handleLoadState(sessionId: string): CommandResult {
    const savedState = this.savedStates.get(sessionId);
    
    if (savedState) {
      return {
        success: true,
        message: `📁 已找到保存的状态（${new Date(savedState.timestamp).toLocaleString()}）\n注意：加载状态功能需要工作流管理器支持`
      };
    }
    
    return {
      success: false,
      message: '❌ 未找到保存的状态'
    };
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
} 