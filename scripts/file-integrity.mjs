import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readlink } from 'node:fs/promises';
import path from 'node:path';

export async function fileSha256(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

// Record links without following them, preserving the atomic release pointer.
export async function directoryIntegrity(directory) {
  const records = {};
  async function walk(relative = '') {
    const entries = await readdir(path.join(directory, relative), { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      const name = path.join(relative, entry.name);
      const filename = path.join(directory, name);
      if (entry.isDirectory()) await walk(name);
      else if (entry.isSymbolicLink()) records[name] = { link: await readlink(filename) };
      else if (entry.isFile()) records[name] = { sha256: await fileSha256(filename) };
      else throw new Error(`Unsupported backup object: ${name}`);
    }
  }
  await walk();
  return records;
}

export async function verifyDirectory(directory, expected) {
  const actual = await directoryIntegrity(directory);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Restored file integrity mismatch: ${path.basename(directory)}`);
  }
  return Object.keys(actual).length;
}
