#!/usr/bin/env python3
"""
MCP Recursive Analyzer Server - 标准MCP协议的MATLAB脚本递归调用链分析工具服务
基于recursive_call_analyzer.py，提供MATLAB脚本的递归调用链分析功能
"""

import asyncio
import json
import logging
import sys
import os
from datetime import datetime
from typing import Any, Dict, Optional, List, Tuple
from pathlib import Path
from collections import defaultdict
import uuid

# 导入recursive_call_analyzer的相关类（相对当前扩展目录）
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.append(CURRENT_DIR)
from recursive_call_analyzer import RecursiveCallAnalyzer

# ========== 标准化MCP响应的工具函数 ==========
def build_mcp_response(result: Any = None, id_value: Any = None, method_value: Any = None, error: dict = None) -> dict:
    """
    构建符合Gemini CLI schema要求的MCP响应对象
    :param result: 业务数据（可为None）
    :param id_value: 响应ID，必须为字符串或数字，不能为None/null
    :param method_value: 方法名，必须为字符串，不能为None
    :param error: 错误对象（可为None）
    :return: dict
    """
    # id字段校验：若id_value为None，自动生成唯一字符串，防止为null
    if id_value is None:
        id_value = str(uuid.uuid4())
        logging.getLogger(__name__).warning(f"MCP响应id字段为None，已自动生成唯一id: {id_value}")
    elif not isinstance(id_value, (str, int)):
        id_value = str(id_value)
    # method字段校验
    if not isinstance(method_value, str) or not method_value:
        method_value = "default_method"
    # 构建标准响应
    resp = {
        "jsonrpc": "2.0",
        "id": id_value,
    }
    if error is not None:
        resp["error"] = error
    else:
        resp["result"] = result
    return resp

class MCPRecursiveAnalyzerServer:
    """标准MCP协议的MATLAB脚本递归调用链分析工具服务器"""
    
    def __init__(self):
        self.logger = logging.getLogger(__name__)
        self.initialized = False
        self.analyzers = {}  # 缓存不同项目的分析器
        
        # 工具注册 - 适配递归分析功能
        self.tools = {
            "matlab_recursive_analyze": {
                "name": "matlab_recursive_analyze",
                "description": "MATLAB脚本递归调用链分析工具。输入为MATLAB项目路径、入口脚本和分析脚本，工具会分析从入口脚本到分析脚本的调用链，以及从分析脚本到叶子节点的调用链，返回两个嵌套列表格式的结果。适用于需要分析MATLAB脚本调用关系的场景。",
                "inputSchema": self._normalize_schema({
                    "type": "object",
                    "properties": {
                        "project_path": {
                            "type": "string",
                            "description": "MATLAB项目根目录路径（可选，如未提供将使用预设值）"
                        },
                        "entry_script": {
                            "type": "string",
                            "description": "入口脚本名称（相对于项目路径，必填）"
                        },
                        "analysis_script": {
                            "type": "string",
                            "description": "分析脚本名称（相对于项目路径，必填）"
                        }
                    },
                    "required": ["entry_script", "analysis_script"],
                    "additionalProperties": False
                })
            },
            "matlab_project_overview": {
                "name": "matlab_project_overview",
                "description": "获取MATLAB项目的概览信息，包括总脚本数、调用关系数等统计信息。",
                "inputSchema": self._normalize_schema({
                    "type": "object",
                    "properties": {
                        "project_path": {
                            "type": "string",
                            "description": "MATLAB项目根目录路径（可选，如未提供将使用预设值）"
                        }
                    },
                    "required": [],
                    "additionalProperties": False
                })
            },
            "matlab_impact_from_git_diff": {
                "name": "matlab_impact_from_git_diff",
                "description": "Impact analysis of MATLAB code based on changed scripts (e.g., from git diff). Given changed .m files, returns upstream paths from project roots to each changed script and downstream paths from each changed script to leaves.",
                "inputSchema": self._normalize_schema({
                    "type": "object",
                    "properties": {
                        "changed_scripts": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "List of changed MATLAB scripts (relative to project_path)."
                        },
                        "project_path": {
                            "type": "string",
                            "description": "MATLAB project root (optional; defaults to process cwd)."
                        },
                        "entry_roots": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Optional explicit entry root scripts. If omitted, roots are auto-detected (not called by others)."
                        }
                    },
                    "required": ["changed_scripts"],
                    "additionalProperties": False
                })
            }
        }

    def _normalize_schema(self, schema: Dict[str, Any]) -> Dict[str, Any]:
        """标准化schema，确保所有类型都使用小写格式"""
        if not schema or not isinstance(schema, dict):
            return schema
        
        normalized = schema.copy()
        
        # 转换类型为大写
        if 'type' in normalized and isinstance(normalized['type'], str):
            type_map = {
                'STRING': 'string',
                'NUMBER': 'number',
                'BOOLEAN': 'boolean', 
                'OBJECT': 'object',
                'ARRAY': 'array',
                'INTEGER': 'integer'
            }
            normalized['type'] = type_map.get(normalized['type'], normalized['type'])
        
        # 递归处理嵌套的schema
        if 'items' in normalized:
            normalized['items'] = self._normalize_schema(normalized['items'])
        
        if 'properties' in normalized and isinstance(normalized['properties'], dict):
            normalized_properties = {}
            for key, value in normalized['properties'].items():
                normalized_properties[key] = self._normalize_schema(value)
            normalized['properties'] = normalized_properties
        
        if 'anyOf' in normalized and isinstance(normalized['anyOf'], list):
            normalized['anyOf'] = [self._normalize_schema(item) for item in normalized['anyOf']]
        
        return normalized

    def _get_analyzer(self, project_path: str) -> RecursiveCallAnalyzer:
        """获取或创建项目分析器"""
        if project_path not in self.analyzers:
            self.analyzers[project_path] = RecursiveCallAnalyzer(project_path)
        return self.analyzers[project_path]

    async def handle_initialize(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """处理初始化请求"""
        self.logger.info("处理初始化请求")
        request_id = request.get('id')
        response = {
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {}, "experimental": {}},
            "serverInfo": {
                "name": "mcp-matlab-recursive-analyzer-server",
                "version": "1.0.0",
                "description": "MATLAB脚本递归调用链分析MCP工具"
            }
        }
        self.initialized = True
        return build_mcp_response(result=response, id_value=request_id, method_value="initialize")

    async def handle_tools_list(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """处理工具列表请求"""
        request_id = request.get('id')
        tools_list = []
        for tool_name, tool_def in self.tools.items():
            # 添加调试信息
            self.logger.info(f"注册工具: {tool_name}")
            self.logger.info(f"工具schema: {json.dumps(tool_def['inputSchema'], ensure_ascii=False, indent=2)}")
            
            tools_list.append({
                "name": tool_def["name"],
                "description": tool_def["description"],
                "inputSchema": tool_def["inputSchema"]
            })
        result = {"tools": tools_list}
        return build_mcp_response(result=result, id_value=request_id, method_value="tools/list")

    async def execute_matlab_recursive_analyze(self, **kwargs) -> str:
        """执行MATLAB递归调用链分析工具"""
        try:
            # project_path 可从参数或预设环境变量读取；entry_script、analysis_script 必须由调用方提供
            project_path = kwargs.get('project_path') or os.environ.get('DEFAULT_PROJECT_PATH') or os.getcwd()
            entry_script = kwargs.get('entry_script')
            analysis_script = kwargs.get('analysis_script')
            force_rescan = bool(kwargs.get('force_rescan', False))
            
            # 参数验证
            if not project_path or not entry_script or not analysis_script:
                raise ValueError("缺少必要参数: project_path, entry_script, analysis_script。请检查参数或环境变量设置。")
            
            # 验证项目路径
            if not Path(project_path).exists():
                raise ValueError(f"项目路径不存在: {project_path}")
            
            # 获取分析器
            analyzer = self._get_analyzer(project_path)
            if force_rescan:
                analyzer.reset()
            
            # 执行分析
            entry_to_analysis_path, analysis_to_leaves_paths = analyzer.analyze_specific_paths(entry_script, analysis_script)
            
            # 构建返回结果（将两个列表嵌套为包含 data 与 description 的字典）
            result = {
                "entry_to_analysis": {
                    "data": entry_to_analysis_path,
                    "description": "One shortest path from entry_script to analysis_script. Each element is a script path relative to project_path."
                },
                "analysis_to_leaves": {
                    "data": analysis_to_leaves_paths,
                    "description": "All paths from analysis_script to all reachable leaf scripts. Each path is a list of script paths relative to project_path, in call order."
                },
                "analysis_info": {
                    "project_path": project_path,
                    "entry_script": entry_script,
                    "analysis_script": analysis_script,
                    "entry_path_length": len(entry_to_analysis_path) if entry_to_analysis_path else 0,
                    "leaves_paths_count": len(analysis_to_leaves_paths)
                },
                "analysis_time": datetime.now().isoformat(),
                "input_parameters": kwargs
            }
            
            return json.dumps(result, ensure_ascii=False, indent=2)
        except Exception as e:
            self.logger.error(f"执行MATLAB递归调用链分析失败: {e}")
            error_result = {
                "error": str(e),
                "analysis_time": datetime.now().isoformat(),
                "input_parameters": kwargs
            }
            return json.dumps(error_result, ensure_ascii=False, indent=2)

    async def execute_matlab_project_overview(self, **kwargs) -> str:
        """执行MATLAB项目概览工具"""
        try:
            # 从参数中获取，如果没有则使用环境变量中的预设值
            project_path = kwargs.get('project_path') or os.environ.get('DEFAULT_PROJECT_PATH') or os.getcwd()
            
            # 参数验证
            if not project_path:
                raise ValueError("缺少必要参数: project_path。请检查参数或环境变量设置。")
            
            # 验证项目路径
            if not Path(project_path).exists():
                raise ValueError(f"项目路径不存在: {project_path}")
            
            # 获取分析器
            analyzer = self._get_analyzer(project_path)
            
            # 执行概览分析（使用一个临时入口脚本）
            # 这里我们使用项目中的第一个.m文件作为入口
            matlab_files = list(Path(project_path).rglob("*.m"))
            if not matlab_files:
                raise ValueError(f"项目路径中没有找到.m文件: {project_path}")
            
            # 使用第一个.m文件作为入口进行概览分析
            entry_script = matlab_files[0].relative_to(Path(project_path)).as_posix()
            overview_report = analyzer.analyze_recursive_calls(entry_script)
            
            # 构建概览结果
            overview = {
                "total_scripts": overview_report.get('total_scripts', 0),
                "call_graph_size": len(overview_report.get('call_graph', {})),
                "max_recursion_depth": max(overview_report.get('recursion_depth', {}).values()) if overview_report.get('recursion_depth') else 0,
                "total_visits": sum(overview_report.get('visited_count', {}).values()),
                "project_path": project_path,
                "entry_script_used": entry_script
            }
            
            # 构建返回结果
            result = {
                "overview": overview,
                "analysis_time": datetime.now().isoformat(),
                "input_parameters": kwargs
            }
            
            result_json = json.dumps(result, ensure_ascii=False, indent=2)
            
            # 保存结果到文件（可选）
            try:
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                filename = f"matlab_project_overview_{timestamp}.json"
                # 将结果保存到当前工程根目录下
                project_root = os.path.abspath(os.path.join(CURRENT_DIR, "..", "..", ".."))
                filepath = os.path.join(project_root, filename)
                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(result_json)
                self.logger.info(f"概览结果已保存到: {filepath}")
                
                # 在返回结果中添加文件保存信息
                result_with_file_info = {
                    "overview": overview,
                    "analysis_time": datetime.now().isoformat(),
                    "input_parameters": kwargs,
                    "file_saved": {
                        "path": filepath,
                        "filename": filename,
                        "timestamp": timestamp
                    }
                }
                
                return json.dumps(result_with_file_info, ensure_ascii=False, indent=2)
                
            except Exception as e:
                self.logger.error(f"保存概览结果到文件时出错: {e}")
                # 即使保存失败，也返回原始结果
                return result_json
                
        except Exception as e:
            self.logger.error(f"执行MATLAB项目概览失败: {e}")
            error_result = {
                "error": str(e),
                "analysis_time": datetime.now().isoformat(),
                "input_parameters": kwargs
            }
            return json.dumps(error_result, ensure_ascii=False, indent=2)

    async def execute_matlab_impact_from_git_diff(self, **kwargs) -> str:
        """执行基于变更脚本的影响分析工具"""
        try:
            changed_scripts: List[str] = kwargs.get('changed_scripts') or []
            project_path = kwargs.get('project_path') or os.environ.get('DEFAULT_PROJECT_PATH') or os.getcwd()
            entry_roots: Optional[List[str]] = kwargs.get('entry_roots')
            force_rescan = bool(kwargs.get('force_rescan', False))

            if not changed_scripts:
                raise ValueError("缺少必要参数: changed_scripts")
            if not Path(project_path).exists():
                raise ValueError(f"项目路径不存在: {project_path}")

            analyzer = self._get_analyzer(project_path)
            if force_rescan:
                analyzer.reset()
            impact = analyzer.analyze_impact_for_changes(changed_scripts, entry_roots=entry_roots)

            result = {
                "impact": impact,
                "analysis_time": datetime.now().isoformat(),
                "input_parameters": kwargs,
                "project_path": project_path,
            }
            return json.dumps(result, ensure_ascii=False, indent=2)
        except Exception as e:
            self.logger.error(f"执行影响分析失败: {e}")
            error_result = {"error": str(e), "input_parameters": kwargs}
            return json.dumps(error_result, ensure_ascii=False, indent=2)

    async def handle_tools_call(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """处理工具调用请求"""
        request_id = request.get('id')
        params = request.get('params', {})
        tool_name = params.get('name')
        arguments = params.get('arguments', {})
        
        try:
            if tool_name == 'matlab_recursive_analyze':
                result_text = await self.execute_matlab_recursive_analyze(**arguments)
            elif tool_name == 'matlab_project_overview':
                result_text = await self.execute_matlab_project_overview(**arguments)
            elif tool_name == 'matlab_impact_from_git_diff':
                result_text = await self.execute_matlab_impact_from_git_diff(**arguments)
            else:
                result_text = f"错误: 未知工具 '{tool_name}'"
            
            result = {
                "content": [{"type": "text", "text": result_text}],
                "isError": False
            }
            return build_mcp_response(result=result, id_value=request_id, method_value="tools/call")
            
        except Exception as e:
            error = {"code": -32001, "message": f"工具执行错误: {str(e)}"}
            return build_mcp_response(id_value=request_id, method_value="tools/call", error=error)

    async def handle_initialized(self, request: Dict[str, Any]) -> None:
        """处理初始化完成通知"""
        self.logger.info("处理初始化完成通知 (notifications/initialized)")
        # 通知不返回响应

    async def handle_request(self, request: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """处理MCP请求"""
        method = request.get('method', '')
        request_id = request.get('id')
        if request_id is None:
            request_id = 1
        
        self.logger.info(f"处理请求: {method}")
        
        try:
            # 初始化请求
            if method == 'initialize':
                return await self.handle_initialize({**request, 'id': request_id})
            
            # 检查是否已初始化
            if not self.initialized and method != 'initialize':
                error = {"code": -32002, "message": "Server not initialized"}
                return build_mcp_response(id_value=request_id, method_value=method, error=error)
            
            # 处理初始化完成通知
            if method == 'notifications/initialized':
                await self.handle_initialized(request)
                return None  # 通知不返回响应
            
            # 工具列表
            if method == 'tools/list':
                return await self.handle_tools_list({**request, 'id': request_id})
            
            # 工具调用
            elif method == 'tools/call':
                return await self.handle_tools_call({**request, 'id': request_id})
            
            # 未知方法
            else:
                error = {"code": -32601, "message": f"Method not found: {method}"}
                return build_mcp_response(id_value=request_id, method_value=method, error=error)
                
        except Exception as e:
            self.logger.error(f"处理请求时出错: {e}")
            error = {"code": -32603, "message": f"Internal error: {str(e)}"}
            return build_mcp_response(id_value=request_id, method_value=method, error=error)

    async def run_server(self, input_stream=None, output_stream=None):
        """运行MCP服务器"""
        if input_stream is None:
            input_stream = sys.stdin
        if output_stream is None:
            output_stream = sys.stdout
        
        self.logger.info("启动MCP MATLAB Recursive Analyzer工具服务器")
        
        while True:
            try:
                line = await asyncio.get_event_loop().run_in_executor(None, input_stream.readline)
                if not line:
                    break
                
                request = json.loads(line.strip())
                response = await self.handle_request(request)
                
                if response is not None:
                    response_line = json.dumps(response) + '\n'
                    await asyncio.get_event_loop().run_in_executor(None, output_stream.write, response_line)
                    await asyncio.get_event_loop().run_in_executor(None, output_stream.flush)
                    
            except json.JSONDecodeError as e:
                self.logger.error(f"JSON解析错误: {e}")
                error_response = build_mcp_response(id_value=None, method_value="", error={"code": -32700, "message": "Parse error"})
                error_line = json.dumps(error_response) + '\n'
                await asyncio.get_event_loop().run_in_executor(None, output_stream.write, error_line)
                await asyncio.get_event_loop().run_in_executor(None, output_stream.flush)
                
            except Exception as e:
                self.logger.error(f"服务器错误: {e}")
                break

async def main():
    """主入口点"""
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        stream=sys.stderr
    )
    
    server = MCPRecursiveAnalyzerServer()
    await server.run_server()

if __name__ == "__main__":
    asyncio.run(main()) 