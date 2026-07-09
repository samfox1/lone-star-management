import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Not this app: the copilot sub-project (own tooling; its .output/ build
    // artifacts alone OOM eslint) and throwaway HTML mocks.
    "lone-star-agent/**",
    "prototypes/**",
  ]),
]);

export default eslintConfig;
