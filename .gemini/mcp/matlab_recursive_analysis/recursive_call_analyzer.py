#!/usr/bin/env python3
"""
递归调用链分析器
专门展示递归思想在调用链构建中的应用
"""

import json
import logging
from pathlib import Path
from typing import Dict, List, Set, Tuple, Optional
from collections import defaultdict
from script_parser import MATLABScriptParser

# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


class RecursiveCallAnalyzer:
    """递归调用链分析器"""
    
    def __init__(self, project_path: str):
        """
        初始化递归调用分析器
        
        Args:
            project_path: MATLAB工程根目录路径
        """
        self.project_path = Path(project_path)
        self.parser = MATLABScriptParser(project_path)
        self.script_functions: Dict[str, Set[str]] = {}
        self.function_scripts: Dict[str, str] = {}
        self.script_calls: Dict[str, Set[str]] = {}
        self.call_graph: Dict[str, Set[str]] = defaultdict(set)
        self.recursion_stack: List[str] = []  # 递归调用栈
        self.call_chains: Dict[str, List[str]] = {}
        self.recursion_depth: Dict[str, int] = {}  # 记录每个脚本的递归深度
        self.visited_count: Dict[str, int] = defaultdict(int)  # 记录访问次数
        
    def reset(self) -> None:
        """重置内部缓存（脚本函数、调用关系、图等），用于强制重建"""
        self.script_functions.clear()
        self.function_scripts.clear()
        self.script_calls.clear()
        self.call_graph.clear()
        self.recursion_stack.clear()
        self.call_chains.clear()
        self.recursion_depth.clear()
        self.visited_count.clear()
    
    def analyze_recursive_calls(self, entry_script: str) -> Dict:
        """
        使用递归方式分析调用链
        
        Args:
            entry_script: 入口脚本
            
        Returns:
            递归分析结果
        """
        logger.info(f"开始递归分析，入口脚本: {entry_script}")
        
        # 解析工程
        self._parse_project()
        
        # 验证入口脚本
        if entry_script not in self.script_functions:
            logger.error(f"入口脚本 {entry_script} 不存在")
            return {}
        
        # 构建调用关系图
        self._build_call_graph()
        
        # 初始化递归分析
        self.recursion_stack = []
        self.call_chains = {}
        self.recursion_depth = {}
        self.visited_count.clear()
        
        # 开始递归分析
        self._recursive_analyze(entry_script, [], 0)
        
        # 生成分析报告
        return self._generate_recursion_report(entry_script)
    
    def _parse_project(self) -> None:
        """解析整个工程"""
        logger.info("开始解析MATLAB工程...")
        self.script_functions = self.parser.scan_project()
        self.function_scripts = self.parser.get_function_scripts()
        self.script_calls = self.parser.get_script_calls()
        logger.info(f"解析完成，共 {len(self.script_functions)} 个脚本文件")
    
    def _build_call_graph(self) -> None:
        """构建调用关系图"""
        logger.info("构建调用关系图...")
        
        for script_name, calls in self.script_calls.items():
            for func_call in calls:
                if func_call in self.function_scripts:
                    called_script = self.function_scripts[func_call]
                    if called_script != script_name:
                        self.call_graph[script_name].add(called_script)
        
        logger.info(f"调用关系图构建完成，共 {len(self.call_graph)} 个脚本有调用关系")
    
    def _recursive_analyze(self, current_script: str, current_path: List[str], depth: int) -> None:
        """
        递归分析的核心方法
        
        Args:
            current_script: 当前脚本
            current_path: 当前路径
            depth: 当前递归深度
        """
        # 记录访问次数
        self.visited_count[current_script] += 1
        
        # 记录递归深度
        if current_script not in self.recursion_depth or depth > self.recursion_depth[current_script]:
            self.recursion_depth[current_script] = depth
        
        # 记录当前路径（包含当前脚本）
        full_path = current_path + [current_script]
        self.call_chains[current_script] = full_path
        
        # 将当前脚本加入递归栈
        self.recursion_stack.append(current_script)
        
        logger.info(f"递归深度 {depth}: 处理脚本 {current_script}")
        logger.info(f"当前路径: {' -> '.join(current_path)}")
        logger.info(f"递归栈: {' -> '.join(self.recursion_stack)}")
        
        # 获取当前脚本调用的其他脚本
        called_scripts = self.call_graph.get(current_script, set())
        
        # 递归处理每个被调用的脚本
        for called_script in called_scripts:
            if called_script not in current_path:
                # 正常递归调用
                new_path = current_path + [called_script]
                logger.info(f"递归调用: {current_script} -> {called_script} (深度: {depth + 1})")
                self._recursive_analyze(called_script, new_path, depth + 1)
            else:
                # 检测到循环调用
                logger.warning(f"检测到循环调用: {' -> '.join(current_path)} -> {called_script}")
                logger.warning(f"循环路径: {' -> '.join(current_path + [called_script])}")
        
        # 从递归栈中移除当前脚本
        self.recursion_stack.pop()
        logger.info(f"递归返回: {current_script} (深度: {depth})")
    
    def _generate_recursion_report(self, entry_script: str) -> Dict:
        """
        生成递归分析报告
        
        Args:
            entry_script: 入口脚本
            
        Returns:
            递归分析报告
        """
        report = {
            "entry_script": entry_script,
            "total_scripts": len(self.call_chains),
            "recursion_analysis": {},
            "call_chains": self.call_chains,
            "recursion_depth": self.recursion_depth,
            "visited_count": dict(self.visited_count),
            "call_graph": {k: list(v) for k, v in self.call_graph.items()}
        }
        
        # 分析每个脚本的递归情况
        for script, path in self.call_chains.items():
            depth = self.recursion_depth.get(script, 0)
            visit_count = self.visited_count.get(script, 0)
            
            report["recursion_analysis"][script] = {
                "path": path,
                "path_length": len(path),
                "max_depth": depth,
                "visit_count": visit_count,
                "is_leaf": len(self.call_graph.get(script, set())) == 0,
                "calls": list(self.call_graph.get(script, set()))
            }
        
        return report
    
    def print_recursion_analysis(self, entry_script: str, analysis_script: str = None) -> None:
        """
        打印递归分析结果
        
        Args:
            entry_script: 入口脚本
            analysis_script: 分析脚本（可选）
        """
        report = self.analyze_recursive_calls(entry_script)
        
        print(f"\n=== 递归调用链分析 (入口脚本: {entry_script}) ===")
        print(f"总脚本数量: {report['total_scripts']}")
        
        print(f"\n递归深度分析:")
        for script, analysis in report["recursion_analysis"].items():
            print(f"  {script}:")
            print(f"    路径: {' -> '.join(analysis['path'])}")
            print(f"    最大深度: {analysis['max_depth']}")
            print(f"    访问次数: {analysis['visit_count']}")
            print(f"    是否叶子节点: {analysis['is_leaf']}")
            if analysis['calls']:
                print(f"    调用脚本: {', '.join(analysis['calls'])}")
        
        print(f"\n调用关系图:")
        for script, calls in report["call_graph"].items():
            if calls:
                calls_str = ", ".join(calls)
                print(f"  {script} -> {calls_str}")
        
        # 统计信息
        max_depth = max(report["recursion_depth"].values()) if report["recursion_depth"] else 0
        total_visits = sum(report["visited_count"].values())
        
        print(f"\n统计信息:")
        print(f"  最大递归深度: {max_depth}")
        print(f"  总访问次数: {total_visits}")
        print(f"  平均访问次数: {total_visits / len(report['visited_count']) if report['visited_count'] else 0:.2f}")
        
        # 如果指定了分析脚本，输出特定路径分析
        if analysis_script:
            self._print_analysis_paths(entry_script, analysis_script, report)
    
    def _print_analysis_paths(self, entry_script: str, analysis_script: str, report: Dict) -> None:
        """
        打印分析脚本的特定路径信息（包括间接调用）
        
        Args:
            entry_script: 入口脚本
            analysis_script: 分析脚本
            report: 分析报告
        """
        print(f"\n=== 分析脚本路径分析（包括间接调用） ===")
        print(f"入口脚本: {entry_script}")
        print(f"分析脚本: {analysis_script}")
        
        # 1. 输出入口脚本到分析脚本的所有调用链
        entry_to_analysis_info = report.get("entry_to_analysis", {})
        all_paths = entry_to_analysis_info.get("all_paths", [])
        path_count = entry_to_analysis_info.get("path_count", 0)
        
        print(f"\n1. 入口脚本到分析脚本的调用链:")
        if all_paths:
            print(f"   找到 {path_count} 条路径:")
            for i, path in enumerate(all_paths, 1):
                path_str = " -> ".join(path)
                print(f"   路径 {i}: {path_str}")
                print(f"   路径长度: {len(path)}")
        else:
            print(f"   不存在调用链")
        
        # 2. 输出分析脚本到所有叶子节点的调用链
        analysis_to_leaves_paths = report.get("analysis_to_leaves", {}).get("paths", [])
        print(f"\n2. 分析脚本到叶子节点的调用链:")
        if analysis_to_leaves_paths:
            for i, path in enumerate(analysis_to_leaves_paths, 1):
                path_str = " -> ".join(path)
                print(f"   路径 {i}: {path_str}")
                print(f"   路径长度: {len(path)}")
        else:
            print(f"   分析脚本本身就是叶子节点，无后续调用链")
        
        # 3. 输出分析脚本的详细信息
        analysis_info = report.get("analysis_report", {}).get("recursion_analysis", {}).get(analysis_script)
        if analysis_info:
            print(f"\n3. 分析脚本详细信息:")
            print(f"   最大递归深度: {analysis_info['max_depth']}")
            print(f"   访问次数: {analysis_info['visit_count']}")
            print(f"   是否叶子节点: {analysis_info['is_leaf']}")
            if analysis_info['calls']:
                print(f"   直接调用脚本: {', '.join(analysis_info['calls'])}")
    
    def _find_all_paths_to_script(self, from_script: str, to_script: str) -> List[List[str]]:
        """
        查找从源脚本到目标脚本的所有可能路径（包括间接调用）
        
        Args:
            from_script: 源脚本
            to_script: 目标脚本
            
        Returns:
            所有可能路径的列表
        """
        if not self.call_chains:
            self.analyze_recursive_calls(from_script)
        
        # 使用深度优先搜索查找所有可能的路径
        def find_all_paths(start: str, target: str, visited: set = None, path: list = None) -> List[List[str]]:
            if visited is None:
                visited = set()
            if path is None:
                path = []
            
            current_path = path + [start]
            
            # 如果找到目标，返回当前路径
            if start == target:
                return [current_path]
            
            # 如果已经访问过，避免循环
            if start in visited:
                return []
            
            visited.add(start)
            all_paths = []
            
            # 查找当前脚本调用的所有脚本
            for called_script in self.call_graph.get(start, set()):
                sub_paths = find_all_paths(called_script, target, visited.copy(), current_path)
                all_paths.extend(sub_paths)
            
            return all_paths
        
        # 查找所有可能的路径
        all_paths = find_all_paths(from_script, to_script)
        
        # 按路径长度排序
        all_paths.sort(key=len)
        
        return all_paths

    def _find_path_to_script(self, from_script: str, to_script: str) -> Optional[List[str]]:
        """
        查找从源脚本到目标脚本的路径（包括间接调用）
        
        Args:
            from_script: 源脚本
            to_script: 目标脚本
            
        Returns:
            路径列表，如果不存在路径则返回None
        """
        if not self.call_chains:
            self.analyze_recursive_calls(from_script)
        
        # 使用深度优先搜索查找所有可能的路径
        def find_all_paths(start: str, target: str, visited: set = None, path: list = None) -> List[List[str]]:
            if visited is None:
                visited = set()
            if path is None:
                path = []
            
            current_path = path + [start]
            
            # 如果找到目标，返回当前路径
            if start == target:
                return [current_path]
            
            # 如果已经访问过，避免循环
            if start in visited:
                return []
            
            visited.add(start)
            all_paths = []
            
            # 查找当前脚本调用的所有脚本
            for called_script in self.call_graph.get(start, set()):
                sub_paths = find_all_paths(called_script, target, visited.copy(), current_path)
                all_paths.extend(sub_paths)
            
            return all_paths
        
        # 查找所有可能的路径
        all_paths = find_all_paths(from_script, to_script)
        
        # 返回最短的路径（如果存在）
        if all_paths:
            # 按路径长度排序，返回最短的路径
            shortest_path = min(all_paths, key=len)
            return shortest_path
        
        return None
    
    def _find_paths_to_leaves(self, analysis_script: str) -> List[List[str]]:
        """
        查找从分析脚本到所有叶子节点的路径
        
        Args:
            analysis_script: 分析脚本
            
        Returns:
            所有路径的列表
        """
        if not self.call_chains:
            # 需要先构建调用链，这里使用分析脚本作为入口
            self.analyze_recursive_calls(analysis_script)
        
        # 获取从分析脚本开始的所有调用路径
        paths = []
        
        # 使用深度优先搜索查找所有路径
        def find_all_paths(start: str, current_path: list = None) -> List[List[str]]:
            if current_path is None:
                current_path = []
            
            current_path = current_path + [start]
            all_paths = []
            
            # 获取当前脚本调用的所有脚本
            called_scripts = self.call_graph.get(start, set())
            
            if not called_scripts:
                # 如果没有调用其他脚本，说明是叶子节点
                if len(current_path) > 1:  # 排除只有分析脚本本身的路径
                    all_paths.append(current_path)
            else:
                # 递归查找每个被调用脚本的路径
                for called_script in called_scripts:
                    sub_paths = find_all_paths(called_script, current_path)
                    all_paths.extend(sub_paths)
            
            return all_paths
        
        # 查找所有路径
        all_paths = find_all_paths(analysis_script)
        
        return all_paths
    
    def _get_leaf_nodes(self, from_script: str) -> List[str]:
        """
        获取从指定脚本开始的所有叶子节点
        
        Args:
            from_script: 起始脚本
            
        Returns:
            叶子节点列表
        """
        if not self.call_chains:
            self.analyze_recursive_calls(from_script)
        
        # 找出所有被调用的脚本
        called_scripts = set()
        for calls in self.call_graph.values():
            called_scripts.update(calls)
        
        # 叶子节点是那些不被其他脚本调用的脚本
        leaf_nodes = []
        for script in self.call_chains.keys():
            if script not in called_scripts:
                leaf_nodes.append(script)
        
        return leaf_nodes
    
    def analyze_specific_paths(self, entry_script: str, analysis_script: str) -> Tuple[List[str], List[List[str]]]:
        """
        分析特定路径：入口脚本到分析脚本，以及分析脚本到叶子节点
        
        Args:
            entry_script: 入口脚本
            analysis_script: 分析脚本
            
        Returns:
            Tuple[List[str], List[List[str]]]: 
            - 第一个列表：入口脚本到分析脚本的调用链（嵌套列表格式）
            - 第二个列表：分析脚本到所有叶子节点的调用链列表（嵌套列表格式）
        """
        # 先构建从入口脚本开始的调用链
        entry_report = self.analyze_recursive_calls(entry_script)
        
        # 再构建从分析脚本开始的调用链
        analysis_report = self.analyze_recursive_calls(analysis_script)
        
        # 查找入口脚本到分析脚本的路径
        entry_to_analysis_path = self._find_path_to_script(entry_script, analysis_script)
        
        # 查找分析脚本到叶子节点的路径
        analysis_to_leaves_paths = self._find_paths_to_leaves(analysis_script)
        
        # 返回两个列表（嵌套列表格式）
        return entry_to_analysis_path or [], analysis_to_leaves_paths
    
    def analyze_specific_paths_with_details(self, entry_script: str, analysis_script: str) -> Dict:
        """
        分析特定路径并返回详细信息（包括间接调用）
        
        Args:
            entry_script: 入口脚本
            analysis_script: 分析脚本
            
        Returns:
            详细的路径分析结果
        """
        # 先构建从入口脚本开始的调用链
        entry_report = self.analyze_recursive_calls(entry_script)
        
        # 再构建从分析脚本开始的调用链
        analysis_report = self.analyze_recursive_calls(analysis_script)
        
        # 查找入口脚本到分析脚本的所有可能路径
        all_paths_to_analysis = self._find_all_paths_to_script(entry_script, analysis_script)
        shortest_path_to_analysis = all_paths_to_analysis[0] if all_paths_to_analysis else None
        
        # 查找分析脚本到叶子节点的路径
        analysis_to_leaves_paths = self._find_paths_to_leaves(analysis_script)
        
        # 构建结果
        result = {
            "entry_script": entry_script,
            "analysis_script": analysis_script,
            "entry_to_analysis": {
                "shortest_path": shortest_path_to_analysis,
                "all_paths": all_paths_to_analysis,
                "exists": len(all_paths_to_analysis) > 0,
                "path_count": len(all_paths_to_analysis),
                "shortest_length": len(shortest_path_to_analysis) if shortest_path_to_analysis else 0
            },
            "analysis_to_leaves": {
                "paths": analysis_to_leaves_paths,
                "count": len(analysis_to_leaves_paths),
                "leaf_nodes": self._get_leaf_nodes(analysis_script)
            },
            "entry_report": entry_report,
            "analysis_report": analysis_report
        }
        
        return result

    def _ensure_parsed_and_built(self) -> None:
        """确保已解析项目并构建调用图"""
        if not self.script_functions or not self.script_calls:
            self._parse_project()
        if not self.call_graph:
            self._build_call_graph()
    
    def get_root_scripts(self) -> List[str]:
        """获取工程中的根脚本（未被其他脚本调用的脚本）"""
        self._ensure_parsed_and_built()
        called_scripts: Set[str] = set()
        for calls in self.call_graph.values():
            called_scripts.update(calls)
        roots: List[str] = []
        for script in self.script_functions.keys():
            if script not in called_scripts:
                roots.append(script)
        return roots
    
    def find_all_paths_from_roots_to_target(self, target_script: str, roots: Optional[List[str]] = None) -> List[List[str]]:
        """从所有根脚本出发，找到到达目标脚本的所有路径"""
        self._ensure_parsed_and_built()
        if roots is None:
            roots = self.get_root_scripts()
        all_paths: List[List[str]] = []
        for root in roots:
            if root == target_script:
                all_paths.append([root])
                continue
            paths = self._find_all_paths_to_script(root, target_script)
            all_paths.extend(paths)
        # 去重（按列表内容）
        unique_paths = []
        seen = set()
        for p in all_paths:
            key = tuple(p)
            if key not in seen:
                seen.add(key)
                unique_paths.append(p)
        return unique_paths
    
    def analyze_impact_for_changes(self, changed_scripts: List[str], entry_roots: Optional[List[str]] = None) -> Dict[str, Dict]:
        """基于变更脚本进行影响分析
        返回每个变更脚本的：
        - 从根脚本到变更脚本的所有路径（上游影响）
        - 从变更脚本到各叶子的所有路径（下游影响）
        """
        self._ensure_parsed_and_built()
        roots = entry_roots if entry_roots is not None else self.get_root_scripts()
        impact_result: Dict[str, Dict] = {}
        for script in changed_scripts:
            # 规范化为相对路径风格（如果传入的是相对路径，这里不做变更）
            target = script
            upstream_paths = self.find_all_paths_from_roots_to_target(target, roots)
            downstream_paths = self._find_paths_to_leaves(target)
            impact_result[target] = {
                "entry_to_changed": {
                    "data": upstream_paths,
                    "description": "All paths from project entry roots to the changed script. Each path is a list of scripts (relative to project_path)."
                },
                "changed_to_leaves": {
                    "data": downstream_paths,
                    "description": "All paths from the changed script to reachable leaf scripts. Each path is a list of scripts (relative to project_path)."
                },
                "stats": {
                    "upstream_path_count": len(upstream_paths),
                    "downstream_path_count": len(downstream_paths)
                }
            }
        return impact_result


def main():
    """主函数，用于测试"""
    import sys
    
    if len(sys.argv) < 3:
        print("用法: python recursive_call_analyzer.py <MATLAB工程路径> <入口脚本> [分析脚本]")
        print("示例:")
        print("  python recursive_call_analyzer.py test_project complex_main.m")
        print("  python recursive_call_analyzer.py test_project complex_main.m manager.m")
        sys.exit(1)
    
    project_path = sys.argv[1]
    entry_script = sys.argv[2]
    analysis_script = sys.argv[3] if len(sys.argv) > 3 else None
    
    if not Path(project_path).exists():
        print(f"错误: 路径 {project_path} 不存在")
        sys.exit(1)
    
    # 创建递归分析器
    analyzer = RecursiveCallAnalyzer(project_path)
    
    if analysis_script:
        # 执行特定路径分析
        print(f"执行特定路径分析: {entry_script} -> {analysis_script}")
        
        # 获取两个列表结果
        entry_to_analysis_path, analysis_to_leaves_paths = analyzer.analyze_specific_paths(entry_script, analysis_script)
        
        # 直接输出两个列表
        print("\n" + "="*60)
        print("分析结果 - 两个列表")
        print("="*60)
        
        # 第一个列表：入口脚本到分析脚本的调用链
        print("\n第一个列表 - 入口脚本到分析脚本的调用链:")
        print("-" * 40)
        if entry_to_analysis_path:
            print("路径:", entry_to_analysis_path)
            print("路径长度:", len(entry_to_analysis_path))
        else:
            print("不存在调用链")
        
        # 第二个列表：分析脚本到叶子节点的调用链列表
        print("\n第二个列表 - 分析脚本到叶子节点的调用链列表:")
        print("-" * 40)
        if analysis_to_leaves_paths:
            print(f"共找到 {len(analysis_to_leaves_paths)} 条路径:")
            for i, path in enumerate(analysis_to_leaves_paths, 1):
                print(f"\n路径 {i}:")
                print("  ", path)
                print(f"  路径长度: {len(path)}")
        else:
            print("分析脚本本身就是叶子节点，无后续调用链")
        
        print("\n" + "="*60)
        
        # 返回两个列表（用于程序调用）
        return entry_to_analysis_path, analysis_to_leaves_paths
    else:
        # 执行普通递归分析
        analyzer.print_recursion_analysis(entry_script)
        
        # 返回递归分析结果
        report = analyzer.analyze_recursive_calls(entry_script)
        return report


if __name__ == "__main__":
    main() 