cd "$(dirname "$0")"
python3 -c "
t=open('template.html').read();d=open('site/data.js').read()
open('site/feature-map.html','w').write(t.replace('/*__DATA__*/',d))"
(echo '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>'; cat site/feature-map.html; echo '</body></html>') | sed -e 's#https://cdn.jsdelivr.net/npm/three@0.128.0/#../pkg/package/#g' > site/preview.html
