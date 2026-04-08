import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const binariesDir = join(projectRoot, 'src-tauri', 'bin');

mkdirSync(binariesDir, { recursive: true });

const nodeRuntimePath = process.execPath;
if (!existsSync(nodeRuntimePath)) {
  throw new Error(`Node runtime was not found at ${nodeRuntimePath}`);
}

const targetTriple = execSync('rustc --print host-tuple').toString().trim();
if (!targetTriple) {
  throw new Error('Failed to determine rust target triple');
}

const targetNodePath = join(binariesDir, `node-${targetTriple}.exe`);
cpSync(nodeRuntimePath, targetNodePath);

console.log(`[desktop-tauri] Embedded runtime prepared: ${targetNodePath}`);
