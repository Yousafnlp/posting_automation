# Adds the cover text to Gemini backgrounds, in the channel thumbnail style
# (Impact, distressed grunge, white line + bigger red line, inside Instagram's 3:4 grid crop).
#
#   python3 scripts/add_cover_text.py                    # every image in covers/backgrounds/
#   python3 scripts/add_cover_text.py BG OUT "LINE 1" "LINE 2"
#
# Batch mode makes a cover for every reel in covers/texts.json, using covers/backgrounds/<reel>.*
# or, if that's missing, rotates through covers/backgrounds/_default_1.*, _default_2.*, … Finished covers go to tmp/thumbnails/<reel>.jpg.
import json, os, random, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

ROOT = Path(__file__).resolve().parent.parent
FONT = '/System/Library/Fonts/Supplemental/Impact.ttf'

def fit(text, maxw, size):
    d = ImageDraw.Draw(Image.new('L', (1, 1)))
    while d.textlength(text, font=ImageFont.truetype(FONT, size)) > maxw: size -= 4
    return ImageFont.truetype(FONT, size)

def grunge(size, density, blur):
    n = Image.effect_noise(size, 90).filter(ImageFilter.GaussianBlur(blur))
    return n.point(lambda v: 255 if v > 255 - density else 0).filter(ImageFilter.GaussianBlur(0.8))

def layer(text, font, color, dark):
    d = ImageDraw.Draw(Image.new('L', (1, 1)))
    l, t, r, b = d.textbbox((0, 0), text, font=font)
    w, h = r - l + 40, b - t + 40
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).text((20 - l, 20 - t), text, font=font, fill=255)
    # Knock small holes out of the letters, and speckle the colour darker.
    holes = grunge((w, h), 85, 1.0)
    mask = ImageChops.subtract(mask, holes.point(lambda v: v * 0.85))
    spots = grunge((w, h), 110, 2.0)
    fill = Image.composite(Image.new('RGB', (w, h), dark), Image.new('RGB', (w, h), color), spots.point(lambda v: v * 0.8))
    rgba = fill.convert('RGBA'); rgba.putalpha(mask)
    return rgba, mask


def render(bg_path, out, line1, line2):
    random.seed(7)
    bg = Image.open(bg_path).convert('RGB')
    W, H = bg.size
    margin = int(W * 0.06)
    f1 = fit(line1, W - 2 * margin, int(W * 0.16))
    f2 = fit(line2, W - 2 * margin, int(W * 0.26))
    l1, m1 = layer(line1, f1, (236, 233, 228), (150, 145, 140))
    l2, m2 = layer(line2, f2, (214, 18, 22), (120, 8, 10))

    # Text sits in the empty dark area at the bottom, but ends well inside the 3:4 centre crop
    # Instagram shows on the profile grid.
    gap = int(W * 0.005)
    y2 = (H + W * 4 // 3) // 2 - l2.height - int(H * 0.06)
    y1 = y2 - l1.height + gap
    canvas = bg.convert('RGBA')
    for lay, m, y in ((l1, m1, y1), (l2, m2, y2)):
        x = (W - lay.width) // 2
        shadow = Image.new('RGBA', lay.size, (0, 0, 0, 0)); shadow.putalpha(m.filter(ImageFilter.GaussianBlur(14)).point(lambda v: v * 0.9))
        canvas.alpha_composite(shadow, (x + 10, y + 14))
        outline = Image.new('RGBA', lay.size, (10, 5, 5, 0)); outline.putalpha(m.filter(ImageFilter.MaxFilter(7)))
        canvas.alpha_composite(outline, (x, y))
        canvas.alpha_composite(lay, (x, y))
    rgb = canvas.convert('RGB')
    # Standard reel size keeps files small (Dropbox space); YouTube rejects over 2 MB.
    if W > 1080:
        rgb = rgb.resize((1080, round(H * 1080 / W)), Image.LANCZOS)
        if rgb.height > 1920:  # trim the extra off the top so it's exactly 9:16
            rgb = rgb.crop((0, rgb.height - 1920, 1080, rgb.height))
    # Instagram covers must be JPEG.
    for q in (90, 85, 80, 75):
        rgb.save(out, 'JPEG', quality=q)
        if os.path.getsize(out) < 1_900_000: break

if __name__ == '__main__':
    if len(sys.argv) == 5:
        render(*sys.argv[1:5])
        print(sys.argv[2])
        sys.exit()
    texts = json.loads((ROOT / 'covers' / 'texts.json').read_text())
    outdir = ROOT / 'tmp' / 'thumbnails'
    outdir.mkdir(parents=True, exist_ok=True)
    found = {p.stem: p for p in sorted((ROOT / 'covers' / 'backgrounds').glob('*'))
             if p.suffix.lower() in ('.jpg', '.jpeg', '.png', '.webp')}
    # Reels without their own background take turns on _default_1, _default_2, _default_3…
    # in texts.json (sheet) order. A single _default.* also works.
    defaults = [found.pop(k) for k in sorted(k for k in list(found) if k.startswith('_default'))]
    for p in found:
        if p not in texts: print(f'! {p}: no text in covers/texts.json, skipped')
    own = 0
    for i, (reel, (line1, line2)) in enumerate(texts.items()):
        bg = found.get(reel) or (defaults[i % len(defaults)] if defaults else None)
        if not bg: continue
        own += reel in found
        out = outdir / f'{reel}.jpg'
        render(bg, out, line1, line2)
        print(f'✓ {out.relative_to(ROOT)}' + ('' if reel in found else f'  ({bg.name})'))
    print(f'{own} with their own background, {len(texts) - own} ' + ('on the defaults.' if defaults else 'still need one.'))
