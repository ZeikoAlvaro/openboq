# -*- coding: utf-8 -*-
"""Genera el archivo de datos de OpenBOQ desde los CSV maestros
de catalogos de precios unitarios en formato .DAT/.NBD.
NO toca ningun archivo original."""
import csv, json, os, sys, unicodedata

AQUI = os.path.dirname(os.path.abspath(__file__))
SRC = os.environ.get("OPENBOQ_CSV", os.path.join(AQUI, "..", "data"))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
os.makedirs(OUT, exist_ok=True)

def f(v, d=0.0):
    try:
        return round(float(v), 6)
    except Exception:
        return d

CAT = os.environ.get('OPENBOQ_CATALOGO', os.path.join(SRC, 'catalogo.csv'))
COMP = os.environ.get('OPENBOQ_COMPONENTES', os.path.join(SRC, 'componentes.csv'))
if not (os.path.exists(CAT) and os.path.exists(COMP)):
    sys.exit('No se encontraron los CSV de origen.\n  catalogo:    %s\n  componentes: %s\n'
             'Se pueden indicar con las variables OPENBOQ_CATALOGO y OPENBOQ_COMPONENTES.' % (CAT, COMP))

cat = list(csv.DictReader(open(CAT, encoding='utf-8-sig')))
comp = list(csv.DictReader(open(COMP, encoding='utf-8-sig')))

TIPO = {'M': 'M', 'O': 'O', 'E': 'E', 'I': 'I'}

# --- bases ---
bases = {}
for r in cat:
    b = r['Fuente']
    bases.setdefault(b, {'nombre': b, 'archivo': r['Archivo DAT'], 'ins': {}, 'apus': {}})

# --- insumos y apus por base ---
for r in cat:
    b = bases[r['Fuente']]
    seq = int(r['Secuencia'])
    t = TIPO.get(r['Tipo'], 'M')
    desc = (r['Descripcion'] or '').strip()
    und = (r['Unidad'] or '').strip()
    if t == 'I':
        b['apus'][seq] = {
            'seq': seq,
            'cod': (r['Puntero o Codigo'] or '').strip(),
            'd': desc, 'u': und, 'c': []
        }
    else:
        b['ins'][seq] = {'seq': seq, 't': t, 'd': desc, 'u': und,
                         'p': f(r['Precio Detectado'])}

# --- componentes ---
huerf = 0
for r in comp:
    b = bases[r['Fuente']]
    apuseq = None
    # el APU se identifica por 'APU Codigo' que es la Secuencia del catalogo
    try:
        apuseq = int(r['APU Codigo'])
    except Exception:
        continue
    apu = b['apus'].get(apuseq)
    if apu is None:
        huerf += 1
        continue
    iseq = int(r['Insumo Codigo'])
    apu['c'].append([iseq, f(r['Cantidad/Rendimiento']), int(r['Slot'])])

print('componentes huerfanos:', huerf)

# --- normalizacion de unidades para busqueda ---
def norm(s):
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().upper()
    return ' '.join(s.split())

DB = {'version': '1.0', 'bases': []}
tot_apu = tot_ins = 0
for name in sorted(bases):
    b = bases[name]
    ins = [b['ins'][k] for k in sorted(b['ins'])]
    apus = [b['apus'][k] for k in sorted(b['apus'])]
    # se conservan tambien los APU sin componentes
    imap = {i['seq']: i for i in ins}
    for a in apus:
        a['c'].sort(key=lambda x: x[2])
        m = o = e = 0.0
        for iseq, q, slot in a['c']:
            i = imap.get(iseq)
            if not i:
                continue
            # subtotales sin redondeo por linea (verificado contra los
            # subtotales guardados en los archivos .PRE de origen)
            v = q * i['p']
            if i['t'] == 'M':
                m += v
            elif i['t'] == 'O':
                o += v
            elif i['t'] == 'E':
                e += v
        a['tm'] = round(m, 4)
        a['to'] = round(o, 4)
        a['te'] = round(e, 4)
    DB['bases'].append({
        'id': len(DB['bases']) + 1,
        'n': name,
        'f': b['archivo'],
        'ins': [[i['seq'], i['t'], i['d'], i['u'], i['p']] for i in ins],
        'apus': [[a['seq'], a['cod'], a['d'], a['u'], a['tm'], a['to'], a['te'], a['c']] for a in apus],
    })
    tot_apu += len(apus)
    tot_ins += len(ins)

DB['stats'] = {'bases': len(DB['bases']), 'apus': tot_apu, 'insumos': tot_ins,
               'componentes': len(comp)}
print(DB['stats'])

js = 'window.OPENBOQ_DB=' + json.dumps(DB, ensure_ascii=False, separators=(',', ':')) + ';'
p = os.path.join(OUT, 'catalogo.js')
open(p, 'w', encoding='utf-8').write(js)
print('escrito', p, round(os.path.getsize(p) / 1048576, 2), 'MB')
