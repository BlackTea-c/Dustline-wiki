import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const data = readJson('data/entries.json');
if (data.schema_version !== 1 || data.project !== '尘世命轨' || !Array.isArray(data.entries) || !data.entries.length) throw new Error('基础资料格式错误');
if (new Set(data.entries.map(entry => entry.id)).size !== data.entries.length) throw new Error('词条编号重复');
for (const entry of data.entries) {
  if (!/^dl-[a-f0-9]{16}$/.test(entry.id) || typeof entry.content !== 'string' || entry.title.length < 2
      || !Array.isArray(entry.match_terms) || entry.match_terms.some(term => term !== entry.title)) throw new Error('词条字段或标题匹配名错误：' + entry.title);
}
const safe = { schema_version: 1, project: data.project, community: data.community,
  entries: data.entries.map(({ id, title, category, summary, content, world, enabled, match_terms, discussion, knowledge_scope }) =>
    ({ id, title, category, summary, content, world, enabled, match_terms, discussion, knowledge_scope })) };
const source = fs.readFileSync(path.join(root, 'src/wiki.js'), 'utf8');
if (source.split('__BUNDLED_DATA__').length !== 2) throw new Error('打包占位必须只有一个');
const content = source.replace('__BUNDLED_DATA__', () => JSON.stringify(safe).replace(/</g, '\\u003c'));
new vm.Script(content, { filename: 'wiki.js' }); // 仅编译语法，不执行酒馆脚本。
const template = readJson('src/script-template.json');
const script = { ...template, content };
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/wiki.js'), content, 'utf8');
fs.writeFileSync(path.join(root, 'dist/尘世命轨-正文词条维基.json'), JSON.stringify(script, null, 2) + '\n', 'utf8');
fs.writeFileSync(path.join(root, 'dist/build-receipt.json'), JSON.stringify({ version: readJson('package.json').version, delivery_mode: 'component',
  script_id: script.id, articles: data.entries.length, js_sha256: crypto.createHash('sha256').update(content).digest('hex'),
  source: 'data/entries.json', real_host_checked: false }, null, 2) + '\n', 'utf8');
console.log('已构建酒馆助手脚本，' + data.entries.length + ' 条基础资料；没有执行客户端脚本。');
