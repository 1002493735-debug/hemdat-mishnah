"""Online consistent SQLite snapshot. Keep backups outside source control."""
import argparse
import sqlite3
from pathlib import Path
p=argparse.ArgumentParser()
p.add_argument("source")
p.add_argument("destination")
args=p.parse_args()
target=Path(args.destination)
if target.exists():
    raise SystemExit("Destination already exists; choose a new backup name")
target.parent.mkdir(parents=True,exist_ok=True)
src=sqlite3.connect("file:"+str(Path(args.source).resolve())+"?mode=ro",uri=True)
dst=sqlite3.connect(target)
try:
    src.backup(dst)
    check=dst.execute("PRAGMA integrity_check").fetchone()[0]
    if check!="ok":raise RuntimeError(check)
finally:
    src.close()
    dst.close()
target.chmod(0o600)
print("Backup complete")
