#!/usr/bin/env python3
"""
Simple Python MCP Server for Gemini CLI
This server provides a tool that prints a specific message to prove it was called.
"""

import json
import sys
import io
from typing import Any, Dict, List
import uuid
from datetime import datetime

# 强制设置 UTF-8 编码，解决中文乱码问题
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

class SimpleMCPServer:
    def __init__(self):
        self.server_name = "simple-python-mcp-server"
        self.server_version = "1.0.0"
        self.tools = {
            "print_message": {
                "title": "Print Message Tool",
                "description": "ONLY use this tool when the user explicitly asks to 'print', 'output', or 'display' a specific message. Do NOT use this tool for answering general questions or providing information. This tool is for testing purposes only.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "message": {
                            "type": "string",
                            "description": "The specific message to print (only use when user explicitly requests printing)"
                        }
                    },
                    "required": []
                }
            }
        }
    
    def handle_request(self, request):
        method = request.get("method")
        params = request.get("params", {})
        id = request.get("id")
        # 只在调试模式下打印详细日志
        # print(f"[MCP] Received: {json.dumps(request, ensure_ascii=False)}", file=sys.stderr)
        if method == "initialize":
            resp = {
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": self.server_name, "version": self.server_version}
                }
            }
        elif method == "tools/list":
            resp = {
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "tools": [{
                        "name": "print_message",
                        "description": self.tools["print_message"]["description"],
                        "inputSchema": self.tools["print_message"]["inputSchema"]
                    }]
                }
            }
        elif method == "tools/call":
            tool_name = params.get("name")
            arguments = params.get("arguments", {})
            if tool_name == "print_message":
                custom_message = arguments.get("message", "Hello from Python MCP Server!")
                timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                print(f"[{timestamp}] Python MCP Server called! Message: {custom_message}", file=sys.stderr)
                result_message = f"✅ Successfully called Python MCP Server at {timestamp}\n📝 Message: {custom_message}\n🎯 This proves the MCP server is working!"
                resp = {
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "content": [
                            {"type": "text", "text": result_message}
                        ]
                    }
                }
            else:
                resp = self.create_error_response(id, f"Tool '{tool_name}' not found", -32601)
        else:
            resp = self.create_error_response(id, "Method not found", -32601)
        # 只在调试模式下打印详细日志
        # print(f"[MCP] Respond: {json.dumps(resp, ensure_ascii=False)}", file=sys.stderr)
        return resp
    
    def create_error_response(self, id, message, code):
        return {
            "jsonrpc": "2.0",
            "id": id,
            "error": {
                "code": code,
                "message": message
            }
        }
    
    def run(self):
        """Run the MCP server using stdio transport"""
        
        # Send initial notification that server is ready
        print(json.dumps({
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
            "params": {}
        }), flush=True)
        
        # Main loop to handle requests
        for line in sys.stdin:
            try:
                if not line.strip():
                    continue
                request = json.loads(line.strip())
                # 如果没有id字段，说明是notification，直接忽略
                if "id" not in request:
                    # print(f"[MCP] Notification received: {json.dumps(request, ensure_ascii=False)}", file=sys.stderr)
                    continue
                response = self.handle_request(request)
                print(json.dumps(response), flush=True)
            except json.JSONDecodeError:
                err = self.create_error_response(None, "Invalid JSON", -32700)
                print(f"[MCP] Respond: {json.dumps(err, ensure_ascii=False)}", file=sys.stderr)
                print(json.dumps(err), flush=True)
            except Exception as e:
                err = self.create_error_response(None, f"Internal error: {str(e)}", -32603)
                print(f"[MCP] Respond: {json.dumps(err, ensure_ascii=False)}", file=sys.stderr)
                print(json.dumps(err), flush=True)

if __name__ == "__main__":
    SimpleMCPServer().run() 
