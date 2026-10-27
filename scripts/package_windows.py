"""Release builder. End users need only the generated Windows executable and a browser."""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = ROOT / 'tools' / 'windows-launcher'
OUTPUT = ROOT / 'release'
GO = os.environ.get('GO_BINARY', 'go')
NPM = 'npm.cmd' if os.name == 'nt' else 'npm'

def run(args, cwd=ROOT, env=None):
    subprocess.run(args, cwd=cwd, env=env, check=True)

version = subprocess.check_output([GO, 'version'], text=True)
if not version.startswith('go version go'):
    raise SystemExit('Install the Go toolchain or set GO_BINARY to its full executable path.')
print(version.strip())
run([NPM, 'run', 'build'])
shutil.rmtree(LAUNCHER / 'web', ignore_errors=True)
shutil.copytree(ROOT / 'dist', LAUNCHER / 'web')
OUTPUT.mkdir(exist_ok=True)
env = dict(os.environ, CGO_ENABLED='0', GOTOOLCHAIN='local', GOTELEMETRY='off', GOPATH=str(OUTPUT / 'go-path'), GOCACHE=str(OUTPUT / 'go-cache'))
run([GO, 'test', './...'], LAUNCHER, env)
for arch in ['amd64', 'arm64']:
    folder = OUTPUT / f'GT-WuWa-Windows-{arch}'
    folder.mkdir(exist_ok=True)
    target = folder / 'Potato-Minesweeper.exe'
    cross_env = dict(env, GOOS='windows', GOARCH=arch)
    run([GO, 'build', '-trimpath', '-ldflags=-s -w -buildid=', '-o', str(target), '.'], LAUNCHER, cross_env)
    shutil.copyfile(ROOT / 'docs' / 'WINDOWS-QUICKSTART.txt', folder / 'READ-ME.txt')
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    (folder / 'SHA256.txt').write_text(f'{digest}  {target.name}\n', encoding='utf-8')
    archive = OUTPUT / f'{folder.name}.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
        for f in sorted(folder.iterdir()):
            z.write(f, f'{folder.name}/{f.name}')
    print(f'Built {archive.name}; exe SHA256: {digest}')
