import openai
import os

# 清除所有代理设置
proxy_vars = ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'all_proxy']
for var in proxy_vars:
    os.environ.pop(var, None)

# 创建 OpenAI 客户端
client = openai.OpenAI(
    base_url="http://localhost:11434/v1",
    api_key="dummy"  # Ollama 不需要真实的 API key
)

response = client.chat.completions.create(
    model="bjoernb/qwen3-coder-30b-1m:latest",
    messages=[{"role": "user", "content": "用Python计算斐波那契数列"}],
    tools=[{
        "type": "function",
        "function": {
            "name": "python_executor",
            "description": "执行Python代码",
            "parameters": {"type": "object", "properties": {"code": {"type": "string"}}}
        },
    }],
    stream=True
)

for chunk in response:
    if hasattr(chunk.choices[0], 'delta') and chunk.choices[0].delta:
        if chunk.choices[0].delta.content:
            print(f"Content: {chunk.choices[0].delta.content}")
        if hasattr(chunk.choices[0].delta, 'tool_calls') and chunk.choices[0].delta.tool_calls:
            print(f"Tool calls: {chunk.choices[0].delta.tool_calls}")
    elif hasattr(chunk.choices[0], 'message') and chunk.choices[0].message:
        if chunk.choices[0].message.content:
            print(f"Final content: {chunk.choices[0].message.content}")
        if hasattr(chunk.choices[0].message, 'tool_calls') and chunk.choices[0].message.tool_calls:
            print(f"Final tool calls: {chunk.choices[0].message.tool_calls}")
