import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';

export default defineConfig([
  ...nextVitals,
  {
    // These compiler-readiness checks were added by the Next 16 flat-config
    // migration. Keep the existing findings visible without making this
    // reliability patch a project-wide React Compiler refactor. Rules of Hooks
    // and all other correctness/accessibility errors remain enforced.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
    },
  },
  globalIgnores(['.next/**', 'node_modules/**', 'next-env.d.ts']),
]);
