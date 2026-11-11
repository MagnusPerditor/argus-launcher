import sys, pathlib
from playwright.sync_api import sync_playwright
root = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(sys.argv[1]); out.mkdir(exist_ok=True)
INIT = """
window.__btn = new Array(17).fill(0); window.__axes = [0,0,0,0];
navigator.getGamepads = () => [{ connected: true, id: 'Fake Xbox', axes: window.__axes, buttons: window.__btn.map(v => ({ pressed: !!v, value: v })) }];
document.hasFocus = () => true;
"""
B = dict(a=0, b=1, x=2, y=3, lb=4, rb=5, lt=6, rt=7, view=8, start=9, up=12, down=13, left=14, right=15)
errors = []
with sync_playwright() as p:
    br = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--allow-file-access-from-files'])
    pg = br.new_page(viewport={'width': 1500, 'height': 920})
    pg.add_init_script(INIT)
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto((root / 'renderer' / 'index.html').as_uri()); pg.wait_for_timeout(500)
    def press(k, n=1):
        for _ in range(n):
            pg.evaluate(f"window.__btn[{B[k]}] = 1"); pg.wait_for_timeout(60)
            pg.evaluate(f"window.__btn[{B[k]}] = 0"); pg.wait_for_timeout(120)
    focus = lambda: pg.evaluate("(() => { const a = document.activeElement; const c = a.closest('.card'); return (c ? 'card:' + c.querySelector('.t').textContent : a.tagName + ':' + (a.textContent || a.value || '').trim().slice(0, 30)); })()")
    log = []
    press('a')  # first press: auto couch mode (autoOnController default true)
    pg.wait_for_timeout(300)
    log.append(('couch', pg.evaluate("document.body.classList.contains('couch')"), focus()))
    pg.screenshot(path=str(out / 'p1-couch-home.png'))
    press('rb'); pg.wait_for_timeout(300); log.append(('rb->', pg.evaluate("document.querySelector('h1.cat').textContent"), focus()))
    press('right'); log.append(('right', focus()))
    press('down'); log.append(('down', focus()))
    pg.screenshot(path=str(out / 'p2-movies-focus.png'))
    press('a'); pg.wait_for_timeout(300); log.append(('A open detail', pg.evaluate("document.querySelector('#detail').classList.contains('on')"), focus()))
    pg.screenshot(path=str(out / 'p3-detail.png'))
    press('down'); log.append(('down in detail', focus()))
    press('b'); pg.wait_for_timeout(200); log.append(('B close', pg.evaluate("document.querySelector('#detail').classList.contains('on')"), focus()))
    press('left', 4); log.append(('left x4 -> sidebar', focus()))
    press('b'); log.append(('B from sidebar', pg.evaluate("document.querySelector('h1.cat') ? document.querySelector('h1.cat').textContent : 'home'")))
    press('y'); pg.wait_for_timeout(200); log.append(('Y osk', pg.evaluate("document.querySelector('#osk').classList.contains('on')"), focus()))
    # type "ma": we start on 'a'; move to m: row z..m is below
    press('down'); press('right', 5)  # a->z row: z x c v b n m  => from z(right x6)? check focus
    log.append(('osk pos', focus()))
    pg.screenshot(path=str(out / 'p4-osk.png'))
    press('a'); log.append(('typed', pg.evaluate("document.getElementById('q').value")))
    press('b'); pg.wait_for_timeout(400); log.append(('osk closed', pg.evaluate("document.querySelector('#osk').classList.contains('on')"), focus()))
    pg.screenshot(path=str(out / 'p5-search.png'))
    press('start'); pg.wait_for_timeout(200); log.append(('start exits couch', pg.evaluate("document.body.classList.contains('couch')")))
    # keyboard arrows
    pg.keyboard.press('Escape'); pg.keyboard.press('ArrowDown'); log.append(('kbd arrow', focus()))
    pg.keyboard.press('Escape'); pg.evaluate("go('games')"); pg.wait_for_timeout(300)
    press('down'); log.append(('games landing focus', focus(), pg.evaluate("document.activeElement.dataset.col || ''")))
    press('right'); press('a'); pg.wait_for_timeout(300); log.append(('A opens collection', pg.evaluate("document.querySelector('h1.cat').textContent"), focus()))
    press('b'); pg.wait_for_timeout(300); log.append(('B back to tiles', pg.evaluate("document.querySelector('h1.cat').textContent"), pg.evaluate("document.activeElement.dataset.col || ''")))
    for l in log: print(l)
    br.close()
print('errors:', errors)
