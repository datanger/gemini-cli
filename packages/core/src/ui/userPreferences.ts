/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { FormatStyle } from './resultFormatter.js';
import { WorkflowPhase } from '../core/workflowStateManager.js';

/**
 * 用户偏好接口
 */
export interface UserPreferences {
  // 显示偏好
  display: {
    theme: 'light' | 'dark' | 'auto';
    language: 'zh' | 'en';
    fontSize: 'small' | 'medium' | 'large';
    enableAnimations: boolean;
    enableSound: boolean;
    compactMode: boolean;
  };

  // 格式化偏好
  formatting: {
    defaultStyle: FormatStyle;
    enableColors: boolean;
    enableIcons: boolean;
    maxWidth: number;
    showTimestamps: boolean;
    showMetadata: boolean;
  };

  // 工作流偏好
  workflow: {
    autoStart: boolean;
    skipConfirmation: boolean;
    enableParallel: boolean;
    preferredPhases: WorkflowPhase[];
    maxRetries: number;
    timeout: number;
  };

  // 交互偏好
  interaction: {
    enableShortcuts: boolean;
    enableSuggestions: boolean;
    autoSave: boolean;
    confirmBeforeExit: boolean;
    showProgressByDefault: boolean;
  };

  // 通知偏好
  notifications: {
    enableDesktop: boolean;
    enableSound: boolean;
    onSuccess: boolean;
    onError: boolean;
    onCompletion: boolean;
  };

  // 快捷键配置
  shortcuts: Record<string, string>;

  // 自定义命令别名
  aliases: Record<string, string>;

  // 最近使用的命令
  recentCommands: string[];

  // 收藏的工作流模板
  favoriteTemplates: WorkflowTemplate[];
}

/**
 * 工作流模板接口
 */
export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  phases: WorkflowPhase[];
  defaultArgs: Record<string, any>;
  tags: string[];
  createdAt: number;
  usageCount: number;
}

/**
 * 偏好更新事件接口
 */
export interface PreferenceUpdateEvent {
  category: keyof UserPreferences;
  key: string;
  oldValue: any;
  newValue: any;
  timestamp: number;
}

/**
 * 用户偏好管理器
 */
export class UserPreferencesManager {
  private preferences: UserPreferences;
  private listeners: ((event: PreferenceUpdateEvent) => void)[] = [];
  private storageKey = 'gemini-cli-user-preferences';
  private autoSaveEnabled = true;

  constructor() {
    this.preferences = this.getDefaultPreferences();
    this.loadPreferences();
  }

  /**
   * 获取默认偏好设置
   */
  private getDefaultPreferences(): UserPreferences {
    return {
      display: {
        theme: 'auto',
        language: 'zh',
        fontSize: 'medium',
        enableAnimations: true,
        enableSound: false,
        compactMode: false
      },
      formatting: {
        defaultStyle: FormatStyle.STANDARD,
        enableColors: true,
        enableIcons: true,
        maxWidth: 80,
        showTimestamps: true,
        showMetadata: false
      },
      workflow: {
        autoStart: false,
        skipConfirmation: false,
        enableParallel: true,
        preferredPhases: [WorkflowPhase.SEARCH, WorkflowPhase.READ, WorkflowPhase.MODIFY, WorkflowPhase.VERIFY],
        maxRetries: 3,
        timeout: 300000
      },
      interaction: {
        enableShortcuts: true,
        enableSuggestions: true,
        autoSave: true,
        confirmBeforeExit: true,
        showProgressByDefault: true
      },
      notifications: {
        enableDesktop: false,
        enableSound: false,
        onSuccess: true,
        onError: true,
        onCompletion: true
      },
      shortcuts: {
        'ctrl+p': 'pause',
        'ctrl+r': 'resume',
        'ctrl+s': 'save',
        'ctrl+q': 'abort',
        'ctrl+h': 'help',
        'ctrl+shift+s': 'status',
        'esc': 'cancel'
      },
      aliases: {
        's': 'search',
        'r': 'read',
        'm': 'modify',
        'v': 'verify',
        'st': 'status',
        'h': 'help'
      },
      recentCommands: [],
      favoriteTemplates: []
    };
  }

  /**
   * 获取所有偏好设置
   */
  getPreferences(): UserPreferences {
    return { ...this.preferences };
  }

  /**
   * 获取特定类别的偏好设置
   */
  getCategory<K extends keyof UserPreferences>(category: K): UserPreferences[K] {
    return { ...this.preferences[category] };
  }

  /**
   * 获取特定偏好值
   */
  get<K extends keyof UserPreferences, T extends keyof UserPreferences[K]>(
    category: K,
    key: T
  ): UserPreferences[K][T] {
    return this.preferences[category][key];
  }

  /**
   * 设置特定偏好值
   */
  set<K extends keyof UserPreferences, T extends keyof UserPreferences[K]>(
    category: K,
    key: T,
    value: UserPreferences[K][T]
  ): void {
    const oldValue = this.preferences[category][key];
    
    if (oldValue === value) return; // 值未变化，无需更新

    this.preferences[category][key] = value;

    // 触发更新事件
    const event: PreferenceUpdateEvent = {
      category,
      key: String(key),
      oldValue,
      newValue: value,
      timestamp: Date.now()
    };

    this.notifyListeners(event);

    // 自动保存
    if (this.autoSaveEnabled) {
      this.savePreferences();
    }
  }

  /**
   * 批量更新偏好设置
   */
  updateCategory<K extends keyof UserPreferences>(
    category: K,
    updates: Partial<UserPreferences[K]>
  ): void {
    const oldCategory = { ...this.preferences[category] };
    
    // 应用更新
    Object.assign(this.preferences[category], updates);

    // 为每个更改的键触发事件
    for (const [key, value] of Object.entries(updates)) {
      if (oldCategory[key as keyof UserPreferences[K]] !== value) {
        const event: PreferenceUpdateEvent = {
          category,
          key,
          oldValue: oldCategory[key as keyof UserPreferences[K]],
          newValue: value,
          timestamp: Date.now()
        };
        this.notifyListeners(event);
      }
    }

    if (this.autoSaveEnabled) {
      this.savePreferences();
    }
  }

  /**
   * 重置偏好设置
   */
  reset(category?: keyof UserPreferences): void {
    const defaults = this.getDefaultPreferences();
    
    if (category) {
      this.preferences[category] = defaults[category] as any;
    } else {
      this.preferences = defaults;
    }

    if (this.autoSaveEnabled) {
      this.savePreferences();
    }
  }

  /**
   * 添加快捷键
   */
  addShortcut(key: string, command: string): void {
    this.set('shortcuts', key as any, command);
  }

  /**
   * 删除快捷键
   */
  removeShortcut(key: string): void {
    const shortcuts = { ...this.preferences.shortcuts };
    delete shortcuts[key];
    this.updateCategory('shortcuts', shortcuts);
  }

  /**
   * 添加命令别名
   */
  addAlias(alias: string, command: string): void {
    this.set('aliases', alias as any, command);
  }

  /**
   * 删除命令别名
   */
  removeAlias(alias: string): void {
    const aliases = { ...this.preferences.aliases };
    delete aliases[alias];
    this.updateCategory('aliases', aliases);
  }

  /**
   * 记录最近使用的命令
   */
  recordRecentCommand(command: string): void {
    const recentCommands = [...this.preferences.recentCommands];
    
    // 移除已存在的相同命令
    const existingIndex = recentCommands.indexOf(command);
    if (existingIndex > -1) {
      recentCommands.splice(existingIndex, 1);
    }

    // 添加到开头
    recentCommands.unshift(command);

    // 保持最多20个最近命令
    if (recentCommands.length > 20) {
      recentCommands.pop();
    }

    this.updateCategory('recentCommands', recentCommands);
  }

  /**
   * 获取最近使用的命令
   */
  getRecentCommands(limit: number = 10): string[] {
    return this.preferences.recentCommands.slice(0, limit);
  }

  /**
   * 添加收藏的工作流模板
   */
  addFavoriteTemplate(template: Omit<WorkflowTemplate, 'id' | 'createdAt' | 'usageCount'>): string {
    const newTemplate: WorkflowTemplate = {
      id: this.generateTemplateId(),
      createdAt: Date.now(),
      usageCount: 0,
      ...template
    };

    const favoriteTemplates = [...this.preferences.favoriteTemplates, newTemplate];
    this.updateCategory('favoriteTemplates', favoriteTemplates);

    return newTemplate.id;
  }

  /**
   * 删除收藏的工作流模板
   */
  removeFavoriteTemplate(templateId: string): boolean {
    const favoriteTemplates = this.preferences.favoriteTemplates.filter(
      template => template.id !== templateId
    );

    if (favoriteTemplates.length === this.preferences.favoriteTemplates.length) {
      return false; // 模板不存在
    }

    this.updateCategory('favoriteTemplates', favoriteTemplates);
    return true;
  }

  /**
   * 获取收藏的工作流模板
   */
  getFavoriteTemplates(): WorkflowTemplate[] {
    return [...this.preferences.favoriteTemplates];
  }

  /**
   * 使用工作流模板（增加使用计数）
   */
  useTemplate(templateId: string): WorkflowTemplate | null {
    const template = this.preferences.favoriteTemplates.find(t => t.id === templateId);
    if (!template) return null;

    template.usageCount++;
    this.savePreferences();

    return { ...template };
  }

  /**
   * 解析命令别名
   */
  resolveAlias(input: string): string {
    const parts = input.trim().split(/\s+/);
    const command = parts[0];
    const args = parts.slice(1);

    const resolvedCommand = this.preferences.aliases[command] || command;
    return args.length > 0 ? `${resolvedCommand} ${args.join(' ')}` : resolvedCommand;
  }

  /**
   * 检查快捷键
   */
  getShortcutCommand(keyCombo: string): string | null {
    return this.preferences.shortcuts[keyCombo] || null;
  }

  /**
   * 导出偏好设置
   */
  exportPreferences(): string {
    return JSON.stringify(this.preferences, null, 2);
  }

  /**
   * 导入偏好设置
   */
  importPreferences(data: string): boolean {
    try {
      const imported = JSON.parse(data) as UserPreferences;
      
      // 验证导入的数据结构
      if (this.validatePreferences(imported)) {
        this.preferences = imported;
        this.savePreferences();
        return true;
      }
    } catch (error) {
      console.error('导入偏好设置失败:', error);
    }
    return false;
  }

  /**
   * 添加偏好更新监听器
   */
  addListener(listener: (event: PreferenceUpdateEvent) => void): void {
    this.listeners.push(listener);
  }

  /**
   * 移除偏好更新监听器
   */
  removeListener(listener: (event: PreferenceUpdateEvent) => void): void {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * 启用/禁用自动保存
   */
  setAutoSave(enabled: boolean): void {
    this.autoSaveEnabled = enabled;
  }

  /**
   * 手动保存偏好设置
   */
  savePreferences(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, JSON.stringify(this.preferences));
      }
    } catch (error) {
      console.error('保存偏好设置失败:', error);
    }
  }

  /**
   * 加载偏好设置
   */
  private loadPreferences(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem(this.storageKey);
        if (stored) {
          const parsed = JSON.parse(stored) as UserPreferences;
          if (this.validatePreferences(parsed)) {
            // 合并默认设置和已保存的设置
            this.preferences = this.mergePreferences(this.getDefaultPreferences(), parsed);
          }
        }
      }
    } catch (error) {
      console.error('加载偏好设置失败:', error);
    }
  }

  /**
   * 验证偏好设置数据结构
   */
  private validatePreferences(prefs: any): prefs is UserPreferences {
    // 基本结构验证
    return (
      typeof prefs === 'object' &&
      prefs.display && typeof prefs.display === 'object' &&
      prefs.formatting && typeof prefs.formatting === 'object' &&
      prefs.workflow && typeof prefs.workflow === 'object' &&
      prefs.interaction && typeof prefs.interaction === 'object' &&
      prefs.notifications && typeof prefs.notifications === 'object' &&
      prefs.shortcuts && typeof prefs.shortcuts === 'object' &&
      prefs.aliases && typeof prefs.aliases === 'object' &&
      Array.isArray(prefs.recentCommands) &&
      Array.isArray(prefs.favoriteTemplates)
    );
  }

  /**
   * 合并偏好设置（用于向后兼容）
   */
  private mergePreferences(defaults: UserPreferences, stored: UserPreferences): UserPreferences {
    const merged = { ...defaults };
    
    // 深度合并每个类别
    for (const category of Object.keys(defaults) as (keyof UserPreferences)[]) {
      if (stored[category] && typeof stored[category] === 'object') {
        if (Array.isArray(stored[category])) {
          merged[category] = stored[category] as any;
        } else {
          merged[category] = { ...defaults[category], ...stored[category] } as any;
        }
      }
    }
    
    return merged;
  }

  /**
   * 生成模板ID
   */
  private generateTemplateId(): string {
    return `template-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(event: PreferenceUpdateEvent): void {
    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('偏好设置监听器错误:', error);
      }
    });
  }
} 