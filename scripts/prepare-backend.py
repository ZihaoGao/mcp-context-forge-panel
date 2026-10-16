"""Prepare an exact-tag backend in .cache, without modifying the source repo."""
import argparse
import io
import os
from pathlib import Path
import subprocess
import tarfile
import tomllib

BASELINE_TAG = 'v1.0.11'
BASELINE_COMMIT = '077071bbb43599dd5ab9372ebdbb9a8e686a9816'
BASELINE_TAG_OBJECT = 'f918209a1788437b2508f9f8504eecd44bbc5cf5'
parser = argparse.ArgumentParser()
parser.add_argument('--repo', default='../mcp-context-forge')
parser.add_argument('--tag', choices=['v1.0.11', 'v1.0.10'], default='v1.0.11')
parser.add_argument('--chat', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
repo = Path(args.repo).resolve()
profile = 'chat' if args.chat else 'backend'
source = root / f'.cache/{profile}'
venv = root / f'.cache/{profile}-venv'
source.mkdir(parents=True, exist_ok=True)
git = ['git', '-C', str(repo), '-c', f'safe.directory={repo.as_posix()}']
commit = subprocess.check_output([*git, 'rev-parse', f'{args.tag}^{{commit}}'], text=True).strip()
tag_object = subprocess.check_output([*git, 'rev-parse', args.tag], text=True).strip()
if args.tag == BASELINE_TAG and (
    commit != BASELINE_COMMIT or tag_object != BASELINE_TAG_OBJECT
):
    raise SystemExit(
        f'{args.tag} does not resolve to the expected baseline commit/tag object '
        f'({BASELINE_COMMIT}/{BASELINE_TAG_OBJECT}); got {commit}/{tag_object}'
    )
marker = source / '.panel-source-commit'
if marker.exists():
    previous = marker.read_text().strip()
    # Older runs stored git rev-parse <tag>, which is the annotated tag object.
    # Accept only this exact tag object's hash, then migrate the marker to the peeled commit.
    if previous not in {commit, tag_object}:
        raise SystemExit('Existing isolated source has a different commit/tag object; choose a fresh profile directory.')
archive = subprocess.check_output([*git, 'archive', args.tag])
with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
    # Symlinks in upstream source are unnecessary for the headless test runtime.
    tar.extractall(source, members=[member for member in tar.getmembers() if member.isfile() or member.isdir()], filter='data')
marker.write_text(commit)
data = tomllib.loads((source / 'pyproject.toml').read_text(encoding='utf-8'))
dependencies = data['project']['dependencies']
if args.chat:
    dependencies += data['project']['optional-dependencies']['llmchat']
requirements = root / f'.cache/{profile}-requirements.txt'
requirements.write_text('\n'.join(dependencies), encoding='utf-8')
env = dict(os.environ, UV_PYTHON_INSTALL_DIR=str(root / '.cache/python'))
uv = ['uv', '--cache-dir', str(root / '.cache/uv')]
subprocess.run([*uv, 'python', 'install', '3.12', '--no-bin'], env=env, check=True)
subprocess.run([*uv, 'venv', '--python', '3.12', str(venv), '--allow-existing'], env=env, check=True)
python = venv / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
locked = root / f'.cache/{profile}-locked.txt'
subprocess.run([*uv, 'pip', 'compile', '--python', str(python), str(requirements), '--output-file', str(locked), '--quiet'], env=env, check=True)
subprocess.run([*uv, 'pip', 'sync', '--python', str(python), str(locked)], env=env, check=True)
(root / f'.cache/{profile}-resolved.txt').write_text(subprocess.check_output([*uv, 'pip', 'freeze', '--python', str(python)], env=env, text=True), encoding='utf-8')
print(f'Ready: {args.tag} ({commit}) in {source}')
