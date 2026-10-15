"""Inventory backend HTTP decorators from an exact Git tag, excluding UI code."""
import ast
import json
from pathlib import Path
import subprocess
import sys

repo = sys.argv[1] if len(sys.argv) > 1 else '../mcp-context-forge'
tag = 'v1.0.11'
def git(*args):
    return subprocess.check_output(['git', '-C', repo, '-c', f'safe.directory={Path(repo).resolve().as_posix()}', *args], text=True, encoding='utf-8')
files = git('ls-tree', '-r', '--name-only', tag, 'mcpgateway/routers', 'mcpgateway/main.py', 'mcpgateway/admin.py').splitlines()
routes = []
for file in files:
    if not file.endswith('.py'): continue
    tree = ast.parse(git('show', f'{tag}:{file}'))
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)): continue
        permission = None
        dependencies = [ast.unparse(call) for call in ast.walk(node.args) if isinstance(call, ast.Call) and isinstance(call.func, ast.Name) and call.func.id in {'Depends', 'Security'}]
        for dec in node.decorator_list:
            if isinstance(dec, ast.Call) and isinstance(dec.func, ast.Name) and dec.func.id.startswith('require_'):
                permission = ast.unparse(dec)
        for dec in node.decorator_list:
            if not isinstance(dec, ast.Call) or not isinstance(dec.func, ast.Attribute) or dec.func.attr not in {'get', 'post', 'put', 'patch', 'delete', 'websocket'} or not dec.args: continue
            if not isinstance(dec.args[0], ast.Constant): continue
            keywords = {k.arg: ast.unparse(k.value) for k in dec.keywords}
            routes.append({'source': file, 'line': node.lineno, 'router': ast.unparse(dec.func.value), 'method': dec.func.attr.upper(), 'path': dec.args[0].value, 'handler': node.name, 'permission': permission, 'dependencies': dependencies, 'deprecated': keywords.get('deprecated') == 'True', 'hidden': keywords.get('include_in_schema') == 'False'})
out = Path('contracts/contextforge')
out.mkdir(parents=True, exist_ok=True)
(out / 'source-routes.json').write_text(json.dumps({'tag': tag, 'commit': git('rev-parse', tag).strip(), 'note': 'HTTP decorators and dependencies before router mounting, including admin API metadata only. No UI rendering bodies, templates or frontend assets are extracted. Not a substitute for runtime OpenAPI or backend authorization.', 'routes': routes}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'Inventoried {len(routes)} backend HTTP decorators and dependency metadata')
