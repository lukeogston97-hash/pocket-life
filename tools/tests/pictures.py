"""Draws the game's pictures from the game itself: python3 tools/tests/pictures.py   (about a minute)

  test/icons/share.jpg             what a shared link shows (Facebook, Messenger, Discord): the main menu's own view of the
                                   world with the game's name, 1200 x 630
  test/icons/icon-512.png, icon-192.png, apple-touch-icon.png, favicon.png
                                   the app icon: the person from Make your person (defaultLook in game-data.json), head and
                                   shoulders, on the game's green

Run it again whenever the look of the world, the people or the name changes, then look at the files before pushing.
It needs what the checks need (npm install here, Python Playwright, Chrome) plus Pillow and numpy (pip install pillow numpy)."""
import asyncio, io, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from lib import world, ROOT

OUT = os.path.join(ROOT, 'test', 'icons')
GREEN = ('#b9e8c3', '#84cd96')  # the icon's background, top to bottom (the game's accent green, style.css --accent, a little lighter)


async def frames(pg, n):
    f0 = await pg.evaluate('window.__frames')
    await pg.wait_for_function(f'window.__frames >= {f0 + n}', timeout=120000)


async def capture():
    """The two raw pictures: the menu's view (twice the size, for smooth edges) and the person with a see-through background."""
    async with world() as W:
        # the main menu as it is, without its buttons and name tags, the name a good deal bigger
        pg = await W.page('pictureshare', 1200, 630, touch=False, fonts=True, sharp=2, still=True)
        await pg.add_style_tag(content=".menu-card, #labels { display: none !important; } .main-menu { padding-top: 46px !important; }"
                                       ".menu-title { font-size: 96px !important; letter-spacing: -1.5px !important; text-shadow: 0 4px 30px rgba(10, 14, 12, 0.55), 0 2px 6px rgba(10, 14, 12, 0.45) !important; }"
                                       ".menu-tag { font-size: 31px !important; margin-top: 16px !important; text-shadow: 0 2px 16px rgba(10, 14, 12, 0.6), 0 1px 3px rgba(10, 14, 12, 0.5) !important; }")
        await pg.evaluate('document.fonts.ready'); await frames(pg, 4)
        share = Image.open(io.BytesIO(await pg.screenshot())).convert('RGB')
        await pg.context.close()
        # The person on the Make your person stage, filling the screen. Drawn twice, on black and on white: the difference
        # between the two says exactly how see-through each dot is, so the background comes out cleanly, edges and all.
        pg = await W.page('pictureicon', 1400, 1400, touch=False, sharp=2, still=True)
        await pg.click('#playBtn'); await pg.wait_for_timeout(1500)
        await pg.add_style_tag(content=".creator-head { position: absolute !important; top: -600px !important; } .sheet { position: fixed !important; top: 100vh !important; left: 0 !important; } .drag-hint { display: none !important; }")
        on = {}
        for name, colour in [('black', '#000000'), ('white', '#ffffff')]:
            await pg.evaluate("(colour) => { const r = __pl.renderer; r.__set = r.__set || r.setClearColor.bind(r); r.setClearColor = () => r.__set(colour, 1); }", colour)
            await frames(pg, 4)
            on[name] = np.asarray(Image.open(io.BytesIO(await pg.screenshot())).convert('RGB')).astype(np.float64)
        alpha = np.clip(1 - (on['white'] - on['black']).mean(axis=2) / 255.0, 0, 1)
        rgb = np.where(alpha[..., None] > 1e-3, on['black'] / np.maximum(alpha[..., None], 1e-3), 0)
        person = Image.fromarray(np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8), 'RGBA')
        if W.errors: raise SystemExit(f'the game had errors: {W.errors[:3]}')
        return share, person


def icon(person, size=1024):
    """Head and shoulders on the green, with a soft shadow behind. The face sits well inside the middle, so a phone that
    rounds the icon or cuts it to a circle never clips it."""
    rgb = lambda h: np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], float)
    t = np.linspace(0, 1, size)[:, None, None]
    bg = Image.fromarray(((rgb(GREEN[0]) * (1 - t) + rgb(GREEN[1]) * t) * np.ones((size, size, 1))).astype(np.uint8), 'RGB').convert('RGBA')
    k = person.width / 2800  # (the cut below was measured on a 2800 px picture)
    w = int(size * 1.04)
    bust = person.crop(tuple(int(v * k) for v in (930, 190, 1870, 1130))).resize((w, w), Image.LANCZOS)
    x, y = (size - w) // 2, int(size * 0.085)
    shadow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    shadow.paste((20, 40, 28, 255), (x + int(size * 0.012), y + int(size * 0.02)), bust.split()[3].point(lambda v: int(v * 0.22)))
    bg.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(size * 0.02)))
    bg.alpha_composite(bust, (x, y))
    return bg.convert('RGB')


def main():
    share, person = asyncio.run(capture())
    os.makedirs(OUT, exist_ok=True)
    share.resize((1200, 630), Image.LANCZOS).save(os.path.join(OUT, 'share.jpg'), quality=88, optimize=True, progressive=True)
    big = icon(person)
    for name, s in [('icon-512.png', 512), ('icon-192.png', 192), ('apple-touch-icon.png', 180)]:
        big.resize((s, s), Image.LANCZOS).save(os.path.join(OUT, name), optimize=True)
    # the browser tab's little picture: the same, with rounded corners
    s = 96
    tab = big.resize((s * 4, s * 4), Image.LANCZOS).convert('RGBA')
    mask = Image.new('L', tab.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, s * 4 - 1, s * 4 - 1), int(s * 4 * 0.22), fill=255)
    tab.putalpha(mask)
    tab.resize((s, s), Image.LANCZOS).save(os.path.join(OUT, 'favicon.png'), optimize=True)
    for f in sorted(os.listdir(OUT)): print(f'  {f}: {os.path.getsize(os.path.join(OUT, f)) // 1024} KB')


if __name__ == '__main__':
    main()
