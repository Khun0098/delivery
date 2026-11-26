import base64, json, pathlib
d = pathlib.Path(__file__).parent
imgs = {}
for p in (d/'img').glob('*.jpg'):
    imgs[p.stem] = 'data:image/jpeg;base64,' + base64.b64encode(p.read_bytes()).decode()
src = (d/'src.html').read_text().replace('{{IMGS}}', json.dumps(imgs))
(d/'artifact.html').write_text(src)
head = '<!doctype html>\n<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0}</style>\n'
body = src.replace('<title>','<title>',1)
(d/'index.html').write_text(head + body + '\n</body></html>\n')
print(len(src)//1024,'KB')
