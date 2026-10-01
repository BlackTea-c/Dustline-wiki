import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = 'BlackTea-c/Dustline-wiki';
const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error('需要 GitHub Actions 的 GITHUB_TOKEN，不能把 Token 写入文件');
if (process.env.GITHUB_REPOSITORY && process.env.GITHUB_REPOSITORY.toLowerCase() !== repo.toLowerCase()) throw new Error('仅用于指定的 Dustline-wiki 仓库');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/entries.json'), 'utf8'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function github(route, options = {}) {
  const response = await fetch('https://api.github.com/repos/' + repo + route, { ...options,
    headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2026-03-10',
      'Content-Type': 'application/json', 'User-Agent': 'Dustline-wiki-sync' } });
  if (!response.ok) throw new Error('GitHub 请求失败：HTTP ' + response.status + '；已有评论区不会删除，重新运行会继续。');
  return response.json();
}
const issues = [];
for (let page = 1; page <= 50; page += 1) {
  const batch = await github('/issues?state=all&per_page=100&page=' + page);
  issues.push(...batch.filter(issue => !issue.pull_request && ['blacktea-c', 'github-actions[bot]'].includes(String(issue.user?.login).toLowerCase())));
  if (batch.length < 100) break;
  if (page === 50) throw new Error('Issue 数量超过同步范围，请人工检查');
}
const threads = {};
for (const entry of data.entries.filter(entry => entry.enabled !== false)) {
  const marker = '<!-- dustline-entry:' + entry.id + ' -->';
  const matches = issues.filter(issue => String(issue.body || '').includes(marker));
  if (matches.length > 1) throw new Error('重复的词条评论区：' + entry.title);
  let issue = matches[0];
  // 作者手动关闭的评论区不自动重开；映射仍保留，前端/提交服务会显示状态。
  if (!issue) {
    const body = [marker, '# ' + entry.title + ' · 玩家补充与吐槽', '', '此处用于玩家的资料补充、感想与吐槽。', '',
      '内容默认收在 Wiki 的折叠栏里，可能包含剧透；玩家观点不会自动变成作者设定。', '',
      '作者基础文章在 data/entries.json 中单独维护。', '', '词条编号：' + entry.id].join('\n');
    issue = await github('/issues', { method: 'POST', body: JSON.stringify({ title: '[词条评论] ' + entry.title, body }) });
    console.log('已建立评论区：' + entry.title + ' #' + issue.number);
    await pause(1300); // 建立大量 Issue 时控制写入频率。
  }
  threads[entry.id] = { issue_number: issue.number, comment_count: issue.comments, state: issue.state };
}
const manifest = { schema_version: 1, repository: repo, threads };
fs.writeFileSync(path.join(root, 'data/discussions.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log('评论区映射已更新，共 ' + Object.keys(threads).length + ' 条。');
