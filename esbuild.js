import { build } from "esbuild";
import replace from 'esbuild-plugin-text-replace'
import { polyfillNode } from "esbuild-plugin-polyfill-node";

// TEMP because of https://github.com/stellar/js-stellar-base/issues/749
const regex = /if\s*\(\s*[a-zA-Z_$][\w$]*\.lt\s*\(\s*[a-zA-Z_$][\w$]*\s*\)\s*\)\s*throw\s+new\s+Error\s*\(\s*["'`]Invalid\s+baseFee,\s+it\s+should\s+be\s+at\s+least\s*["'`]\.concat\s*\(\s*[a-zA-Z_$][\w$]*\s*,\s*["'`]\s*stroops\.\s*["'`]\s*\)\s*\);/g;

build({
    bundle: true,
	format: 'esm',
	charset: 'utf8',
	outfile: "dist/index.js",
	entryPoints: ["src/index.ts"],
	minify: true,
	sourcemap: true,
	logLevel: 'silent',
	resolveExtensions: ['.tsx', '.ts', '.jsx', '.mjs', '.js', '.json'],
	mainFields: ['worker', 'browser', 'module', 'jsnext', 'main'],
	conditions: ['worker', 'browser', 'import', 'production'],
    platform: 'neutral',
    plugins: [
		polyfillNode(),
		replace({
			include: /node_modules\/@stellar\/stellar-sdk\/dist\/.*\.js/,
			pattern: [
				[regex, '']
			]
		})
	],
    external: [
		'cloudflare:workers',
	]
});