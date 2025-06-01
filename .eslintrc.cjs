/* eslint-env node */
require("@rushstack/eslint-patch/modern-module-resolution");
module.exports = {
  root: true,
  globals: {
    globalThis: false,
    exec: "readonly",
    getCurrentPages: "readonly",
    uniCloud: "readonly",
    uni: "readonly",
    wx: "readonly",
    getApp: "readonly",
    log: "readonly",
  },
  env: {
    node: true,
    amd: true,
  },
  extends: [
    "./src/unplugin/.eslintrc-auto-import.json",
    "plugin:vue/vue3-essential",
    "eslint:recommended",
    "@vue/eslint-config-typescript",
    "@vue/eslint-config-prettier/skip-formatting",
  ],
  parserOptions: {
    ecmaVersion: "latest",
  },
  rules: {
    "no-empty": 0,
    "prettier/prettier": [
      "warn",
      {
        singleQuote: false,
        trailingComma: "all", // 使用rvest.vs-code-prettier-eslint时, 这里需要配置
        printWidth: 100,
      },
    ],
    "max-len": ["warn", { code: 100, ignoreComments: true, ignoreStrings: true }],
    "prefer-const": [
      "error",
      {
        destructuring: "all",
        ignoreReadBeforeAssign: false,
      },
    ],
    "vue/no-unused-vars": [
      "warn",
      {
        ignorePattern: "^_",
      },
    ],
    "no-unused-vars": ["warn", { vars: "all", args: "after-used", argsIgnorePattern: "^_" }],
    "vue/multi-word-component-names": "off",
  },
};
