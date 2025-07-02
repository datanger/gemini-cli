# Python MCP Server for Gemini CLI

这是一个简单的Python MCP服务器示例，用于演示如何在Gemini CLI中集成自定义MCP服务器。

## 文件说明

- `simple_python_mcp_server.py` - Python MCP服务器实现
- `gemini_settings_with_python_mcp.json` - Gemini CLI配置文件示例

## 功能

这个MCP服务器提供了一个名为 `print_message` 的工具，当被调用时会：

1. 打印时间戳和消息到stderr（在CLI输出中可见）
2. 返回一个格式化的成功消息
3. 证明MCP服务器确实被调用了

## 安装和配置

### 1. 确保Python环境

确保你的系统已安装Python 3.6+：

```bash
python3 --version
```

### 2. 配置Gemini CLI

将MCP服务器配置添加到你的Gemini CLI设置中。有两种方式：

#### 方式1：全局配置（推荐）

编辑 `~/.gemini/settings.json` 文件，添加以下配置：

```json
{
  "mcpServers": {
    "pythonMCP": {
      "command": "python3",
      "args": ["/path/to/gemini-cli/examples/simple_python_mcp_server.py"],
      "cwd": "/path/to/gemini-cli",
      "timeout": 10000,
      "trust": true
    }
  }
}
```

**注意：** 请将 `/path/to/gemini-cli` 替换为你的实际gemini-cli项目路径。

#### 方式2：项目级配置

在你的项目根目录创建 `.gemini/settings.json` 文件：

```json
{
  "mcpServers": {
    "pythonMCP": {
      "command": "python3",
      "args": ["../examples/simple_python_mcp_server.py"],
      "cwd": ".",
      "timeout": 10000,
      "trust": true
    }
  }
}
```

### 3. 验证配置

启动Gemini CLI，你应该能在启动日志中看到MCP服务器连接成功的信息。

## 使用方法

配置完成后，你可以在Gemini CLI中使用以下命令来测试MCP服务器：

```
请调用print_message工具
```

或者：

```
使用print_message工具打印一条消息
```

## 预期输出

当MCP服务器被调用时，你会看到：

1. **在CLI输出中**（stderr）：
   ```
   [2024-01-15 10:30:45] Python MCP Server called! Message: Hello from Python MCP Server!
   ```

2. **在AI响应中**：
   ```
   ✅ Successfully called Python MCP Server at 2024-01-15 10:30:45
   📝 Message: Hello from Python MCP Server!
   🎯 This proves the MCP server is working!
   ```

## 自定义消息

你也可以传递自定义消息：

```
使用print_message工具打印消息："这是我的自定义消息"
```

## 故障排除

### 1. 权限问题

确保Python脚本有执行权限：

```bash
chmod +x examples/simple_python_mcp_server.py
```

### 2. 路径问题

确保在配置中使用了正确的绝对路径或相对路径。

### 3. Python版本

确保使用Python 3.6+版本。

### 4. 连接超时

如果遇到连接超时，可以增加timeout值：

```json
{
  "timeout": 30000
}
```

## 扩展

你可以基于这个示例创建更复杂的MCP服务器，添加更多工具和功能。每个工具都应该：

1. 在 `tools` 字典中定义
2. 实现相应的处理函数
3. 在 `handle_tools_call` 中添加路由

## 更多信息

- [MCP协议文档](https://modelcontextprotocol.io/)
- [Gemini CLI MCP文档](../docs/tools/mcp-server.md) 