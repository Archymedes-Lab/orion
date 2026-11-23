#!/usr/bin/env bash
# Builds and deploys web/ as the orion-web Vercel project (https://orion-web-psi.vercel.app) from the repo root,
# then restores the root .vercel link to the `orion` API project. Usage: web/scripts/deploy.sh   (PROD=--prod by default)
# First time on a machine: cd web && vercel link --project orion-web && vercel pull --yes --environment=production
set -euo pipefail
cd "$(dirname "$0")/../.."
BK=.vercel.orion-backup
[ -e "$BK" ] && { echo "backup already exists; refusing" >&2; exit 1; }
mv .vercel "$BK"
restore() { rm -rf .vercel; mv "$BK" .vercel; echo "restored root .vercel (orion)"; }
trap restore EXIT
mkdir .vercel
python3 - <<'PY'
import json
d=json.load(open('web/.vercel/project.json'))
d.setdefault('settings',{})['rootDirectory']='web'
json.dump(d,open('.vercel/project.json','w'))
PY
cp web/.vercel/.env.production.local .vercel/
vercel build --prod --yes 2>&1 | tail -4
vercel deploy --prebuilt ${PROD:---prod} --yes 2>&1 | tail -6
