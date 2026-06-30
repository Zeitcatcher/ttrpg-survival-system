import tseslint from "typescript-eslint";

// Pillar 1: the core stays system-neutral. The string "pf2e" and any `game.system.*`
// access are banned everywhere EXCEPT src/systems/ (the adapter seam).
export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "*.config.js", "*.config.ts"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/**/*.ts"],
    ignores: ["src/systems/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='game'][property.name='system']",
          message: "Access game.system only inside src/systems/ (Pillar 1: core is system-neutral).",
        },
        {
          selector: "Literal[value='pf2e']",
          message: "The string 'pf2e' may only appear in src/systems/ (Pillar 1: core is system-neutral).",
        },
      ],
    },
  },
);
