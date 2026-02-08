import typescriptEslint from "typescript-eslint";

export default [{
    files: ["**/*.ts"],
}, {
    plugins: {
        "@typescript-eslint": typescriptEslint.plugin,
    },

    languageOptions: {
        parser: typescriptEslint.parser,
        ecmaVersion: 2022,
        sourceType: "module",
    },

    rules: {
        "@typescript-eslint/naming-convention": ["warn", {
            selector: "import",
            format: ["camelCase", "PascalCase"],
        }],

        curly: "warn",
        eqeqeq: "warn",
        "no-throw-literal": "warn",
        semi: "warn",

        // Ban synchronous fs methods - use fs/promises async methods instead
        // Level: warn (will be promoted to error after migration in plans 08-03 through 08-05)
        "no-restricted-syntax": ["warn",
            {
                "selector": "CallExpression[callee.object.name='fs'][callee.property.name=/^(readFileSync|writeFileSync|existsSync|mkdirSync|readdirSync|unlinkSync|rmdirSync)$/]",
                "message": "Avoid synchronous fs methods (fsSync). Use fs/promises async methods instead. Import from 'fs/promises' and use async/await. See src/services/FileService.ts for helpers."
            }
        ],
    },
}, {
    // Exclude test files from the sync fs ban - tests may legitimately use sync methods for setup
    files: ["**/test/**/*.ts", "**/*.test.ts"],
    rules: {
        "no-restricted-syntax": "off",
    },
}];