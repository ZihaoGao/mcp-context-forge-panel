"""Generate feature-gated schemas without starting external Vault/SIEM services.

Run with the isolated v1.0.11 Python environment after start-test-backend.py
has created test credentials. This imports backend API routers only.
"""
import importlib
import json
import os
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1]
source = root / '.cache/backend'
auth = json.loads((root / '.cache/test-credentials.json').read_text())
os.environ.update(PYTHONIOENCODING='utf-8', JWT_SECRET_KEY=auth['jwt'], AUTH_ENCRYPTION_SECRET=auth['encryption'],
    PLATFORM_ADMIN_PASSWORD=auth['password'], DEFAULT_USER_PASSWORD=auth['password'], MCPGATEWAY_UI_ENABLED='false',
    MCPGATEWAY_ADMIN_API_ENABLED='true', LLM_API_PREFIX='/llm/v1')
sys.path.insert(0, str(source))
os.chdir(source)
from mcpgateway.main import app

metadata = []
for module, variable, prefix, flag in [
    ('mcpgateway.routers.vault_router', 'vault_router', '', 'OAUTH_TOKEN_BACKEND=vault'),
    ('mcpgateway.routers.siem', 'router', '', 'SIEM_EXPORT_ENABLED=true'),
    ('mcpgateway.routers.toolops_router', 'toolops_router', '/v1', 'TOOLOPS_ENABLED=true'),
]:
    router = getattr(importlib.import_module(module), variable)
    app.include_router(router, prefix=prefix)
    for route in router.routes:
        metadata.append({'path': prefix + route.path, 'flag': flag})
app.openapi_schema = None
schema = app.openapi()
wanted = {item['path'] for item in metadata}
schema['paths'] = {key: value for key, value in schema['paths'].items() if key in wanted}
schema['x-panel-features'] = metadata
(root / 'contracts/contextforge/optional-openapi.json').write_text(json.dumps(schema, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'Generated {len(schema["paths"])} optional paths without running service lifespan')
