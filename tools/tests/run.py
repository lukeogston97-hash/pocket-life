"""Run the checks: python3 tools/tests/run.py [names...]   (no names runs them all; UPDATE_LAYOUT=1 saves a new layout baseline)

First time: cd tools/tests && npm install   (also needs Python Playwright and Chrome)."""
import asyncio, sys, time, traceback
from checks import CHECKS

names = sys.argv[1:] or list(CHECKS)
failed = []
for n in names:
    print(f'{n}: {CHECKS[n].__doc__}')
    t = time.time()
    try:
        asyncio.run(CHECKS[n]())
    except Exception as e:
        failed.append(n)
        if not isinstance(e, AssertionError): traceback.print_exc()
    print(f'  ({time.time() - t:.0f} s)')
print('\nAll passed' if not failed else f'\nFailed: {", ".join(failed)}')
sys.exit(1 if failed else 0)
