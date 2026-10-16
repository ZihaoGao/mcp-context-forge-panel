"""Run an isolated exact-tag backend; never edit the reference checkout."""
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import argparse

parser = argparse.ArgumentParser()
parser.add_argument('--chat', action='store_true')
args = parser.parse_args()

root = Path(__file__).resolve().parents[1]
profile = 'chat' if args.chat else 'backend'
source = root / f'.cache/{profile}'
credentials = root / '.cache/test-credentials.json'
if not credentials.exists():
    credentials.write_text(json.dumps({'email': 'panel-admin@example.com', 'password': 'Panel!9' + '.'.join(secrets.token_urlsafe(18)), 'jwt': secrets.token_urlsafe(48), 'encryption': secrets.token_urlsafe(48)}), encoding='utf-8')
auth = json.loads(credentials.read_text())
env = dict(os.environ, PYTHONIOENCODING='utf-8', PYTHONPATH=str(source), HOST='127.0.0.1', PORT='4445' if args.chat else '4444', ENVIRONMENT='development',
    JWT_SECRET_KEY=auth['jwt'], AUTH_ENCRYPTION_SECRET=auth['encryption'],
    PLATFORM_ADMIN_EMAIL=auth['email'], PLATFORM_ADMIN_PASSWORD=auth['password'], DEFAULT_USER_PASSWORD=auth['password'],
    ADMIN_REQUIRE_PASSWORD_CHANGE_ON_BOOTSTRAP='false', PASSWORD_CHANGE_ENFORCEMENT_ENABLED='false',
    EMAIL_AUTH_ENABLED='true', AUTH_REQUIRED='true', SECURE_COOKIES='false',
    MCPGATEWAY_UI_ENABLED='false', MCPGATEWAY_ADMIN_API_ENABLED='true',
    LLMCHAT_ENABLED='true', LLM_API_ENABLED='true', LLM_CONFIG_ENABLED='true', LLM_API_PREFIX='/llm/v1',
    SSO_ENABLED='true', OBSERVABILITY_ENABLED='true', MCPGATEWAY_REVERSE_PROXY_ENABLED='true',
    SSRF_ALLOW_LOCALHOST='true' if args.chat else 'false',
    A2A_ENABLED='true', LEGACY_API_ENABLED='false', LOG_LEVEL='WARNING')
# Browser suites create and clean up paginated fixtures in a short burst.
# Keep throttling enabled with test-only capacity; production never uses this launcher.
env.update(RATE_LIMIT_CRITICAL_RPM='1000', RATE_LIMIT_HIGH_RPM='2000',
           RATE_LIMIT_MEDIUM_RPM='5000', RATE_LIMIT_LOW_RPM='5000')
python = root / f'.cache/{profile}-venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
sys.exit(subprocess.call([str(python), '-m', 'mcpgateway'], cwd=source, env=env))
