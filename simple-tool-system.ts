/**
 * 简化版四工具调用系统
 * 基于 Gemini CLI 的工具调用模式设计
 */

// ==================== 基础类型定义 ====================

interface ToolResult {
  success: boolean;
  data: any;
  message: string;
  files?: string[];
  dependencies?: string[];
}

interface ToolRequest {
  id: string;
  tool: string;
  params: any;
  dependencies?: string[];
}

type ToolStatus = 'pending' | 'confirming' | 'executing' | 'success' | 'error' | 'cancelled';

interface ToolCallState {
  id: string;
  status: ToolStatus;
  tool: string;
  params: any;
  result?: ToolResult;
  error?: Error;
  startTime: number;
  endTime?: number;
  dependencies: string[];
}

// ==================== 工具基础类 ====================

abstract class BaseTool {
  abstract name: string;
  abstract description: string;

  // 验证参数
  validate(params: any): string | null {
    return null; // 简化版本不做复杂验证
  }

  // 是否需要确认
  shouldConfirm(params: any): boolean {
    return false; // 简化版本默认不需要确认
  }

  // 抽象执行方法
  abstract execute(params: any, signal: AbortSignal): Promise<ToolResult>;

  // 获取操作描述
  getDescription(params: any): string {
    return `执行 ${this.name} 工具`;
  }
}

// ==================== 四个具体工具实现 ====================

class SearchTool extends BaseTool {
  name = 'search';
  description = '搜索代码、文件或模式';

  async execute(params: any, signal: AbortSignal): Promise<ToolResult> {
    const { pattern, type = 'code', scope = '.' } = params;
    
    console.log(`🔍 [SearchTool] 搜索模式: "${pattern}", 类型: ${type}, 范围: ${scope}`);
    
    // 模拟搜索延迟
    await this.sleep(800);
    
    if (signal.aborted) {
      throw new Error('搜索被用户取消');
    }

    // 模拟搜索结果
    const mockResults = this.generateMockSearchResults(pattern, type);
    
    console.log(`✅ [SearchTool] 找到 ${mockResults.length} 个匹配项`);
    mockResults.forEach((item, index) => {
      console.log(`   ${index + 1}. ${item}`);
    });

    return {
      success: true,
      data: mockResults,
      message: `搜索完成，找到 ${mockResults.length} 个结果`,
      files: mockResults
    };
  }

  private generateMockSearchResults(pattern: string, type: string): string[] {
    const baseResults = [
      `src/components/${pattern}Component.tsx`,
      `src/services/${pattern}Service.ts`,
      `tests/${pattern}.test.ts`
    ];

    if (type === 'config') {
      return [`config/${pattern}.json`, `.${pattern}rc`, `${pattern}.config.js`];
    } else if (type === 'test') {
      return [`tests/${pattern}.test.ts`, `__tests__/${pattern}.spec.ts`];
    }

    return baseResults;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

class ReadTool extends BaseTool {
  name = 'read';
  description = '读取文件内容';

  shouldConfirm(params: any): boolean {
    // 读取敏感文件需要确认
    const { path } = params;
    return path && (path.includes('.env') || path.includes('secret') || path.includes('key'));
  }

  async execute(params: any, signal: AbortSignal): Promise<ToolResult> {
    const { path, mode = 'single', focus } = params;
    
    if (Array.isArray(path)) {
      console.log(`📖 [ReadTool] 批量读取 ${path.length} 个文件`);
      return await this.readMultipleFiles(path, focus, signal);
    } else {
      console.log(`📖 [ReadTool] 读取文件: ${path}${focus ? ` (聚焦: ${focus})` : ''}`);
      return await this.readSingleFile(path, focus, signal);
    }
  }

  private async readSingleFile(path: string, focus?: string, signal?: AbortSignal): Promise<ToolResult> {
    await this.sleep(500);

    if (signal?.aborted) {
      throw new Error('文件读取被用户取消');
    }

    // 模拟文件内容
    const mockContent = this.generateMockFileContent(path, focus);
    
    console.log(`✅ [ReadTool] 文件读取完成: ${path}`);
    console.log(`   内容摘要: ${mockContent.summary}`);
    if (focus) {
      console.log(`   聚焦内容: ${mockContent.focusedContent}`);
    }

    return {
      success: true,
      data: mockContent,
      message: `成功读取文件 ${path}`,
      dependencies: mockContent.dependencies
    };
  }

  private async readMultipleFiles(paths: string[], focus?: string, signal?: AbortSignal): Promise<ToolResult> {
    const results = [];
    
    for (const path of paths) {
      if (signal?.aborted) {
        throw new Error('批量读取被用户取消');
      }
      
      const result = await this.readSingleFile(path, focus, signal);
      results.push(result.data);
    }

    console.log(`✅ [ReadTool] 批量读取完成，共 ${results.length} 个文件`);

    return {
      success: true,
      data: results,
      message: `成功批量读取 ${paths.length} 个文件`
    };
  }

  private generateMockFileContent(path: string, focus?: string) {
    return {
      path,
      summary: `${path} 文件包含${focus ? focus : '业务逻辑'}相关代码`,
      focusedContent: focus ? `与 "${focus}" 相关的关键代码段` : null,
      dependencies: path.includes('Component') ? ['React', 'useState', 'useEffect'] : ['lodash', 'axios'],
      lineCount: Math.floor(Math.random() * 200) + 50
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

class ModifyTool extends BaseTool {
  name = 'modify';
  description = '修改文件内容';

  shouldConfirm(params: any): boolean {
    // 修改操作总是需要确认
    return true;
  }

  getDescription(params: any): string {
    const { path, change, type = 'edit' } = params;
    return `${type === 'create' ? '创建' : '修改'} 文件 ${path}: ${change}`;
  }

  async execute(params: any, signal: AbortSignal): Promise<ToolResult> {
    const { path, change, type = 'edit', backup = true } = params;
    
    console.log(`✏️  [ModifyTool] ${type === 'create' ? '创建' : '修改'} 文件: ${path}`);
    console.log(`   变更内容: ${change}`);
    
    if (backup && type === 'edit') {
      console.log(`   创建备份: ${path}.backup`);
    }

    // 模拟修改延迟
    await this.sleep(1000);
    
    if (signal.aborted) {
      throw new Error('文件修改被用户取消');
    }

    // 模拟修改结果
    const result = this.simulateModification(path, change, type);
    
    console.log(`✅ [ModifyTool] 文件${type === 'create' ? '创建' : '修改'}完成`);
    console.log(`   影响行数: ${result.changedLines}`);
    if (result.warnings.length > 0) {
      console.log(`   ⚠️  警告: ${result.warnings.join(', ')}`);
    }

    return {
      success: true,
      data: result,
      message: `${type === 'create' ? '创建' : '修改'}文件成功: ${path}`
    };
  }

  private simulateModification(path: string, change: string, type: string) {
    const changedLines = Math.floor(Math.random() * 20) + 5;
    const warnings = [];
    
    // 模拟一些警告
    if (path.includes('test')) {
      warnings.push('测试文件修改可能影响CI');
    }
    if (change.includes('delete')) {
      warnings.push('删除操作不可逆');
    }

    return {
      path,
      type,
      changedLines,
      warnings,
      timestamp: new Date().toISOString()
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

class VerifyTool extends BaseTool {
  name = 'verify';
  description = '验证代码质量和测试';

  async execute(params: any, signal: AbortSignal): Promise<ToolResult> {
    const { type, scope = '.', fix = false } = params;
    
    console.log(`🧪 [VerifyTool] 执行 ${type} 验证，范围: ${scope}`);
    
    // 模拟验证过程
    const result = await this.runVerification(type, scope, fix, signal);
    
    if (result.success) {
      console.log(`✅ [VerifyTool] ${type} 验证通过`);
    } else {
      console.log(`❌ [VerifyTool] ${type} 验证失败`);
      result.issues.forEach((issue, index) => {
        console.log(`   ${index + 1}. ${issue}`);
      });
    }

    return result;
  }

  private async runVerification(type: string, scope: string, fix: boolean, signal: AbortSignal): Promise<ToolResult> {
    const steps = this.getVerificationSteps(type);
    
    for (let i = 0; i < steps.length; i++) {
      if (signal.aborted) {
        throw new Error('验证被用户取消');
      }
      
      console.log(`   正在执行: ${steps[i]}`);
      await this.sleep(600);
    }

    // 模拟验证结果
    const issues = this.generateMockIssues(type, scope);
    const success = issues.length === 0;

    if (fix && !success) {
      console.log(`🔧 [VerifyTool] 尝试自动修复 ${issues.length} 个问题...`);
      await this.sleep(800);
      // 模拟修复成功
      return {
        success: true,
        data: { type, scope, fixed: issues.length },
        message: `${type} 验证完成，已自动修复 ${issues.length} 个问题`
      };
    }

    return {
      success,
      data: { type, scope, issues },
      message: success ? `${type} 验证通过` : `${type} 验证失败，发现 ${issues.length} 个问题`,
      issues
    };
  }

  private getVerificationSteps(type: string): string[] {
    const stepMap: Record<string, string[]> = {
      test: ['运行单元测试', '检查测试覆盖率', '验证测试报告'],
      lint: ['检查代码风格', '验证TypeScript类型', '检查导入规范'],
      build: ['编译TypeScript', '打包资源', '验证输出'],
      security: ['扫描依赖漏洞', '检查敏感信息泄露', '验证权限配置']
    };
    
    return stepMap[type] || ['执行基础验证'];
  }

  private generateMockIssues(type: string, scope: string): string[] {
    const issueTemplates: Record<string, string[]> = {
      test: ['测试用例 UserService.test.ts 失败', '代码覆盖率不足 80%'],
      lint: ['变量 userName 使用了未定义类型', '缺少分号在第 45 行'],
      build: ['模块 ./utils/helper 找不到', '类型错误在 components/Button.tsx'],
      security: ['依赖 lodash 存在已知漏洞', 'API密钥可能暴露在代码中']
    };

    // 随机决定是否有问题
    const hasIssues = Math.random() > 0.6;
    if (!hasIssues) return [];

    const templates = issueTemplates[type] || ['发现未知问题'];
    const issueCount = Math.floor(Math.random() * templates.length) + 1;
    
    return templates.slice(0, issueCount);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ==================== 状态管理器 ====================

class StateManager {
  private states = new Map<string, ToolCallState>();
  private listeners: ((state: ToolCallState) => void)[] = [];

  addListener(listener: (state: ToolCallState) => void) {
    this.listeners.push(listener);
  }

  updateState(callId: string, status: ToolStatus, result?: ToolResult, error?: Error) {
    const state = this.states.get(callId);
    if (!state) return;

    state.status = status;
    if (result) state.result = result;
    if (error) state.error = error;
    if (status === 'success' || status === 'error' || status === 'cancelled') {
      state.endTime = Date.now();
    }

    this.notifyListeners(state);
  }

  createState(id: string, tool: string, params: any, dependencies: string[] = []): ToolCallState {
    const state: ToolCallState = {
      id,
      status: 'pending',
      tool,
      params,
      startTime: Date.now(),
      dependencies
    };
    
    this.states.set(id, state);
    return state;
  }

  getState(callId: string): ToolCallState | undefined {
    return this.states.get(callId);
  }

  getAllStates(): ToolCallState[] {
    return Array.from(this.states.values());
  }

  private notifyListeners(state: ToolCallState) {
    this.listeners.forEach(listener => listener(state));
  }
}

// ==================== 依赖分析器 ====================

class DependencyAnalyzer {
  analyzeDependencies(requests: ToolRequest[]): {
    parallel: ToolRequest[];
    sequential: ToolRequest[][];
  } {
    const graph = this.buildDependencyGraph(requests);
    const parallel = requests.filter(req => req.dependencies?.length === 0 || !req.dependencies);
    const sequential = this.topologicalSort(graph);
    
    return { parallel, sequential };
  }

  private buildDependencyGraph(requests: ToolRequest[]): Map<string, string[]> {
    const graph = new Map<string, string[]>();
    
    requests.forEach(req => {
      graph.set(req.id, req.dependencies || []);
    });
    
    return graph;
  }

  private topologicalSort(graph: Map<string, string[]>): ToolRequest[][] {
    // 简化的拓扑排序，返回按依赖层级分组的任务
    const layers: ToolRequest[][] = [];
    const visited = new Set<string>();
    
    // 这里简化处理，实际应该实现完整的拓扑排序
    return layers;
  }
}

// ==================== 工具调度器 ====================

class ToolScheduler {
  private tools = new Map<string, BaseTool>();
  private stateManager = new StateManager();
  private dependencyAnalyzer = new DependencyAnalyzer();
  private abortController = new AbortController();

  constructor() {
    // 监听状态变化
    this.stateManager.addListener(this.onStateChange.bind(this));
  }

  register(tool: BaseTool) {
    this.tools.set(tool.name, tool);
    console.log(`🔧 注册工具: ${tool.name} - ${tool.description}`);
  }

  async schedule(requests: ToolRequest[]): Promise<ToolResult[]> {
    console.log(`\n📋 调度 ${requests.length} 个工具调用...`);
    
    // 创建状态
    requests.forEach(req => {
      this.stateManager.createState(req.id, req.tool, req.params, req.dependencies);
    });

    // 分析依赖关系
    const { parallel } = this.dependencyAnalyzer.analyzeDependencies(requests);
    
    // 执行并行任务
    const results = await Promise.allSettled(
      requests.map(req => this.executeWithConfirm(req))
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        console.error(`❌ 工具 ${requests[index].tool} 执行失败:`, result.reason);
        return {
          success: false,
          data: null,
          message: `工具执行失败: ${result.reason.message}`
        };
      }
    });
  }

  private async executeWithConfirm(request: ToolRequest): Promise<ToolResult> {
    const tool = this.tools.get(request.tool);
    if (!tool) {
      throw new Error(`工具 ${request.tool} 未找到`);
    }

    const { id, params } = request;

    try {
      // 验证参数
      const validationError = tool.validate(params);
      if (validationError) {
        throw new Error(`参数验证失败: ${validationError}`);
      }

      // 检查是否需要确认
      if (tool.shouldConfirm(params)) {
        this.stateManager.updateState(id, 'confirming');
        const confirmed = await this.requestConfirmation(tool, params);
        if (!confirmed) {
          this.stateManager.updateState(id, 'cancelled');
          throw new Error('用户取消了工具执行');
        }
      }

      // 执行工具
      this.stateManager.updateState(id, 'executing');
      const result = await tool.execute(params, this.abortController.signal);
      
      this.stateManager.updateState(id, 'success', result);
      return result;

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.stateManager.updateState(id, 'error', undefined, err);
      throw err;
    }
  }

  private async requestConfirmation(tool: BaseTool, params: any): Promise<boolean> {
    const description = tool.getDescription(params);
    console.log(`\n❓ 确认执行: ${description}`);
    console.log('   输入 y/yes 确认，其他任意键取消:');
    
    // 在真实环境中，这里会等待用户输入
    // 简化版本直接返回 true
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log('   [自动确认] ✅ 已确认执行');
    return true;
  }

  private onStateChange(state: ToolCallState) {
    const duration = state.endTime ? state.endTime - state.startTime : Date.now() - state.startTime;
    const statusEmoji = {
      'pending': '⏳',
      'confirming': '❓',
      'executing': '🔄',
      'success': '✅',
      'error': '❌',
      'cancelled': '🚫'
    }[state.status] || '❔';

    console.log(`${statusEmoji} [${state.tool}:${state.id}] ${state.status} (${duration}ms)`);
  }

  // 获取状态统计
  getStats() {
    const states = this.stateManager.getAllStates();
    const stats = {
      total: states.length,
      success: states.filter(s => s.status === 'success').length,
      error: states.filter(s => s.status === 'error').length,
      executing: states.filter(s => s.status === 'executing').length,
      pending: states.filter(s => s.status === 'pending').length
    };
    
    return stats;
  }
}

// ==================== 模式实现 ====================

class ToolPatterns {
  constructor(private scheduler: ToolScheduler) {}

  // 代码分析模式
  async analyzeCodePattern(target: string): Promise<ToolResult[]> {
    console.log(`\n🎯 开始代码分析模式: ${target}`);
    
    // 第一阶段：并行信息收集
    const searchTasks: ToolRequest[] = [
      {
        id: `search-def-${Date.now()}`,
        tool: 'search',
        params: { pattern: target, type: 'definition' }
      },
      {
        id: `search-usage-${Date.now()}`,
        tool: 'search', 
        params: { pattern: target, type: 'usage' }
      },
      {
        id: `search-test-${Date.now()}`,
        tool: 'search',
        params: { pattern: target, type: 'test' }
      }
    ];

    console.log('📊 阶段1: 并行搜索相关文件...');
    const searchResults = await this.scheduler.schedule(searchTasks);
    
    // 第二阶段：基于搜索结果深入理解  
    const allFiles = searchResults.flatMap(result => result.files || []);
    if (allFiles.length > 0) {
      console.log('📖 阶段2: 深入读取相关文件...');
      const readTasks: ToolRequest[] = allFiles.slice(0, 3).map((file, index) => ({
        id: `read-${index}-${Date.now()}`,
        tool: 'read',
        params: { path: file, focus: target }
      }));

      const readResults = await this.scheduler.schedule(readTasks);
      return [...searchResults, ...readResults];
    }

    return searchResults;
  }

  // 代码修改模式  
  async modifyCodePattern(target: string, change: string): Promise<ToolResult[]> {
    console.log(`\n🔨 开始代码修改模式: ${target}`);
    
    const tasks: ToolRequest[] = [
      // 1. 理解现状
      {
        id: `read-${Date.now()}`,
        tool: 'read',
        params: { path: target }
      },
      // 2. 应用修改
      {
        id: `modify-${Date.now()}`,
        tool: 'modify',
        params: { path: target, change: change },
        dependencies: [`read-${Date.now()}`]
      },
      // 3. 验证结果
      {
        id: `verify-test-${Date.now()}`,
        tool: 'verify',
        params: { type: 'test', scope: target },
        dependencies: [`modify-${Date.now()}`]
      },
      {
        id: `verify-lint-${Date.now()}`,
        tool: 'verify',
        params: { type: 'lint', scope: target },
        dependencies: [`modify-${Date.now()}`]
      }
    ];

    console.log('🔄 执行: 读取 → 修改 → 验证 流水线...');
    return await this.scheduler.schedule(tasks);
  }

  // 项目探索模式
  async exploreProjectPattern(scope: string): Promise<ToolResult[]> {
    console.log(`\n🗺️  开始项目探索模式: ${scope}`);
    
    // 第一层：宏观搜索
    const overviewTasks: ToolRequest[] = [
      {
        id: `search-structure-${Date.now()}`,
        tool: 'search',
        params: { type: 'structure', scope: scope }
      },
      {
        id: `search-config-${Date.now()}`,
        tool: 'search',
        params: { type: 'config', scope: scope }
      }
    ];

    console.log('🔍 阶段1: 宏观结构搜索...');
    const overviewResults = await this.scheduler.schedule(overviewTasks);
    
    // 第二层：重要文件批量读取
    const importantFiles = overviewResults.flatMap(result => result.files?.slice(0, 2) || []);
    if (importantFiles.length > 0) {
      console.log('📚 阶段2: 批量读取重要文件...');
      const batchReadTask: ToolRequest = {
        id: `read-batch-${Date.now()}`,
        tool: 'read',
        params: { path: importantFiles, mode: 'batch' }
      };

      const batchResult = await this.scheduler.schedule([batchReadTask]);
      return [...overviewResults, ...batchResult];
    }

    return overviewResults;
  }
}

// ==================== 使用示例 ====================

async function main() {
  console.log('🚀 启动简化版四工具调用系统\n');
  
  // 创建调度器
  const scheduler = new ToolScheduler();
  
  // 注册四个工具
  scheduler.register(new SearchTool());
  scheduler.register(new ReadTool());
  scheduler.register(new ModifyTool());
  scheduler.register(new VerifyTool());
  
  // 创建模式执行器
  const patterns = new ToolPatterns(scheduler);
  
  try {
    // 演示1: 代码分析模式
    await patterns.analyzeCodePattern('UserAuthentication');
    
    console.log('\n' + '='.repeat(60));
    
    // 演示2: 代码修改模式
    await patterns.modifyCodePattern('src/auth.ts', 'add JWT token validation');
    
    console.log('\n' + '='.repeat(60));
    
    // 演示3: 项目探索模式
    await patterns.exploreProjectPattern('frontend');
    
    // 输出最终统计
    const stats = scheduler.getStats();
    console.log('\n📊 执行统计:');
    console.log(`   总计: ${stats.total} | 成功: ${stats.success} | 失败: ${stats.error}`);
    
  } catch (error) {
    console.error('❌ 系统执行出错:', error);
  }
}

// 导出主要类，供外部使用
export {
  BaseTool,
  SearchTool,
  ReadTool, 
  ModifyTool,
  VerifyTool,
  ToolScheduler,
  ToolPatterns,
  StateManager
};

// 如果直接运行此文件，执行示例
if (require.main === module) {
  main().catch(console.error);
} 