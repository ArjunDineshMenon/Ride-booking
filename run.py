"""Build and serve Roam with one command: python run.py."""
from pathlib import Path
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
VENV_PYTHON = ROOT / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
if VENV_PYTHON.exists() and Path(sys.executable).resolve() != VENV_PYTHON.resolve():
    raise SystemExit(subprocess.call([str(VENV_PYTHON), str(Path(__file__).resolve()), *sys.argv[1:]], cwd=ROOT))

try:
    import uvicorn
except ImportError:
    raise SystemExit('Install backend dependencies first: python -m pip install -r backend/requirements.txt')

if not (ROOT / 'dist' / 'index.html').exists() or '--build' in sys.argv:
    npm = 'npm.cmd' if os.name == 'nt' else 'npm'
    if not (ROOT / 'node_modules').exists():
        subprocess.run([npm, 'ci'], cwd=ROOT, check=True)
    subprocess.run([npm, 'run', 'build'], cwd=ROOT, check=True)

if __name__ == '__main__':
    print('\nRoam is ready at http://127.0.0.1:8000\nAPI docs: http://127.0.0.1:8000/docs\n')
    uvicorn.run('backend.app:app', host='127.0.0.1', port=8000)
