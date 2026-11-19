// Configuración única e idempotente. Nunca borra datos ni sobrescribe .env. Uso: node tools/setup.mjs
import { copyFileSync, existsSync, statSync } from 'node:fs';
import { ROOT, findCompose, ok, run, venvPy, waitDb } from './lib.mjs';

process.chdir(ROOT);
const paso = (m) => console.log(`==> ${m}`);
const fallar = (m) => { console.error(`ERROR: ${m}`); process.exit(1); };
const must = (status, what) => status === 0 || fallar(`falló: ${what}`);

paso('Verificando requisitos');
const faltan = [];
const compose = findCompose();
if (!compose) faltan.push('falta: docker compose o podman compose (instala Docker o Podman)');
const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 6)) faltan.push('falta: node >= 22.6 (instala desde nodejs.org)');
// Windows no trae python3: el instalador de python.org deja `python` y el lanzador `py`.
const python = [['python3'], ['python'], ['py', '-3']].find(([c, ...a]) =>
  ok(c, [...a, '-c', 'import sys; sys.exit(sys.version_info < (3, 11))']));
if (!python) faltan.push('falta: python >= 3.11 (instala desde python.org)');
if (faltan.length) { console.error(faltan.join('\n')); process.exit(1); }

paso('Configurando .env');
if (existsSync('.env')) console.log('.env existente conservado');
else { copyFileSync('.env.example', '.env'); console.log('.env creado'); }
process.loadEnvFile('.env');

paso('Iniciando base de datos');
const [bin, ...sub] = compose;
must(run(bin, [...sub, 'up', '-d', 'db']), 'compose up');
if (!(await waitDb(compose, process.env.POSTGRES_USER))) {
  run(bin, [...sub, 'logs', '--tail', '30', 'db']);
  fallar('la base de datos no respondió en 60 s');
}

paso('Instalando dependencias de Node');
const mtime = (f) => (existsSync(f) ? statSync(f).mtimeMs : 0);
for (const d of ['rescue-map', 'server', 'mobile']) {
  if (!existsSync(`${d}/package.json`)) console.log(`AVISO: ${d} no existe, omitido`);
  else if (mtime(`${d}/node_modules/.package-lock.json`) > mtime(`${d}/package-lock.json`)) console.log(`${d}: al día`);
  else must(run('npm', ['ci', '--prefix', d]), `npm ci en ${d}`);
}

paso('Preparando Python y modelo de riesgo');
const py = venvPy();
if (!existsSync(py)) {
  const [c, ...a] = python;
  must(run(c, [...a, '-m', 'venv', 'atalaia/.venv']), 'crear venv');
  must(run(py, ['-m', 'pip', 'install', '-r', 'atalaia/requirements.txt']), 'pip install');
}
must(
  run(py, ['-c', "import sys; sys.path.insert(0, 'atalaia/src/models'); import predict; r = predict.predecir({'county_fips': '48201'}); assert r['status'] == 'success', r; print('modelo de riesgo ok:', r['nivel_riesgo'])"],
    { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }),
  'prueba del modelo de riesgo',
);

paso('Aplicando migraciones');
if (existsSync('server/package.json')) must(run('npm', ['--prefix', 'server', 'run', 'migrate']), 'migraciones');
else console.log('AVISO: server no existe, omitido');

console.log('Siguiente: node tools/dev.mjs');
