#!/usr/bin/env python3
"""
MATLAB调用链构建器
实现第二步：给定一个入口脚本，基于入口脚本搜索关联脚本，
用递归的方式，生成以入口脚本为根节点的调用链条
"""

import json
import logging
from pathlib import Path
from typing import Dict, List, Set, Tuple, Optional
from collections import defaultdict, deque
from script_parser import ImprovedMATLABScriptParser

# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


class CallChainBuilder:
    """MATLAB调用链构建器"""
    
    def __init__(self, project_path: str):
        """
        初始化调用链构建器
        
        Args:
            project_path: MATLAB工程根目录路径
        """
        self.project_path = Path(project_path)
        self.parser = ImprovedMATLABScriptParser(project_path)
        self.script_functions: Dict[str, Set[str]] = {}
        self.function_scripts: Dict[str, List[str]] = {}
        self.script_calls: Dict[str, Set[str]] = {}
        self.call_graph: Dict[str, Set[str]] = defaultdict(set)  # 脚本间的调用关系图
        self.visited: Set[str] = set()  # 已访问的脚本
        self.call_chains: Dict[str, List[str]] = {}  # 存储所有调用链
        
    def build_call_chains(self, entry_script: str) -> Dict[str, List[str]]:
        """
        从入口脚本开始构建调用链
        
        Args:
            entry_script: 入口脚本名称（相对于工程根目录的路径）
            
        Returns:
            调用链字典，键为脚本名，值为从入口到该脚本的路径
        """
        logger.info(f"开始构建调用链，入口脚本: {entry_script}")
        
        # 首先解析整个工程
        self._parse_project()
        
        # 验证入口脚本是否存在
        if entry_script not in self.script_functions:
            logger.error(f"入口脚本 {entry_script} 不存在")
            return {}
        
        # 构建调用关系图
        self._build_call_graph()
        
        # 从入口脚本开始递归构建调用链
        self.call_chains = {}
        self.visited = set()
        
        # 使用递归方式构建所有可能的调用链
        self._build_all_chains_recursive(entry_script)
        
        logger.info(f"调用链构建完成，共找到 {len(self.call_chains)} 个脚本的调用链")
        return self.call_chains
    
    def _parse_project(self) -> None:
        """解析整个工程"""
        logger.info("开始解析MATLAB工程...")
        self.script_functions = self.parser.scan_project()
        self.function_scripts = self.parser.get_function_scripts()
        self.script_calls = self.parser.get_script_calls()
        logger.info(f"解析完成，共 {len(self.script_functions)} 个脚本文件")
    
    def _build_call_graph(self) -> None:
        """构建脚本间的调用关系图（考虑MATLAB函数优先级规则）"""
        logger.info("构建调用关系图...")
        
        for script_name, calls in self.script_calls.items():
            for func_call in calls:
                # 检查这个函数调用是否对应某个脚本中定义的函数
                if func_call in self.function_scripts:
                    # 检查是否应该建立外部调用关系
                    should_create_external_call = True
                    
                    # 如果调用脚本有内部定义，检查优先级
                    if script_name in self.function_scripts[func_call]:
                        # 使用新的优先级检查方法
                        func_info = self.parser.get_function_definition_for_script(func_call, script_name)
                        if func_info.get('is_internal_definition', False):
                            should_create_external_call = False
                            logger.debug(f"脚本 {script_name} 有 {func_call} 的内部定义，跳过外部调用关系")
                    
                    # 只有在需要外部调用时才建立关系
                    if should_create_external_call:
                        # 处理多关联映射：function_scripts[func_call] 现在是 List[str]
                        called_scripts = self.function_scripts[func_call]
                        if isinstance(called_scripts, list):
                            # 使用主定义（列表中的第一个）
                            called_script = called_scripts[0] if called_scripts else None
                        else:
                            # 兼容旧版本（单一映射）
                            called_script = called_scripts
                        
                        if called_script and called_script != script_name:  # 避免自调用
                            self.call_graph[script_name].add(called_script)
                            logger.debug(f"建立调用关系: {script_name} -> {called_script} (函数: {func_call})")
        
        logger.info(f"调用关系图构建完成，共 {len(self.call_graph)} 个脚本有调用关系")
    
    def _build_all_chains_recursive(self, entry_script: str) -> None:
        """
        使用递归方式构建所有可能的调用链
        
        Args:
            entry_script: 入口脚本
        """
        logger.info(f"开始递归构建调用链，入口脚本: {entry_script}")
        self._recursive_build_chain(entry_script, [entry_script])
    
    def _recursive_build_chain(self, current_script: str, current_path: List[str]) -> None:
        """
        递归构建调用链的核心方法
        
        Args:
            current_script: 当前脚本
            current_path: 当前路径
        """
        # 记录当前路径
        self.call_chains[current_script] = current_path.copy()
        logger.debug(f"递归处理脚本: {current_script}, 路径: {' -> '.join(current_path)}")
        
        # 获取当前脚本调用的其他脚本
        called_scripts = self.call_graph.get(current_script, set())
        
        # 递归处理每个被调用的脚本
        for called_script in called_scripts:
            # 避免循环调用
            if called_script not in current_path:
                new_path = current_path + [called_script]
                logger.debug(f"递归调用: {current_script} -> {called_script}")
                self._recursive_build_chain(called_script, new_path)
            else:
                logger.warning(f"检测到循环调用: {' -> '.join(current_path)} -> {called_script}")
    
    def _build_all_chains_bfs(self, entry_script: str) -> None:
        """
        使用BFS构建所有可能的调用链（保留作为备选方案）
        
        Args:
            entry_script: 入口脚本
        """
        queue = deque([(entry_script, [entry_script])])  # (脚本名, 路径)
        
        while queue:
            current_script, path = queue.popleft()
            
            # 记录当前路径
            self.call_chains[current_script] = path.copy()
            
            # 获取当前脚本调用的其他脚本
            called_scripts = self.call_graph.get(current_script, set())
            
            for called_script in called_scripts:
                # 避免循环调用
                if called_script not in path:
                    new_path = path + [called_script]
                    queue.append((called_script, new_path))
    
    def get_call_tree(self, entry_script: str) -> Dict:
        """
        获取调用树结构
        
        Args:
            entry_script: 入口脚本
            
        Returns:
            调用树字典
        """
        if not self.call_chains:
            self.build_call_chains(entry_script)
        
        # 构建树结构
        tree = {
            "root": entry_script,
            "nodes": {},
            "edges": []
        }
        
        # 添加所有节点
        for script, path in self.call_chains.items():
            tree["nodes"][script] = {
                "depth": len(path) - 1,
                "path": path,
                "called_by": [],
                "calls": list(self.call_graph.get(script, set()))
            }
        
        # 添加边
        for script, calls in self.call_graph.items():
            for called_script in calls:
                if called_script in self.call_chains:
                    tree["edges"].append({
                        "from": script,
                        "to": called_script
                    })
                    # 更新被调用关系
                    if called_script in tree["nodes"]:
                        tree["nodes"][called_script]["called_by"].append(script)
        
        return tree
    
    def find_path_to_script(self, entry_script: str, target_script: str) -> Optional[List[str]]:
        """
        查找从入口脚本到目标脚本的路径
        
        Args:
            entry_script: 入口脚本
            target_script: 目标脚本
            
        Returns:
            路径列表，如果不存在路径则返回None
        """
        if not self.call_chains:
            self.build_call_chains(entry_script)
        
        return self.call_chains.get(target_script)
    
    def get_leaf_nodes(self, entry_script: str) -> List[str]:
        """
        获取所有叶子节点（不被其他脚本调用的脚本）
        
        Args:
            entry_script: 入口脚本
            
        Returns:
            叶子节点列表
        """
        if not self.call_chains:
            self.build_call_chains(entry_script)
        
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
    
    def print_call_chains(self, entry_script: str) -> None:
        """打印调用链信息"""
        if not self.call_chains:
            self.build_call_chains(entry_script)
        
        print(f"\n=== 调用链信息 (入口脚本: {entry_script}) ===")
        print(f"总脚本数量: {len(self.call_chains)}")
        
        # 按深度排序
        sorted_chains = sorted(self.call_chains.items(), key=lambda x: len(x[1]))
        
        print("\n调用链详情:")
        for script, path in sorted_chains:
            depth = len(path) - 1
            path_str = " -> ".join(path)
            print(f"  {script} (深度: {depth}): {path_str}")
        
        # 显示叶子节点
        leaf_nodes = self.get_leaf_nodes(entry_script)
        print(f"\n叶子节点 ({len(leaf_nodes)} 个):")
        for leaf in leaf_nodes:
            print(f"  {leaf}")
        
        # 显示调用关系图
        print(f"\n调用关系图:")
        for script, calls in self.call_graph.items():
            if calls:
                calls_str = ", ".join(calls)
                print(f"  {script} -> {calls_str}")


def main():
    """主函数，用于测试"""
    import sys
    
    if len(sys.argv) < 3:
        print("用法: python call_chain_builder.py <MATLAB工程路径> <入口脚本>")
        sys.exit(1)
    
    project_path = sys.argv[1]
    entry_script = sys.argv[2]
    
    if not Path(project_path).exists():
        print(f"错误: 路径 {project_path} 不存在")
        sys.exit(1)
    
    # 创建调用链构建器
    builder = CallChainBuilder(project_path)
    
    # 构建调用链
    call_chains = builder.build_call_chains(entry_script)
    
    # 打印结果
    builder.print_call_chains(entry_script)
    
    # 保存结果到JSON文件
    output_file = f"call_chains_{entry_script.replace('/', '_').replace('.m', '')}.json"
    call_tree = builder.get_call_tree(entry_script)
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(call_tree, f, indent=2, ensure_ascii=False)
    
    print(f"\n调用链结果已保存到: {output_file}")


if __name__ == "__main__":
    main() 