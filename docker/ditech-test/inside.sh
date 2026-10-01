#!/usr/bin/env bash
# Runs inside the runner container (see docker-compose.yml).
# MODE: all | unit | e2e; PATTERN: optional jest path pattern for e2e.
set -uo pipefail
MODE="${MODE:-all}"
PATTERN="${PATTERN:-}"
API=http://localhost:3000/api
out=/out
mkdir -p "$out"

command -v pnpm >/dev/null || npm i -g pnpm@9 >/dev/null 2>&1
echo "== install"
pnpm install --frozen-lockfile > "$out/install.log" 2>&1 || { tail -20 "$out/install.log"; exit 1; }
echo "== build"
pnpm build:server > "$out/build.log" 2>&1 || { tail -40 "$out/build.log"; exit 1; }
cd packages/server
echo "== typecheck"
if npx tsc --noEmit -p tsconfig.json > "$out/typecheck.log" 2>&1; then echo "typecheck ok"; else echo "typecheck FAILED"; tail -30 "$out/typecheck.log"; exit 1; fi

status=0
if [ "$MODE" = all ] || [ "$MODE" = unit ]; then
  echo "== unit tests"
  npx jest --ci > "$out/unit.log" 2>&1 || status=1
  grep -E "^(Tests|Test Suites):" "$out/unit.log"
  grep -E "^FAIL " "$out/unit.log" | sort -u
fi
[ "$MODE" = unit ] && exit $status

cat > .env <<EOF
DB_HOST=mariadb
DB_USER=bigcapital
DB_PASSWORD=bigcapital
DB_ROOT_PASSWORD=root
DB_CHARSET=utf8
SYSTEM_DB_NAME=bigcapital_system
TENANT_DB_NAME_PERFIX=bigcapital_tenant_
BASE_URL=http://localhost:3000
APP_JWT_SECRET=test-app-jwt-secret
SIGNUP_DISABLED=false
SIGNUP_EMAIL_CONFIRMATION=false
THROTTLE_GLOBAL_TTL=60000
THROTTLE_GLOBAL_LIMIT=100000
THROTTLE_AUTH_TTL=60000
THROTTLE_AUTH_LIMIT=100000
REDIS_HOST=redis
REDIS_PORT=6379
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=test-access-key
S3_SECRET_ACCESS_KEY=test-secret-key
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=test-bucket
MAIL_HOST=localhost
MAIL_PORT=1025
MAIL_FROM_NAME=Bigcapital
MAIL_FROM_ADDRESS=test@bigcapital.app
DITECH_ENFORCE_GATEWAY=false
EOF

echo "== database"
node -e "
const m=require('mysql2/promise');
(async()=>{const c=await m.createConnection({host:'mariadb',user:'root',password:'root'});
await c.query(\"GRANT ALL PRIVILEGES ON *.* TO 'bigcapital'@'%' WITH GRANT OPTION\");await c.query('FLUSH PRIVILEGES');await c.end();})().catch(e=>{console.error(e.message);process.exit(1)})" || exit 1
node dist/cli.js system:migrate:latest > "$out/migrate.log" 2>&1 || { tail -20 "$out/migrate.log"; exit 1; }

echo "== seed test organization"
NODE_ENV=production node dist/main > "$out/server.log" 2>&1 &
pid=$!
for i in $(seq 1 90); do curl -sf "$API/auth/meta" >/dev/null && break; sleep 2; done
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log($1)})"; }
curl -sf -X POST "$API/auth/signup" -H 'content-type: application/json' \
  -d '{"firstName":"Test","lastName":"User","email":"kk@kk.com","password":"1231231230"}' >/dev/null || { echo "signup failed"; tail -30 "$out/server.log"; exit 1; }
signin=$(curl -sf -X POST "$API/auth/signin" -H 'content-type: application/json' -d '{"email":"kk@kk.com","password":"1231231230"}')
token=$(printf '%s' "$signin" | json 'j.access_token')
org=$(printf '%s' "$signin" | json 'j.organization_id')
build=$(curl -sf -X POST "$API/organization/build" -H 'content-type: application/json' \
  -H "authorization: Bearer $token" -H "organization-id: $org" \
  -d '{"name":"Test Organization","location":"US","baseCurrency":"USD","timezone":"America/New_York","fiscalYear":"january","language":"en"}')
job=$(printf '%s' "$build" | json 'j.data.job_id ?? j.data.jobId')
state=
for i in $(seq 1 90); do
  state=$(curl -sf "$API/organization/build/$job" -H "authorization: Bearer $token" -H "organization-id: $org" | json 'j.state')
  [ "$state" = completed ] || [ "$state" = failed ] && break
  sleep 3
done
kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
[ "$state" = completed ] || { echo "organization build: $state"; tail -40 "$out/server.log"; exit 1; }

echo "== e2e tests ${PATTERN:+($PATTERN)}"
npx jest --ci --config ./test/jest-e2e.json --forceExit ${PATTERN:+"$PATTERN"} > "$out/e2e.log" 2>&1 || status=1
grep -E "^(Tests|Test Suites):" "$out/e2e.log"
grep -E "^FAIL " "$out/e2e.log" | sort -u
exit $status
