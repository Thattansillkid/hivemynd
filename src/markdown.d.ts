// MANUAL.md is bundled as text (esbuild loader) for the built-in user manual.
declare module '*.md' {
  const text: string;
  export default text;
}
