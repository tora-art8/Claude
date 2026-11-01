# Test için özgün, sentetik bir "manga sayfası" üretir (telifli içerik yok).
# Kullanım: python3 test/ornek-sayfa-uret.py
import os, random
from PIL import Image, ImageDraw, ImageFont

random.seed(7)
OUT = os.path.join(os.path.dirname(__file__), 'ornek')
os.makedirs(OUT, exist_ok=True)
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'


def font(sz):
    try:
        return ImageFont.truetype(FONT, sz)
    except Exception:
        return ImageFont.load_default()


def screentone(d, box, step=7, r=1.6):
    x0, y0, x1, y1 = box
    for y in range(int(y0), int(y1), step):
        off = (step // 2) if (y // step) % 2 else 0
        for x in range(int(x0) + off, int(x1), step):
            d.ellipse([x - r, y - r, x + r, y + r], fill=(60, 60, 60))


def figure(d, cx, cy, s):
    # basit, özgün çöp-adam benzeri karakter
    d.ellipse([cx - s, cy - s, cx + s, cy + s], outline='black', width=4, fill=(235, 235, 235))
    d.ellipse([cx - s * .45, cy - s * .2, cx - s * .2, cy + s * .1], fill='black')
    d.ellipse([cx + s * .2, cy - s * .2, cx + s * .45, cy + s * .1], fill='black')
    d.arc([cx - s * .4, cy + s * .1, cx + s * .4, cy + s * .6], 20, 160, fill='black', width=3)
    d.line([cx, cy + s, cx, cy + s * 2.6], fill='black', width=5)
    d.line([cx - s * 1.2, cy + s * 1.6, cx + s * 1.2, cy + s * 1.6], fill='black', width=5)


def bubble(d, box, lines, tail=None, fs=24, shape='ellipse'):
    x0, y0, x1, y1 = box
    if tail:  # kuyruk: balonun içinden başlayıp dışarı uzanan kapalı üçgen
        d.polygon(tail, fill='white')
        d.line(tail + [tail[0]], fill='black', width=4)
    if shape == 'ellipse':
        d.ellipse(box, fill='white', outline='black', width=4)
    else:
        d.rectangle(box, fill='white', outline='black', width=4)
    if tail:  # balon çizgisinin kuyruk ağzındaki kısmını sil (kuyruk balona açılsın)
        cx = sum(p[0] for p in tail) / 3
        cy = sum(p[1] for p in tail) / 3
        d.polygon([(cx + (p[0] - cx) * 0.75, cy + (p[1] - cy) * 0.75) for p in tail], fill='white')
        if shape == 'ellipse':
            d.ellipse([x0 + 4, y0 + 4, x1 - 4, y1 - 4], fill='white')
    f = font(fs)
    lh = fs * 1.2
    cy = (y0 + y1) / 2 - (len(lines) - 1) * lh / 2
    for i, t in enumerate(lines):
        d.text(((x0 + x1) / 2, cy + i * lh), t, fill='black', font=f, anchor='mm')


def page1():
    W, H = 1000, 1500
    im = Image.new('RGB', (W, H), 'white')
    d = ImageDraw.Draw(im)
    # Paneller
    panels = [(30, 30, 970, 520), (30, 545, 480, 1050), (505, 545, 970, 1050), (30, 1075, 970, 1470)]
    for p in panels:
        d.rectangle(p, outline='black', width=5)
    # Panel 1: arka plan tonu + karakterler
    screentone(d, (35, 300, 965, 515))
    figure(d, 250, 300, 55)
    figure(d, 760, 310, 55)
    bubble(d, (560, 60, 940, 230), ['HEY! WAIT FOR ME!', 'YOU PROMISED WE', 'WOULD GO TOGETHER!'],
           tail=[(700, 212), (740, 214), (745, 270)], fs=24)
    bubble(d, (70, 70, 400, 200), ["I'M SORRY...", 'I JUST COULDN\'T', 'STAY ANY LONGER.'],
           tail=[(220, 182), (260, 184), (240, 245)], fs=22)
    # Panel 2: anlatım kutusu (dikdörtgen)
    bubble(d, (50, 565, 460, 660), ['THE NEXT MORNING,', 'AT THE OLD STATION...'], fs=22, shape='rect')
    figure(d, 255, 820, 60)
    # Panel 3: efekt sesi (balon dışında) + küçük balon
    d.text((740, 640), 'BOOM!!', fill='black', font=font(78), anchor='mm', stroke_width=3, stroke_fill='white')
    bubble(d, (560, 820, 760, 930), ['WHAT?!'], tail=[(640, 908), (680, 910), (700, 970)], fs=30)
    figure(d, 840, 900, 45)
    # Panel 4: düşünce balonu + uzun cümle
    figure(d, 180, 1250, 60)
    bubble(d, (330, 1100, 940, 1300), ['IF I DON\'T TELL HER THE TRUTH TODAY,', 'I MIGHT NEVER GET', 'ANOTHER CHANCE TO DO IT.'],
           tail=[(400, 1240), (450, 1250), (300, 1330)], fs=24)
    for i, (x, y, r) in enumerate([(285, 1345, 14), (262, 1375, 9)]):
        d.ellipse([x - r, y - r, x + r, y + r], fill='white', outline='black', width=3)
    bubble(d, (560, 1340, 900, 1450), ['OKAY. LET\'S DO THIS.'], fs=24)
    im.save(os.path.join(OUT, 'sayfa1.png'))


def page2():
    W, H = 900, 1300
    im = Image.new('RGB', (W, H), (250, 248, 244))
    d = ImageDraw.Draw(im)
    d.rectangle((25, 25, 875, 1275), outline='black', width=5)
    screentone(d, (30, 700, 870, 1270), step=6, r=1.4)
    figure(d, 450, 900, 90)
    bubble(d, (80, 80, 520, 300), ['YOU IDIOT!!', 'DO YOU HAVE ANY IDEA', 'HOW WORRIED I WAS?!'],
           tail=[(300, 278), (340, 280), (420, 760)], fs=27)
    bubble(d, (560, 360, 840, 520), ['S-SORRY,', 'SENPAI...'], tail=[(700, 498), (730, 500), (520, 800)], fs=26)
    im.convert('RGB').save(os.path.join(OUT, 'sayfa2.jpg'), quality=90)


page1()
page2()
print('Örnek sayfalar üretildi:', OUT)
