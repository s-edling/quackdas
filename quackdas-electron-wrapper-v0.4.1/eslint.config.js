module.exports = [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'js/pdfjs/**',
      'js/*.min.js',
      'eslint.config.js'
    ]
  },
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        prompt: 'readonly',
        NodeFilter: 'readonly',
        URL: 'readonly',
        Blob: 'readonly',
        FileReader: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        console: 'readonly'
      }
    },
    linterOptions: {
      reportUnusedDisableDirectives: false
    },
    rules: {
      // This codebase is loaded via script tags and shares globals across files.
      // Keep lint useful without forcing module migration.
      'no-undef': 'off',
      'no-unreachable': 'error',
      // Top-level functions are referenced across files and inline handlers.
      'no-unused-vars': 'off',
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-constant-condition': ['warn', { checkLoops: false }]
    }
  },
  {
    files: ['js/pdfjs-bootstrap.js', 'js/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module'
    }
  },
  {
    files: ['main.js', 'preload.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        __dirname: 'readonly',
        module: 'readonly',
        require: 'readonly',
        process: 'readonly',
        Buffer: 'readonly'
      }
    },
    rules: {
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-unused-vars': ['warn', {
        args: 'none',
        ignoreRestSiblings: true,
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_+$'
      }],
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-constant-condition': ['warn', { checkLoops: false }]
    }
  }
];
