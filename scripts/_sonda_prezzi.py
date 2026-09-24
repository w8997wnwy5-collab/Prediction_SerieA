"""Quanto costa davvero salire di piano su The Odds API.

Una raccomandazione che dice "circa trenta dollari" non e' una
raccomandazione: e' un ricordo. I prezzi cambiano, i piani si rinominano, e
questo e' l'unico numero su cui poi si firma. Quindi si va a leggere.

    python3 scripts/_sonda_prezzi.py
"""
import re
import sys
import urllib.error
import urllib.request


def prendi(url):
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (monthline-sonda)',
        'Accept': 'text/html,application/xhtml+xml',
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')[:400]
    except Exception as e:                      # noqa: BLE001
        return None, str(e)[:200]


def main():
    for url in ('https://the-odds-api.com/#get-access',
                'https://the-odds-api.com/'):
        stato, testo = prendi(url)
        print('===', url, '->', stato)
        if stato != 200:
            print('  ', testo[:200])
            continue
        nudo = re.sub(r'<script[\s\S]*?</script>', ' ', testo)
        nudo = re.sub(r'<style[\s\S]*?</style>', ' ', nudo)
        nudo = re.sub(r'<[^>]+>', ' ', nudo)
        nudo = re.sub(r'&nbsp;?', ' ', nudo)
        nudo = re.sub(r'\s+', ' ', nudo)
        # le righe che parlano di soldi o di crediti
        pezzi = re.findall(r'[^.]{0,90}(?:\$\s?\d[\d,]*|\d[\d,]*\s*(?:credits|requests))[^.]{0,90}', nudo, re.I)
        visti = set()
        for p in pezzi:
            p = p.strip()
            if len(p) < 8 or p.lower() in visti:
                continue
            visti.add(p.lower())
            print('  •', p[:180])
        if visti:
            return 0
    return 0


if __name__ == '__main__':
    sys.exit(main())
