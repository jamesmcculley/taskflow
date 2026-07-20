import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { repoRoot, resolveVaultPath } from './env.mjs';

const vault = resolveVaultPath();
const seedDir = path.join(repoRoot, 'test-vault', 'seed');
if (!existsSync(seedDir)) {
	console.error(`Seed directory not found: ${seedDir}`);
	process.exit(1);
}
mkdirSync(vault, { recursive: true });
cpSync(seedDir, vault, { recursive: true, force: true });
console.log(`Copied seeds from ${seedDir} -> ${vault}`);
