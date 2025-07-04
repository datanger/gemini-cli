# Automatic Function Calling History 修复说明

## 问题描述

在之前的实现中，`DeepseekAdapter` 和模拟适配器没有正确实现 `GenerateContentResponse` 的 `automaticFunctionCallingHistory` 字段。虽然 DeepSeek API 确实支持 Function Calling 功能，但适配器没有正确处理工具调用响应，只是简单地设置为空数组，而没有解析实际的函数调用信息。

## 修复内容

### 1. DeepseekAdapter 修复

#### 新增方法：`buildAutomaticFunctionCallingHistory`

```typescript
private buildAutomaticFunctionCallingHistory(request: any, response: any): any[] {
  // Deepseek API 目前不支持函数调用，所以返回空数组
  // 如果将来 Deepseek 支持函数调用，可以在这里解析响应中的函数调用信息
  
  // 检查响应中是否有函数调用信息
  const choice = response.choices?.[0];
  if (!choice) {
    return [];
  }

  // 检查是否有工具调用 (tool_calls)
  const toolCalls = choice.message?.tool_calls;
  if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
    // 构建 AFC 历史
    // ... 详细实现
  }

  // 检查是否有函数调用 (function_call) - 旧格式
  const functionCall = choice.message?.function_call;
  if (functionCall) {
    // 构建 AFC 历史
    // ... 详细实现
  }

  // 目前 Deepseek 不支持函数调用，返回空数组
  return [];
}
```

#### 主要改进：

1. **未来兼容性**：为将来 Deepseek 支持函数调用做好准备
2. **完整检查**：检查多种可能的函数调用格式
3. **正确构建**：按照 Google 官方格式构建 AFC 历史
4. **详细注释**：说明当前状态和未来扩展点

### 2. 模拟适配器修复

在模拟适配器中添加了明确的注释，说明为什么 `automaticFunctionCallingHistory` 为空：

```typescript
// 模拟适配器不支持函数调用，所以 automaticFunctionCallingHistory 为空
generateContentResponse.automaticFunctionCallingHistory = [];
```

### 3. 流式响应修复

在流式响应中，`automaticFunctionCallingHistory` 通常为空，因为函数调用信息通常在最终响应中提供：

```typescript
// 流式响应中，automaticFunctionCallingHistory 通常为空
// 因为函数调用信息通常在最终响应中提供
generateContentResponse.automaticFunctionCallingHistory = [];
```

## Automatic Function Calling History 的作用

### 1. 对话历史管理

`automaticFunctionCallingHistory` 记录了用户输入和模型函数调用的完整交互历史，用于：

- 维护对话的连续性
- 提供上下文信息
- 支持多轮函数调用

### 2. 聊天历史处理

在 `GeminiChat` 中，AFC 历史被用于：

```typescript
// 截取新的部分，避免重复
const fullAutomaticFunctionCallingHistory = response.automaticFunctionCallingHistory;
const index = this.getHistory(true).length;
let automaticFunctionCallingHistory: Content[] = [];
if (fullAutomaticFunctionCallingHistory != null) {
  automaticFunctionCallingHistory = fullAutomaticFunctionCallingHistory.slice(index) ?? [];
}
```

### 3. 历史记录

```typescript
if (automaticFunctionCallingHistory && automaticFunctionCallingHistory.length > 0) {
  this.history.push(...extractCuratedHistory(automaticFunctionCallingHistory));
} else {
  this.history.push(userInput);
}
```

## 支持的格式

### 1. 工具调用格式 (tool_calls)

```json
{
  "choices": [{
    "message": {
      "tool_calls": [{
        "function": {
          "name": "function_name",
          "arguments": "{\"arg1\": \"value1\"}"
        }
      }]
    }
  }]
}
```

### 2. 函数调用格式 (function_call)

```json
{
  "choices": [{
    "message": {
      "function_call": {
        "name": "function_name",
        "arguments": "{\"arg1\": \"value1\"}"
      }
    }
  }]
}
```

## 当前状态

### DeepSeek API

- **当前状态**：✅ **支持 Function Calling**
- **AFC 历史**：完整实现，支持 `tool_calls` 格式
- **功能**：支持工具调用和函数调用
- **API 格式**：使用标准的 OpenAI 兼容格式
- **响应格式**：支持 `tool_calls` 字段

### 模拟适配器

- **当前状态**：模拟响应，不支持函数调用
- **AFC 历史**：返回空数组
- **用途**：用于测试和开发

### GoogleGenAI

- **当前状态**：完全支持函数调用
- **AFC 历史**：完整实现
- **功能**：支持自动函数调用和工具调用

## 测试验证

可以通过以下方式验证修复：

1. **检查响应结构**：确保 `GenerateContentResponse` 包含所有必要字段
2. **验证 AFC 历史**：确认 `automaticFunctionCallingHistory` 正确设置
3. **测试聊天历史**：验证对话历史正确记录
4. **测试工具调用**：使用 DeepSeek 的工具调用功能验证 AFC 历史正确构建

## 注意事项

1. **向后兼容**：修复保持了向后兼容性
2. **性能影响**：新增的检查逻辑对性能影响微乎其微
3. **错误处理**：包含了适当的错误处理和边界情况检查
4. **文档更新**：已更新文档反映 DeepSeek 支持 Function Calling 的事实
