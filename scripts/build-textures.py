"""Converts the raw imagery in .cache-data into the textures in public/tex.

Requires: pip install numpy pillow OpenEXR
Planet maps come from Solar System Scope (CC BY 4.0), via Wikimedia Commons,
saved as .cache-data/ss_<name>.jpg.
"""
import numpy as np
import OpenEXR
import Imath
from PIL import Image

SRC = '.cache-data/'
OUT = 'public/tex/'


def milky_way():
    # NASA/GSFC SVS Deep Star Maps 2020, starless Milky Way, equatorial,
    # RA = 0h at the centre increasing to the left.
    f = OpenEXR.InputFile(SRC + 'milkyway_2020_8k.exr')
    dw = f.header()['dataWindow']
    w, h = dw.max.x - dw.min.x + 1, dw.max.y - dw.min.y + 1
    pt = Imath.PixelType(Imath.PixelType.FLOAT)
    img = np.stack([np.frombuffer(f.channel(c, pt), dtype=np.float32).reshape(h, w) for c in 'RGB'], -1)[::2, ::2]
    scale = np.percentile(img.mean(-1), 99.95)
    x = np.clip(img / scale, 0, 1)
    # Square-root encoding keeps faint detail in 8 bits; the shader squares it back.
    Image.fromarray((np.power(x, 0.5) * 255 + 0.5).astype(np.uint8)).save(OUT + 'milkyway.jpg', quality=80, optimize=True, progressive=True)


def moon():
    Image.open(SRC + 'lroc_color_poles_2k.tif').convert('RGB').save(OUT + 'moon.jpg', quality=90)
    # Normal map from the LOLA elevation model.
    hgt = np.asarray(Image.open(SRC + 'ldem_3_8bit.jpg'), dtype=np.float32) / 255.0
    dx = np.roll(hgt, -1, 1) - np.roll(hgt, 1, 1)
    dy = np.roll(hgt, -1, 0) - np.roll(hgt, 1, 0)
    n = np.stack([-dx * 6, dy * 6, np.ones_like(hgt)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8)).save(OUT + 'moon_normal.jpg', quality=90)


def planets():
    sizes = {'sun': 1024, 'mercury': 1024, 'venus_atmosphere': 1024, 'earth': 2048, 'mars': 2048,
             'jupiter': 2048, 'saturn': 2048, 'uranus': 1024, 'neptune': 1024}
    for name, size in sizes.items():
        im = Image.open(SRC + f'ss_{name}.jpg').convert('RGB')
        if im.size[0] != size:
            im = im.resize((size, size // 2), Image.LANCZOS)
        im.save(OUT + name.replace('_atmosphere', '') + '.jpg', quality=85, optimize=True)


if __name__ == '__main__':
    milky_way()
    moon()
    planets()
