import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Export database-owned current objects through the same verified transfer as migration. */
export async function exportS3Media(destination, reportFile) {
  const root = resolve(import.meta.dirname, '..');
  const directory = resolve(root, 'backend/build/libs');
  const files = await readdir(directory).catch(() => []);
  const jar = files.find(file => file.endsWith('.jar') && !file.endsWith('-plain.jar'));
  if (!jar) throw new Error('S3 backup requires the backend JAR; run pnpm backend:build first');
  await mkdir(destination, { recursive: true, mode: 0o700 });
  await new Promise((done, reject) => {
    const child = spawn('java', ['--enable-native-access=ALL-UNNAMED', '-jar', resolve(directory, jar),
      '--storage-transfer', '--from=s3', '--to=local', '--apply'], {
      cwd: resolve(root, 'backend'),
      env: { ...process.env, STORAGE_TARGET_ROOT: resolve(destination), STORAGE_TRANSFER_REPORT: resolve(reportFile) },
      stdio: ['ignore', 'ignore', 'inherit'], shell: false,
    });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? done() : reject(new Error(`S3 backup export failed (${code}); backup is incomplete`)));
  });
  const report = JSON.parse(await readFile(reportFile, 'utf8'));
  if (report.dryRun || report.pending !== 0 || report.examined !== report.copied + report.alreadyPresent)
    throw new Error('S3 backup export did not verify every referenced object');
  return report;
}
