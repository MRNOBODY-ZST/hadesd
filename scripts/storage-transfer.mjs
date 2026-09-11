import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const directory = resolve(root, 'backend/build/libs');
const files = await readdir(directory).catch(() => []);
const jar = files.find(file => file.endsWith('.jar') && !file.endsWith('-plain.jar'));
if (!jar) throw new Error('Build the backend first: pnpm backend:build');
const child = spawn('java', ['--enable-native-access=ALL-UNNAMED', '-jar', resolve(directory, jar), '--storage-transfer', ...process.argv.slice(2)], {
  cwd: resolve(root, 'backend'), env: process.env, stdio: 'inherit', shell: false,
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
