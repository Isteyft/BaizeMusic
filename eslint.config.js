import eslint from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import eslintPrettier from 'eslint-plugin-prettier'
import importSort from 'eslint-plugin-simple-import-sort'
import tseslint from 'typescript-eslint'

const ignores = ['dist', 'build', '**/*.js', '**/*.mjs', '**/*.d.ts', 'eslint.config.js', 'commitlint.config.cjs']

// 前端配置
const frontendBuilderConfig = {
    files: ['apps/frontend/builder/**/*.{ts,tsx}'],
    languageOptions: {
        ecmaVersion: 2020,
        globals: globals.browser,
    },
    plugins: {
        'react-hooks': reactHooks,
        'react-refresh': reactRefresh,
    },
    rules: {
        ...reactHooks.configs.recommended.rules,
        'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
        'no-console': 'error',
    },
}
// 后端配置
const backendBuilderConfig = {
    files: ['apps/backend/**/*.ts'],
    languageOptions: {
        globals: {
            ...globals.node,
            ...globals.jest,
        },
        parser: tseslint.parser,
    },
    rules: {
        '@typescript-eslint/explicit-function-return-type': 'off',
        '@typescript-eslint/explicit-module-boundary-types': 'off',
        '@typescript-eslint/interface-name-prefix': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        'no-console': 'error',
    },
}
// 合并配置
export default tseslint.config(
    {
        ignores,
        extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
        plugins: {
            prettier: eslintPrettier,
            'simple-import-sort': importSort,
        },
        rules: {
            'prettier/prettier': 'error',
            'simple-import-sort/imports': 'error',
            '@typescript-eslint/no-explicit-any': 'off',
        },
    },
    frontendBuilderConfig,
    backendBuilderConfig
)
