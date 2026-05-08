import os
for f in os.listdir('raw'):
    if f.endswith('.md') and not '_COMPILED' in f:
        os.rename(f"raw/{f}", f"raw/{f.replace('.md', '_COMPILED.md')}")