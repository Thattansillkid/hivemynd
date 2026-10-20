// `npm version <x.y.z>` runs this: copies the version into manifest.json and records
// it in versions.json against the current minAppVersion.
import { readFileSync, writeFileSync } from 'node:fs';

const target = process.env.npm_package_version;
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
manifest.version = target;
writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
versions[target] = manifest.minAppVersion;
writeFileSync('versions.json', JSON.stringify(versions, null, 2) + '\n');
