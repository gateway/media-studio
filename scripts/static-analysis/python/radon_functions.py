"""Use Radon's native visitor for every function, including nested class methods."""
import ast
import json
from pathlib import Path
import sys

from radon.complexity import cc_visit_ast


def analyze(file):
    tree = ast.parse(Path(file).read_text(encoding='utf-8-sig'), filename=file)
    results = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        blocks = cc_visit_ast(node)
        matching = [block for block in blocks if block.lineno == node.lineno and block.name == node.name]
        if len(matching) != 1:
            raise ValueError(f'Radon did not return exactly one metric for {file}:{node.lineno}')
        block = matching[0]
        results.append(dict(type='function', name=block.name, lineno=block.lineno,
                            col_offset=block.col_offset, complexity=block.complexity, endline=block.endline))
    return results


if __name__ == '__main__':
    print(json.dumps({file: analyze(file) for file in sys.argv[1:]}))
