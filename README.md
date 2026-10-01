# 尘世命轨 · Wiki

《尘世命轨》的正文词条 Wiki：作者基础资料放在这个 GitHub 仓库，玩家补充与吐槽放在每篇词条对应的 GitHub Issue 评论区。酒馆助手脚本只读取公开资料和评论，不需要额外服务。

## 使用方式

在酒馆助手的角色脚本库导入 [dist/尘世命轨-正文词条维基.json](dist/尘世命轨-正文词条维基.json)，手动启用。已有旧版时先停用旧脚本，避免同时运行两份。导入后，酒馆助手会分配新脚本编号并默认停用。

- 132 条作者基础资料随脚本打包，同时支持从仓库刷新。网络失败时使用公开缓存或随脚本资料。
- 只匹配公开文章的完整标题，不读取原世界书正文或激活关键词。
- 点击词条看简介，再打开完整资料。完整资料打开时关闭小浮窗；支持 ×、遮罩、Esc。
- 小浮窗底部可直接展开“玩家评论”，再次点击可收起；完整资料中也保留评论栏。默认收起，展开后才请求 GitHub，长评论在栏内滚动。
- 评论按普通文字显示，不影响作者资料、简介、词条匹配或相关推荐。
- 展开后可点“去 GitHub 评论”，在对应 Issue 中登录 GitHub 账号发表。阅读公开评论无需登录。**不支持匿名发表**，也不在脚本中填写 GitHub 令牌。

脚本按钮为“预览词条”“刷新词条”“Wiki资料”。[demo.html](demo.html) 是本地交互预览，不请求或发表真实评论。

## 作者维护基础资料

编辑 [data/entries.json](data/entries.json) 并保留已有 id。修改 summary 或 facts 时同步修改 content 和阅读版 [基础资料.md](基础资料.md)。`match_terms` 只填文章标题，不从世界书激活关键词或玩家评论推导别名。

当前稿按地球篇整理。隐藏身世、机关、剧情解答和聊天存档没有收入。公开百科资料不等于聊天中的人物已经知情；公开仓库也无法阻止玩家主动浏览全文。

原标题“祁谣”的正文曾写“祁瑶”，这里沿用标题；ALICE、欧洲meta、北美meta 保留原标题。更名时请保留原 id，并明确更新 match_terms。

## 评论区如何建立

发布到 main 后，[同步词条评论区](.github/workflows/sync-wiki.yml) 会自动为每篇基础文章建立一个 Issue，更新 [data/discussions.json](data/discussions.json) 的编号与评论计数。也可以在 GitHub Actions 手动运行。首次建立 132 个评论区可能需要数分钟。

玩家直接在对应 Issue 中写补充或吐槽。没有事前审核；默认折叠的评论可能包含剧透，玩家观点不会自动变成作者设定。作者手动关闭或锁定评论区后，GitHub 将控制能否继续回复；Wiki 保留历史浏览。

若 Actions 未运行成功，脚本会提示评论区尚未建立。请查看 Actions 日志；脚本只会链接仓库作者或 GitHub Actions 建立、与词条编号对应的评论区。

## 仓库文件

```text
data/entries.json             作者文章
data/discussions.json         Issue 编号与计数
src/wiki.js                   酒馆脚本源码
src/script-template.json      酒馆助手导入字段
dist/                         可导入脚本与构建回执
scripts/                      构建和评论区同步
demo.html                     本地交互预览
基础资料.md                    阅读版
```

Node.js 22 或更新版本可执行 `npm run build` 重新打包；无需安装前端依赖。修改源码或文章后推送 main，仓库流程会重新构建 dist。脚本代码更新需重新导入；文章可点“刷新词条”获取。

## 运行依据与边界

酒馆接口依据工作区酒馆助手 4.9.3 的源码和声明，源提交为 `9403f47774962792ae6ac8c08ad9740a723ea872`。使用角色脚本按钮、事件监听与消息显示接口；沿用原版对父页面消息 DOM 的显示增强方式，不写聊天内容、不调用模型、不读取 MVU。

构建回执中的 `real_host_checked: false` 只说明已生成导入包和编译语法，不能代替真实酒馆导入与评论交互验收。`demo.html` 也不能代替真实运行。

GitHub 依据：[公开 Issue 评论可无认证读取](https://docs.github.com/en/rest/issues/comments#list-issue-comments)、[Actions 的 GITHUB_TOKEN 可设置 Issues 权限](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token)。
