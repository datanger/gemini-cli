#!/usr/bin/env python3
"""
改进的MATLAB脚本解析器
按照MATLAB实际搜索路径规则，支持函数多关联，去除评分机制
严格按照MATLAB语法规则建立稳定的函数关联关系
"""

import os
import re
import logging
from pathlib import Path
from typing import Dict, List, Set, Tuple, Optional
import traceback

# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


class ImprovedMATLABScriptParser:
    """改进的MATLAB脚本解析器 - 按MATLAB实际搜索路径规则"""
    
    def __init__(self, project_path: str):
        """
        初始化解析器
        
        Args:
            project_path: MATLAB工程根目录路径
        """
        self.project_path = Path(project_path)
        self.script_functions: Dict[str, Set[str]] = {}  # 脚本文件 -> 函数名集合
        self.function_scripts: Dict[str, List[str]] = {}  # 函数名 -> 脚本文件列表（支持多关联）
        self.script_calls: Dict[str, Set[str]] = {}  # 脚本文件 -> 调用的函数集合
        self.script_files: Set[str] = set()  # 所有脚本文件集合
        
        # MATLAB路径分析
        self.matlab_paths: List[str] = []  # MATLAB搜索路径
        self.script_creation_order: Dict[str, int] = {}  # 脚本创建顺序（模拟MATLAB路径顺序）
        
        # 函数定义详情
        self.function_definitions: Dict[str, Dict[str, Dict]] = {}  # 函数名 -> {脚本文件 -> 定义详情}
        
    def scan_project(self) -> Dict[str, Set[str]]:
        """
        扫描整个工程，解析所有MATLAB脚本文件
        
        Returns:
            脚本文件到函数名的映射字典
        """
        logger.info(f"开始扫描工程: {self.project_path}")
        
        # 查找所有.m文件
        matlab_files = list(self.project_path.rglob("*.m"))
        logger.info(f"发现 {len(matlab_files)} 个MATLAB脚本文件")
        
        # 清空之前的结果
        self.script_functions.clear()
        self.function_scripts.clear()
        self.script_calls.clear()
        self.script_files.clear()
        self.function_definitions.clear()
        
        # 第一遍：收集所有脚本文件，按文件系统顺序
        file_list = []
        for file_path in matlab_files:
            try:
                relative_path = file_path.relative_to(self.project_path)
                script_name = str(relative_path)
                file_list.append(script_name)
            except Exception as e:
                logger.error(f"处理文件路径 {file_path} 时出错: {e}")
        
        # 按文件系统顺序排序，模拟MATLAB路径添加顺序
        file_list.sort()
        for i, file_path in enumerate(file_list):
            self.script_files.add(file_path)
            self.script_creation_order[file_path] = i
        
        # 第二遍：解析每个文件
        for file_path in matlab_files:
            try:
                self._parse_script_file(file_path)
            except Exception as e:
                logger.error(f"解析文件 {file_path} 时出错: {e}")
                logger.error(f"错误详情: {traceback.format_exc()}")
                # 即使出错，也要尝试添加基本信息
                self._add_fallback_info(file_path)
        
        # 第三遍：强制映射所有脚本文件名
        self._force_map_all_script_names()
        
        # 第四遍：建立MATLAB搜索路径（按正确规则）
        self._build_matlab_paths_correctly()
        
        # 第五遍：建立基于MATLAB语法的关联关系
        self._establish_matlab_syntax_relationships()
        
        logger.info(f"解析完成，共处理 {len(self.script_functions)} 个脚本文件")
        return self.script_functions
    
    def _build_matlab_paths_correctly(self) -> None:
        """按照MATLAB正确规则建立搜索路径"""
        logger.info("按照MATLAB正确规则建立搜索路径...")
        
        # MATLAB搜索路径的正确规则：
        # 1. 当前工作目录 (pwd) - 最高优先级
        # 2. 按文件系统顺序添加的路径 - 按添加顺序
        # 3. 不是按目录层级排序！
        
        paths = []
        
        # 1. 添加当前工作目录（最高优先级）
        paths.append(str(self.project_path))
        
        # 2. 按文件系统顺序添加所有脚本文件所在目录
        # 这模拟了MATLAB中addpath()的顺序
        for script_file in sorted(self.script_files, key=lambda x: self.script_creation_order[x]):
            script_path = Path(script_file)
            script_dir = str(self.project_path / script_path.parent)
            if script_dir not in paths:
                paths.append(script_dir)
        
        self.matlab_paths = paths
        
        logger.info(f"建立 {len(self.matlab_paths)} 个搜索路径，按MATLAB正确规则排序")
        for i, path in enumerate(paths):
            logger.debug(f"  路径 {i}: {path}")
    
    def _establish_matlab_syntax_relationships(self) -> None:
        """基于MATLAB语法规则建立关联关系"""
        logger.info("基于MATLAB语法规则建立关联关系...")
        
        # 为每个函数确定主要定义，基于正确的MATLAB语法规则
        for func_name, scripts in self.function_scripts.items():
            if len(scripts) > 1:
                # 多个定义，需要确定主要定义
                primary_script = self._determine_primary_by_matlab_rules(func_name, scripts)
                
                # 重新排序，主要定义放在前面
                if primary_script in scripts:
                    scripts.remove(primary_script)
                    scripts.insert(0, primary_script)
                    logger.info(f"函数 {func_name} 有 {len(scripts)} 个定义，主定义: {primary_script}")
                else:
                    logger.warning(f"函数 {func_name} 的主定义 {primary_script} 不在脚本列表中")
        
        logger.info("MATLAB语法规则关联关系建立完成")
    
    def _determine_primary_by_matlab_rules(self, func_name: str, scripts: List[str]) -> str:
        """基于正确的MATLAB语法规则确定主要定义"""
        # MATLAB的正确语法规则：
        # 1. 脚本内部定义的函数 > 外部函数（最高优先级！）
        # 2. 显式函数定义 > 脚本文件
        # 3. 按MATLAB路径顺序（不是目录层级！）
        # 4. 当前工作目录优先
        
        # 第一步：按定义类型分组
        explicit_functions = []
        script_files = []
        
        for script in scripts:
            if func_name in self.function_definitions and script in self.function_definitions[func_name]:
                func_info = self.function_definitions[func_name][script]
                if func_info['definition_type'] == 'explicit_function':
                    explicit_functions.append(script)
                elif func_info['definition_type'] == 'script_file':
                    script_files.append(script)
        
        # 第二步：优先选择显式函数定义
        if explicit_functions:
            # 在显式函数定义中，按MATLAB路径规则选择
            return self._select_by_matlab_path_rules(explicit_functions)
        else:
            # 只有脚本文件定义，按MATLAB路径规则选择
            return self._select_by_matlab_path_rules(script_files)
    
    def _select_by_matlab_path_rules(self, scripts: List[str]) -> str:
        """基于MATLAB路径规则选择脚本"""
        if not scripts:
            return scripts[0] if scripts else ""
        
        # MATLAB路径规则（正确版本）：
        # 1. 当前工作目录优先
        # 2. 按MATLAB路径添加顺序
        # 3. 不是按目录层级！
        
        def get_matlab_path_priority(script: str) -> Tuple[int, int, str]:
            # 检查是否在当前工作目录
            script_path = Path(script)
            is_in_current_dir = len(script_path.parts) == 1
            
            # 获取在MATLAB路径中的位置
            # 模拟MATLAB的addpath顺序
            path_position = 999999  # 默认位置
            for i, path in enumerate(self.matlab_paths):
                if str(self.project_path / script_path.parent) == path:
                    path_position = i
                    break
            
            # 返回 (是否当前目录, 路径位置, 脚本名)
            # 当前目录优先，然后按路径位置排序
            return (0 if is_in_current_dir else 1, path_position, script)
        
        # 按MATLAB路径规则排序
        sorted_scripts = sorted(scripts, key=get_matlab_path_priority)
        return sorted_scripts[0]
    
    def _force_map_all_script_names(self) -> None:
        """强制将每个脚本文件名作为函数名与脚本进行映射（支持多关联）"""
        logger.info("开始强制映射所有脚本文件名...")
        
        for script_name in self.script_files:
            # 从脚本名中提取函数名（去掉.m扩展名）
            func_name = Path(script_name).stem
            
            # 如果这个函数名还没有映射，则创建新的列表
            if func_name not in self.function_scripts:
                self.function_scripts[func_name] = [script_name]
                logger.debug(f"强制映射: {func_name} -> {script_name}")
                
                # 同时确保脚本函数集合中包含这个函数名
                if script_name not in self.script_functions:
                    self.script_functions[script_name] = set()
                self.script_functions[script_name].add(func_name)
                
                # 如果没有通过_extract_functions_with_details识别，则添加脚本文件定义
                if func_name not in self.function_definitions:
                    self.function_definitions[func_name] = {}
                if script_name not in self.function_definitions[func_name]:
                    self.function_definitions[func_name][script_name] = {
                        'script_file': script_name,
                        'line_number': 1,
                        'line_content': f"# Script file: {func_name}",
                        'definition_type': 'script_file',
                        'function_signature': func_name,
                        'is_script_file': True
                    }
            else:
                # 如果已经有映射，添加到列表中（支持多关联）
                if script_name not in self.function_scripts[func_name]:
                    self.function_scripts[func_name].append(script_name)
                    logger.debug(f"添加额外映射: {func_name} -> {script_name}")
                    
                    # 同时确保脚本函数集合中包含这个函数名
                    if script_name not in self.script_functions:
                        self.script_functions[script_name] = set()
                    self.script_functions[script_name].add(func_name)
                    
                    # 如果没有通过_extract_functions_with_details识别，则添加脚本文件定义
                    if func_name not in self.function_definitions:
                        self.function_definitions[func_name] = {}
                    if script_name not in self.function_definitions[func_name]:
                        self.function_definitions[func_name][script_name] = {
                            'script_file': script_name,
                            'line_number': 1,
                            'line_content': f"# Script file: {func_name}",
                            'definition_type': 'script_file',
                            'function_signature': func_name,
                            'is_script_file': True
                        }
        
        logger.info(f"强制映射完成，共映射 {len(self.function_scripts)} 个函数名")
    
    def _add_fallback_info(self, file_path: Path) -> None:
        """当文件解析失败时，添加基本信息"""
        try:
            relative_path = file_path.relative_to(self.project_path)
            script_name = str(relative_path)
            
            # 如果还没有添加过，则添加基本信息
            if script_name not in self.script_functions:
                # 将文件名作为函数名（去掉.m扩展名）
                func_name = file_path.stem
                self.script_functions[script_name] = {func_name}
                
                # 支持多关联
                if func_name not in self.function_scripts:
                    self.function_scripts[func_name] = [script_name]
                else:
                    if script_name not in self.function_scripts[func_name]:
                        self.function_scripts[func_name].append(script_name)
                
                self.script_calls[script_name] = set()
                logger.info(f"为解析失败的文件 {script_name} 添加了基本信息")
        except Exception as e:
            logger.error(f"添加fallback信息时出错: {e}")
    
    def _parse_script_file(self, file_path: Path) -> None:
        """
        解析单个MATLAB脚本文件
        
        Args:
            file_path: 脚本文件路径
        """
        relative_path = file_path.relative_to(self.project_path)
        script_name = str(relative_path)
        
        try:
            # 读取文件内容
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
        except Exception as e:
            logger.error(f"读取文件 {file_path} 失败: {e}")
            # 尝试其他编码
            try:
                with open(file_path, 'r', encoding='latin-1', errors='ignore') as f:
                    content = f.read()
            except Exception as e2:
                logger.error(f"使用latin-1编码读取文件 {file_path} 也失败: {e2}")
                content = ""
        
        # 提取函数定义
        functions = self._extract_functions_with_details(content, script_name)
        
        # 提取函数调用
        calls = self._extract_function_calls(content)
        
        # 如果没有找到函数定义，但文件内容不为空，则将文件名作为函数名
        # 这是为了处理脚本文件（没有function定义的文件）
        if not functions and content.strip():
            # 从文件名中提取函数名（去掉.m扩展名）
            func_name = file_path.stem
            functions[func_name] = {
                'script_file': script_name,
                'line_number': 1,
                'line_content': f"# Script file: {func_name}",
                'definition_type': 'script_file',
                'function_signature': func_name,
                'is_script_file': True
            }
            logger.debug(f"脚本文件 {script_name} 没有函数定义，使用文件名作为函数名: {func_name}")
        
        # 存储结果
        self.script_functions[script_name] = set(functions.keys())
        self.script_calls[script_name] = calls
        
        # 更新函数到脚本的映射（支持多关联）
        for func_name, func_info in functions.items():
            if func_name not in self.function_scripts:
                self.function_scripts[func_name] = []
            
            if script_name not in self.function_scripts[func_name]:
                self.function_scripts[func_name].append(script_name)
            
            # 存储函数定义详情
            if func_name not in self.function_definitions:
                self.function_definitions[func_name] = {}
            self.function_definitions[func_name][script_name] = func_info
        
        logger.debug(f"解析 {script_name}: 定义函数 {len(functions)} 个, 调用函数 {len(calls)} 个")
    
    def _extract_functions_with_details(self, content: str, script_name: str) -> Dict[str, Dict]:
        """
        从脚本内容中提取函数定义，包含详细信息
        
        Args:
            content: 脚本内容
            script_name: 脚本文件名
            
        Returns:
            函数名到定义详情的映射
        """
        functions = {}
        lines = content.split('\n')
        
        try:
            # 统一用一个稳健的正则：
            # 支持以下形式：
            #   function [out1,out2] = name(args)
            #   function out = name(args)
            #   function name(args)
            #   function name
            #   function [outs] = name
            pattern = re.compile(r'^\s*function\s+(?:\[[^\]]*\]|\w+)\s*=\s*(?P<name>\w+)(?:\s*\([^)]*\))?\s*$|^\s*function\s+(?P<name2>\w+)(?:\s*\([^)]*\))?\s*$', re.IGNORECASE | re.MULTILINE)
            
            for line_num, line in enumerate(lines, 1):
                m = pattern.match(line)
                if m:
                    func_name = m.group('name') or m.group('name2')
                    if func_name and func_name.lower() not in {'function', 'end'}:
                        functions[func_name] = {
                            'script_file': script_name,
                            'line_number': line_num,
                            'line_content': line.strip(),
                            'definition_type': 'explicit_function',
                            'function_signature': line.strip(),
                            'is_script_file': False
                        }
        except Exception as e:
            logger.error(f"提取函数定义时出错: {e}")
        
        return functions
    
    def _extract_functions(self, content: str) -> Set[str]:
        """
        从脚本内容中提取函数定义（兼容性方法）
        
        Args:
            content: 脚本内容
            
        Returns:
            函数名集合
        """
        functions = self._extract_functions_with_details(content, "unknown")
        return set(functions.keys())
    
    def _extract_function_calls(self, content: str) -> Set[str]:
        """
        从脚本内容中提取函数调用
        
        Args:
            content: 脚本内容
            
        Returns:
            调用的函数名集合
        """
        calls = set()
        
        try:
            # 先移除注释，避免将注释中的文本当作函数调用
            lines = content.split('\n')
            code_lines = []
            for line in lines:
                # 移除行注释
                if '%' in line:
                    line = line[:line.index('%')]
                code_lines.append(line)
            
            clean_content = '\n'.join(code_lines)
            
            # 收集被赋值的变量名，便于区分索引访问与函数调用
            assigned_vars: Set[str] = set()
            assign_pattern = re.compile(r'^\s*([A-Za-z]\w*)\s*=')
            for line in code_lines:
                m = assign_pattern.match(line)
                if m:
                    assigned_vars.add(m.group(1))
            
            # 排除MATLAB关键字和内置函数（扩展）
            matlab_keywords = {
                'if', 'else', 'elseif', 'end', 'for', 'while', 'switch', 'case', 'otherwise',
                'try', 'catch', 'function', 'return', 'break', 'continue', 'global', 'persistent',
                'clear', 'clc', 'close', 'figure', 'plot', 'subplot', 'title', 'xlabel', 'ylabel',
                'legend', 'grid', 'hold', 'axis', 'xlim', 'ylim', 'text', 'annotation', 'gcf',
                'fprintf', 'mean', 'isnumeric', 'isempty', 'on', 'off', 'length', 'size',
                'exist', 'mkdir', 'fullfile', 'char', 'string', 'regexp', 'bitset', 'bitget',
                'double', 'abs', 'vertcat', 'find', 'sort', 'unique', 'eval', 'saveas', 'imwrite',
                'getframe', 'set', 'get', 'xline', 'yline', 'yticks', 'zeros', 'ones', 'horzcat',
                'vertcat', 'cellfun', 'strcat', 'strrep', 'strsplit', 'regexprep', 'replace',
                'contains', 'strcmp', 'strfind', 'sprintf', 'num2str', 'str2double', 'round',
                'ceil', 'floor', 'min', 'max', 'sum', 'mod', 'bitget', 'bitset', 'actxserver',
                'VideoReader', 'readFrame', 'image', 'copyfile', 'delete', 'mkdir', 'rmdir',
                'movefile', 'load', 'save', 'xlsread', 'xlswrite', 'uigetdir', 'uigetfile',
                'input', 'disp', 'fprintf', 'warning', 'error', 'pause', 'tic', 'toc'
            }
            
            # 规则1：行首的函数调用（可能有括号）
            pattern_line_start = re.compile(r'^\s*([A-Za-z]\w*)\s*\(.*\)\s*;?\s*$')
            # 规则2：赋值右侧的函数调用
            pattern_rhs_call = re.compile(r'=\s*([A-Za-z]\w*)\s*\(')
            # 规则3：行首的无括号调用，以分号结尾
            pattern_bare_call = re.compile(r'^\s*([A-Za-z]\w*)\s*;\s*$')
            # 规则4：行首的无括号调用，不以分号结尾（脚本文件常见）
            pattern_bare_call_no_semicolon = re.compile(r'^\s*([A-Za-z]\w*)\s*$')
            
            for line in code_lines:
                stripped = line.strip()
                if not stripped:
                    continue
                # 忽略以点号开始的成员/字段访问行
                if stripped.startswith('.'):
                    continue
                
                # 行首调用
                m = pattern_line_start.match(line)
                if m:
                    name = m.group(1)
                    if name not in matlab_keywords and name not in assigned_vars and len(name) > 1:
                        calls.add(name)
                    continue
                
                # 赋值右侧调用
                for m in pattern_rhs_call.finditer(line):
                    name = m.group(1)
                    if name not in matlab_keywords and name not in assigned_vars and len(name) > 1:
                        calls.add(name)
                
                # 无括号调用（整行仅为名称;）
                m = pattern_bare_call.match(line)
                if m:
                    name = m.group(1)
                    if name not in matlab_keywords and len(name) > 1:
                        calls.add(name)
                
                # 无括号调用（整行仅为名称，不以分号结尾）
                m = pattern_bare_call_no_semicolon.match(line)
                if m:
                    name = m.group(1)
                    if name not in matlab_keywords and len(name) > 1:
                        calls.add(name)
            
            # 过滤掉MATLAB关键字和内置函数
            calls = {call for call in calls if call not in matlab_keywords}
            
        except Exception as e:
            logger.error(f"提取函数调用时出错: {e}")
        
        return calls
    
    def get_function_definition(self, func_name: str, calling_script: str = None) -> Dict:
        """获取函数定义信息（支持多关联）"""
        if func_name not in self.function_scripts:
            return {
                'function_name': func_name,
                'found': False,
                'message': f"函数 {func_name} 未找到定义"
            }
        
        scripts = self.function_scripts[func_name]
        primary_script = scripts[0] if scripts else None
        
        # 基于调用上下文提供建议
        recommended_script = None
        if calling_script and len(scripts) > 1:
            recommended_script = self._get_context_based_recommendation(func_name, calling_script, scripts)
        
        result = {
            'function_name': func_name,
            'found': True,
            'total_definitions': len(scripts),
            'primary_script': primary_script,
            'recommended_script': recommended_script,
            'all_scripts': scripts,
            'definitions': {}
        }
        
        # 添加每个定义的详细信息
        for script in scripts:
            if func_name in self.function_definitions and script in self.function_definitions[func_name]:
                result['definitions'][script] = self.function_definitions[func_name][script]
        
        return result
    
    def get_function_definition_for_script(self, func_name: str, calling_script: str) -> Dict:
        """
        获取函数定义信息，优先考虑调用脚本内部的定义
        
        Args:
            func_name: 函数名
            calling_script: 调用脚本名
            
        Returns:
            函数定义信息
        """
        if func_name not in self.function_scripts:
            return {
                'function_name': func_name,
                'found': False,
                'message': f"函数 {func_name} 未找到定义"
            }
        
        scripts = self.function_scripts[func_name]
        
        # 优先选择调用脚本内部的函数定义
        if calling_script in scripts:
            # 检查是否是显式函数定义
            if (func_name in self.function_definitions and 
                calling_script in self.function_definitions[func_name] and
                self.function_definitions[func_name][calling_script]['definition_type'] == 'explicit_function'):
                
                # 返回调用脚本内部的函数定义
                script_details = self.function_definitions[func_name][calling_script]
                return {
                    'function_name': func_name,
                    'found': True,
                    'total_definitions': len(scripts),
                    'primary_script': calling_script,  # 优先使用内部定义
                    'recommended_script': calling_script,
                    'all_scripts': scripts,
                    'definitions': {calling_script: script_details},
                    'is_internal_definition': True,
                    'message': f"使用 {calling_script} 内部的函数定义"
                }
        
        # 如果没有内部定义，使用原来的逻辑
        return self.get_function_definition(func_name, calling_script)
    
    def _get_context_based_recommendation(self, func_name: str, calling_script: str, available_scripts: List[str]) -> Optional[str]:
        """基于调用上下文提供建议"""
        calling_path = Path(calling_script)
        
        # 基于MATLAB路径位置选择，不是基于路径相似性
        best_match = None
        best_path_position = 999999
        
        for script in available_scripts:
            script_path = Path(script)
            
            # 基于MATLAB路径位置选择
            for i, path in enumerate(self.matlab_paths):
                if str(self.project_path / script_path.parent) == path:
                    if i < best_path_position:
                        best_path_position = i
                        best_match = script
                    break
        
        return best_match
    
    def get_script_functions(self) -> Dict[str, Set[str]]:
        """获取脚本到函数的映射"""
        return self.script_functions
    
    def get_function_scripts(self) -> Dict[str, List[str]]:
        """获取函数到脚本的映射（支持多关联）"""
        return self.function_scripts
    
    def get_script_calls(self) -> Dict[str, Set[str]]:
        """获取脚本调用的函数"""
        return self.script_calls
    
    def get_all_script_files(self) -> Set[str]:
        """获取所有脚本文件集合"""
        return self.script_files
    
    def get_matlab_paths(self) -> List[str]:
        """获取MATLAB搜索路径"""
        return self.matlab_paths
    
    def print_summary(self) -> None:
        """打印解析结果摘要"""
        print("\n=== 改进的MATLAB脚本解析结果摘要（按MATLAB实际搜索路径规则）===")
        print(f"工程路径: {self.project_path}")
        print(f"脚本文件数量: {len(self.script_functions)}")
        print(f"函数定义数量: {len(self.function_scripts)}")
        print(f"总脚本文件数量: {len(self.script_files)}")
        
        print(f"\nMATLAB搜索路径 ({len(self.matlab_paths)} 个):")
        for i, path in enumerate(self.matlab_paths):
            print(f"  路径 {i}: {path}")
        
        print("\n脚本文件及其定义的函数:")
        for script, functions in self.script_functions.items():
            if functions:
                print(f"  {script}: {', '.join(sorted(functions))}")
            else:
                print(f"  {script}: (无函数定义)")
        
        print("\n函数定义位置（支持多关联）:")
        for func, scripts in sorted(self.function_scripts.items()):
            if len(scripts) > 1:
                print(f"  {func} -> {scripts[0]} (主定义) + {len(scripts)-1} 个额外定义")
            else:
                print(f"  {func} -> {scripts[0]}")
        
        print("\n脚本调用关系:")
        for script, calls in self.script_calls.items():
            if calls:
                print(f"  {script}: {', '.join(sorted(calls))}")
        
        # 检查是否有未映射的脚本文件
        unmapped_scripts = self.script_files - set(self.script_functions.keys())
        if unmapped_scripts:
            print(f"\n未映射的脚本文件 ({len(unmapped_scripts)} 个):")
            for script in sorted(unmapped_scripts):
                print(f"  {script}")
        
        # 显示多定义函数
        multi_def_functions = {func: scripts for func, scripts in self.function_scripts.items() if len(scripts) > 1}
        if multi_def_functions:
            print(f"\n多定义函数 ({len(multi_def_functions)} 个):")
            for func, scripts in sorted(multi_def_functions.items()):
                print(f"  {func}:")
                for i, script in enumerate(scripts):
                    marker = " (主定义)" if i == 0 else ""
                    print(f"    {i+1}. {script}{marker}")


def main():
    """主函数，用于测试"""
    import sys
    
    if len(sys.argv) != 2:
        print("用法: python script_parser_improved.py <MATLAB工程路径>")
        sys.exit(1)
    
    project_path = sys.argv[1]
    
    try:
        parser = ImprovedMATLABScriptParser(project_path)
        script_functions = parser.scan_project()
        parser.print_summary()
        
        # 测试多关联功能
        print("\n=== 测试多关联功能 ===")
        multi_def_functions = {func: scripts for func, scripts in parser.get_function_scripts().items() if len(scripts) > 1}
        if multi_def_functions:
            test_func = list(multi_def_functions.keys())[0]
            print(f"\n测试函数: {test_func}")
            func_info = parser.get_function_definition(test_func)
            print(f"  总定义数: {func_info['total_definitions']}")
            print(f"  主定义: {func_info['primary_script']}")
            print(f"  所有定义: {func_info['all_scripts']}")
            if func_info['definitions']:
                print("  定义详情:")
                for script, details in func_info['definitions'].items():
                    print(f"    {script}: 行{details['line_number']}, 类型: {details['definition_type']}")
        else:
            print("没有发现多定义函数")
            
    except Exception as e:
        print(f"解析过程中出现错误: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main() 