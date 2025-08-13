#!/usr/bin/env python3
"""
MATLAB脚本解析器
实现遍历工程内全部脚本，读取脚本并获取到脚本内定义的函数名，
将函数名与脚本进行关联的功能
"""

import os
import re
from pathlib import Path
from typing import Dict, List, Set, Tuple, Optional
import logging

# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


class MATLABScriptParser:
    """MATLAB脚本解析器"""
    
    def __init__(self, project_path: str):
        """
        初始化解析器
        
        Args:
            project_path: MATLAB工程根目录路径
        """
        self.project_path = Path(project_path)
        self.script_functions: Dict[str, Set[str]] = {}  # 脚本文件 -> 函数名集合
        self.function_scripts: Dict[str, str] = {}  # 函数名 -> 脚本文件
        self.script_calls: Dict[str, Set[str]] = {}  # 脚本文件 -> 调用的函数集合
        
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
        
        for file_path in matlab_files:
            try:
                self._parse_script_file(file_path)
            except Exception as e:
                logger.error(f"解析文件 {file_path} 时出错: {e}")
        
        logger.info(f"解析完成，共处理 {len(self.script_functions)} 个脚本文件")
        return self.script_functions
    
    def _parse_script_file(self, file_path: Path) -> None:
        """
        解析单个MATLAB脚本文件
        
        Args:
            file_path: 脚本文件路径
        """
        relative_path = file_path.relative_to(self.project_path)
        script_name = str(relative_path)
        
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
        except Exception as e:
            logger.error(f"读取文件 {file_path} 失败: {e}")
            return
        
        # 提取函数定义
        functions = self._extract_functions(content)
        
        # 提取函数调用
        calls = self._extract_function_calls(content)
        
        # 如果没有找到函数定义，但文件内容不为空，则将文件名作为函数名
        # 这是为了处理脚本文件（没有function定义的文件）
        if not functions and content.strip():
            # 从文件名中提取函数名（去掉.m扩展名）
            func_name = file_path.stem
            functions.add(func_name)
        
        # 存储结果
        self.script_functions[script_name] = functions
        self.script_calls[script_name] = calls
        
        # 更新函数到脚本的映射
        for func_name in functions:
            self.function_scripts[func_name] = script_name
        
        logger.debug(f"解析 {script_name}: 定义函数 {len(functions)} 个, 调用函数 {len(calls)} 个")
    
    def _extract_functions(self, content: str) -> Set[str]:
        """
        从脚本内容中提取函数定义
        
        Args:
            content: 脚本内容
            
        Returns:
            函数名集合
        """
        functions = set()
        
        # 统一用一个稳健的正则：
        # 支持以下形式：
        #   function [out1,out2] = name(args)
        #   function out = name(args)
        #   function name(args)
        #   function name
        #   function [outs] = name
        pattern = re.compile(r'^\s*function\s+(?:\[[^\]]*\]|\w+)\s*=\s*(?P<name>\w+)(?:\s*\([^)]*\))?\s*$|^\s*function\s+(?P<name2>\w+)(?:\s*\([^)]*\))?\s*$', re.IGNORECASE | re.MULTILINE)
        
        for m in pattern.finditer(content):
            func_name = m.group('name') or m.group('name2')
            if func_name and func_name.lower() not in {'function', 'end'}:
                functions.add(func_name)
        
        # 如果没有找到函数定义，但文件内容不为空，则将文件名作为函数名
        if not functions and content.strip():
            # 这里不添加函数名，因为文件名会在_parse_script_file中处理
            pass
        
        return functions
    
    def _extract_function_calls(self, content: str) -> Set[str]:
        """
        从脚本内容中提取函数调用
        
        Args:
            content: 脚本内容
            
        Returns:
            调用的函数名集合
        """
        calls = set()
        
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
            'getframe', 'set', 'get', 'xline', 'yline', 'yticks'
        }
        
        # 规则1：行首的函数调用（可能有括号）
        pattern_line_start = re.compile(r'^\s*([A-Za-z]\w*)\s*\(.*\)\s*;?\s*$')
        # 规则2：赋值右侧的函数调用
        pattern_rhs_call = re.compile(r'=\s*([A-Za-z]\w*)\s*\(')
        # 规则3：行首的无括号调用，以分号结尾
        pattern_bare_call = re.compile(r'^\s*([A-Za-z]\w*)\s*;\s*$')
        
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
        
        return calls
    
    def get_script_functions(self) -> Dict[str, Set[str]]:
        """获取脚本到函数的映射"""
        return self.script_functions
    
    def get_function_scripts(self) -> Dict[str, str]:
        """获取函数到脚本的映射"""
        return self.function_scripts
    
    def get_script_calls(self) -> Dict[str, Set[str]]:
        """获取脚本调用的函数"""
        return self.script_calls
    
    def print_summary(self) -> None:
        """打印解析结果摘要"""
        print("\n=== MATLAB脚本解析结果摘要 ===")
        print(f"工程路径: {self.project_path}")
        print(f"脚本文件数量: {len(self.script_functions)}")
        print(f"函数定义数量: {len(self.function_scripts)}")
        
        print("\n脚本文件及其定义的函数:")
        for script, functions in self.script_functions.items():
            if functions:
                print(f"  {script}: {', '.join(sorted(functions))}")
            else:
                print(f"  {script}: (无函数定义)")
        
        print("\n函数定义位置:")
        for func, script in sorted(self.function_scripts.items()):
            print(f"  {func} -> {script}")


def main():
    """主函数，用于测试"""
    import sys
    
    if len(sys.argv) != 2:
        print("用法: python script_parser.py <MATLAB工程路径>")
        sys.exit(1)
    
    project_path = sys.argv[1]
    
    if not os.path.exists(project_path):
        print(f"错误: 路径 {project_path} 不存在")
        sys.exit(1)
    
    # 创建解析器并扫描工程
    parser = MATLABScriptParser(project_path)
    parser.scan_project()
    
    # 打印结果摘要
    parser.print_summary()


if __name__ == "__main__":
    main() 