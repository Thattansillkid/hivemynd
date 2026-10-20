// Lints with Obsidian's official plugin rules (the same family the community
// directory's automated review uses). Run: npx eslint src
import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
  { ignores: ['main.js', 'node_modules/**', 'bridge/**', 'demo-vault/**', 'esbuild.config.mjs', 'version-bump.mjs'] },
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.*'] },
      },
    },
  },
]);
