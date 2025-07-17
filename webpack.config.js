require('dotenv').config();

const path = require('path');
const webpack = require('webpack');

// Plugins
const CopyWebpackPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');

const ScratchWebpackConfigBuilder = require('scratch-webpack-configuration');

const commonHtmlWebpackPluginOptions = {
    gtm_id: process.env.GTM_ID || '',
    gtm_env_auth: process.env.GTM_ENV_AUTH || ''
};

const baseConfig = new ScratchWebpackConfigBuilder(
    {
        rootPath: path.resolve(__dirname),
        enableReact: true,
        shouldSplitChunks: false,
        publicPath: 'auto'
    })
    .setTarget('browserslist')
    .merge({
        output: {
            assetModuleFilename: 'static/assets/[name].[hash][ext][query]',
            library: {
                name: 'GUI',
                type: 'umd2'
            }
        },
        resolve: {
            fallback: {
                Buffer: require.resolve('buffer/'),
                stream: require.resolve('stream-browserify')
            }
        }
    })
    .addModuleRule({
        test: /\.(svg|png|wav|mp3|gif|jpg)$/,
        resourceQuery: /^$/, // reject any query string
        type: 'asset' // let webpack decide on the best type of asset
    })
    .addPlugin(new webpack.DefinePlugin({
        'process.env.DEBUG': Boolean(process.env.DEBUG),
        'process.env.GA_ID': `"${process.env.GA_ID || 'UA-000000-01'}"`,
        'process.env.GTM_ENV_AUTH': `"${process.env.GTM_ENV_AUTH || ''}"`,
        'process.env.GTM_ID': process.env.GTM_ID ? `"${process.env.GTM_ID}"` : null
    }))
    .addPlugin(new CopyWebpackPlugin({
        patterns: [
            {
                from: 'node_modules/scratch-blocks/media',
                to: 'static/blocks-media/default'
            },
            {
                from: 'node_modules/scratch-blocks/media',
                to: 'static/blocks-media/high-contrast'
            },
            {
                from: 'src/lib/themes/high-contrast/blocks-media',
                to: 'static/blocks-media/high-contrast',
                force: true
            },
            {
                context: 'node_modules/scratch-vm/dist/web',
                from: 'extension-worker.{js,js.map}',
                noErrorOnMissing: true
            },
            {
                from: 'static/backdrops',
                to: 'static/backdrops'
            }
        ]
    }));

if (!process.env.CI) {
    baseConfig.addPlugin(new webpack.ProgressPlugin());
}

const distConfig = baseConfig.clone()
    .merge({
        entry: {
            'scratch-gui': path.join(__dirname, 'src/index.js')
        },
        output: {
            path: path.resolve(__dirname, 'dist')
        }
    })
    .addExternals(['react', 'react-dom'])
    .addPlugin(
        new CopyWebpackPlugin({
            patterns: [
                {
                    from: 'src/lib/libraries/*.json',
                    to: 'libraries',
                    flatten: true
                }
            ]
        })
    );

const buildConfig = baseConfig.clone()
    .enableDevServer(process.env.PORT || 8601)
    .merge({
        entry: {
            gui: './src/playground/index.jsx',
            blocksonly: './src/playground/blocks-only.jsx',
            compatibilitytesting: './src/playground/compatibility-testing.jsx',
            player: './src/playground/player.jsx'
        },
        output: {
            path: path.resolve(__dirname, 'build')
        }
    })
    .addPlugin(new HtmlWebpackPlugin({
        ...commonHtmlWebpackPluginOptions,
        chunks: ['gui'],
        template: 'src/playground/index.ejs',
        title: 'Scratch 3.0 GUI'
    }))
    .addPlugin(new HtmlWebpackPlugin({
        ...commonHtmlWebpackPluginOptions,
        chunks: ['blocksonly'],
        filename: 'blocks-only.html',
        template: 'src/playground/index.ejs',
        title: 'Scratch 3.0 GUI: Blocks Only Example'
    }))
    .addPlugin(new HtmlWebpackPlugin({
        ...commonHtmlWebpackPluginOptions,
        chunks: ['compatibilitytesting'],
        filename: 'compatibility-testing.html',
        template: 'src/playground/index.ejs',
        title: 'Scratch 3.0 GUI: Compatibility Testing'
    }))
    .addPlugin(new HtmlWebpackPlugin({
        ...commonHtmlWebpackPluginOptions,
        chunks: ['player'],
        filename: 'player.html',
        template: 'src/playground/index.ejs',
        title: 'Scratch 3.0 GUI: Player Example'
    }))
    .addPlugin(new CopyWebpackPlugin({
        patterns: [
            {
                from: 'static',
                to: 'static'
            },
            {
                from: 'extensions/**',
                to: 'static',
                context: 'src/examples'
            }
        ]
    }))
    .addPlugin(new webpack.DefinePlugin({
        'process.env.REACT_APP_GEMINI_API_KEY': JSON.stringify(process.env.REACT_APP_GEMINI_API_KEY)
    }));

const buildDist = process.env.NODE_ENV === 'production' || process.env.BUILD_MODE === 'dist';

module.exports = buildDist ?
    [buildConfig.get(), distConfig.get()] :
    buildConfig.get();