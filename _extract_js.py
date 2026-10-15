# -*- coding: utf-8 -*-
import re, io, sys, os

path = sys.argv[1]
html = io.open(path, encoding='utf-8').read()
blocks = re.findall(r'<script>(.*?)</script>', html, re.S)
out_dir = os.path.dirname(path)
for i, b in enumerate(blocks):
    fn = os.path.join(out_dir, '_jscheck_%d.js' % i)
    io.open(fn, 'w', encoding='utf-8').write(b)
    print(fn, len(b))
