// 빌드: src의 네 파일을 한 장의 HTML로 합친다. 번들러 없이 문자열 치환만 한다.
//   node build.mjs  →  docs/index.html  (GitHub Pages가 /docs 폴더를 그대로 서비스한다)
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const read = (name) => readFile(new URL(`./src/${name}`, import.meta.url), 'utf8');
const [html, css, core, app] = await Promise.all([read('index.html'), read('styles.css'), read('core.js'), read('app.js')]);

// 모듈 경계만 걷어 낸다. 한 <script type="module"> 안에서는 같은 스코프를 쓰므로 export/import가 필요 없다.
const coreInline = core.replace(/^export (?=(const|function|class) )/gm, '');
const appInline = app.replace(/^\/\/ @ts-check\n/, '').replace(/^import\s*\{[\s\S]*?\}\s*from\s*'\.\/core\.js';\n/m, '');

if (/^\s*(import|export)\s/m.test(coreInline + appInline)) throw new Error('모듈 구문이 남아 있습니다');
if (/<\/script/i.test(coreInline + appInline)) throw new Error('스크립트 안에 </script 가 있습니다');
if (/<\/style/i.test(css)) throw new Error('스타일 안에 </style 이 있습니다');

// 치환 문자열의 $ 패턴이 해석되지 않도록 함수로 넘긴다
const out = html.replace('/*@css*/', () => css.trimEnd()).replace('/*@js*/', () => `${coreInline.trimEnd()}\n\n${appInline.trimEnd()}`);
if (out.includes('/*@')) throw new Error('채워지지 않은 자리가 있습니다');

await mkdir(new URL('./docs/', import.meta.url), { recursive: true });
await writeFile(new URL('./docs/index.html', import.meta.url), out);
console.log(`docs/index.html  ${(Buffer.byteLength(out) / 1024).toFixed(1)} KB`);
