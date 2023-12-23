//@ts-check

'use strict';

const mode = process.env.NODE_ENV;
const prod = mode === 'production';

const path = require('path');
const webpack = require('webpack');
const { merge } = require('webpack-merge');

const TerserPlugin = require("terser-webpack-plugin");
const sveltePreprocess = require('svelte-preprocess');

/**@type {import('webpack').Configuration}*/
const baseConfig = {
  output: {
    // the bundle is stored in the 'dist' folder (check package.json), 📖 -> https://webpack.js.org/configuration/output/
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    devtoolModuleFilenameTemplate: '../[resource-path]'
  },
  devtool: 'source-map',
  externals: {
    vscode: 'commonjs vscode' // the vscode-module is created on-the-fly and must be excluded. Add other modules that cannot be webpack'ed, 📖 -> https://webpack.js.org/configuration/externals/
  },
  resolve: {
    // support reading TypeScript and JavaScript files, 📖 -> https://github.com/TypeStrong/ts-loader
    mainFields: ['browser', 'module', 'main'], // look for `browser` entry point in imported node modules
    extensions: ['.ts', '.js'],
    fallback: {
      // Webpack 5 no longer polyfills Node.js core modules automatically.
      // see https://webpack.js.org/configuration/resolve/#resolvefallback
      // for the list of Node.js core module polyfills.
    }
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      },
      {
        test: /\.blob$/,
        type: 'asset/source',
      },
      {
				test: /\.svelte$/,
				use: {
					loader: 'svelte-loader',
					options: {
						compilerOptions: {
							dev: !prod
						},
						emitCss: prod,
						hotReload: !prod,
            // @ts-ignore
						preprocess: sveltePreprocess({ sourceMap: !prod })
					}
				}
			}
    ]
  },
  // @ts-ignore
  mode
};

const extensionConfig = merge(
  baseConfig,
  /**@type {import('webpack').Configuration}*/
  {
    name: 'extension',
    target: 'node', // no support for VS Code web 📖 -> https://webpack.js.org/configuration/target/#target
    dependencies: ['payload'],
    entry: {
      extension: './src/extension.ts', // the entry point of this extension, 📖 -> https://webpack.js.org/configuration/entry-context/
    },
    output: {
      libraryTarget: 'commonjs2',
    },
    resolve: {
      alias: {
        'payload.blob': path.resolve(__dirname, 'out/payload.blob')
      }
    }
  }
);

const payloadConfig = merge(
  baseConfig,
  /**@type {import('webpack').Configuration}*/
  {
    name: 'payload',
    target: 'web',
    entry: {
      payload: './src/payload.ts',
    },
    output: {
      path: path.resolve(__dirname, 'out'),
      filename: 'payload.blob'
    },
    optimization: {
      // skips .blob by default
      minimizer: [new TerserPlugin({test: /\.blob(\?.*)?$/i})],
    },

  }
);

const frontendConfig = merge(
  baseConfig,
  /**@type {import('webpack').Configuration}*/
  {
    name: 'frontend',
    target: 'web',
    entry: {
      embedder: './src/embedder.ts',
    },
    resolve: {
      alias: {
        svelte: path.resolve('node_modules', 'svelte/src/runtime')
      },
      extensions: ['.mjs', '.js', '.ts', '.svelte'],
      mainFields: ['svelte', 'browser', 'module', 'main'],
      conditionNames: ['svelte', 'browser']
    }
  }
);

const config = [extensionConfig, payloadConfig, frontendConfig];
module.exports = config;