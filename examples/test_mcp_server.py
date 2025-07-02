#!/usr/bin/env python3
"""
Test script for the simple Python MCP server
"""

import json
import subprocess
import sys
import time

def test_mcp_server():
    """Test the MCP server by sending requests"""
    
    # Start the MCP server
    process = subprocess.Popen(
        [sys.executable, "examples/simple_python_mcp_server.py"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1
    )
    
    try:
        # Wait a bit for server to initialize
        time.sleep(0.1)
        
        # Test 1: Initialize request
        init_request = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {
                    "name": "test-client",
                    "version": "1.0.0"
                }
            }
        }
        
        print("Sending initialize request...")
        process.stdin.write(json.dumps(init_request) + "\n")
        process.stdin.flush()
        
        response = process.stdout.readline()
        print(f"Initialize response: {response.strip()}")
        
        # Test 2: Tools list request
        tools_request = {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list",
            "params": {}
        }
        
        print("\nSending tools/list request...")
        process.stdin.write(json.dumps(tools_request) + "\n")
        process.stdin.flush()
        
        response = process.stdout.readline()
        print(f"Tools list response: {response.strip()}")
        
        # Test 3: Tool call request
        call_request = {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "print_message",
                "arguments": {
                    "message": "Test message from test script!"
                }
            }
        }
        
        print("\nSending tools/call request...")
        process.stdin.write(json.dumps(call_request) + "\n")
        process.stdin.flush()
        
        response = process.stdout.readline()
        print(f"Tool call response: {response.strip()}")
        
        # Check stderr for the printed message
        stderr_output = process.stderr.read()
        if stderr_output:
            print(f"\nStderr output: {stderr_output}")
        
        print("\n✅ MCP server test completed successfully!")
        
    except Exception as e:
        print(f"❌ Error testing MCP server: {e}")
        return False
    finally:
        process.terminate()
        process.wait()
    
    return True

if __name__ == "__main__":
    print("Testing Python MCP Server...")
    success = test_mcp_server()
    sys.exit(0 if success else 1) 