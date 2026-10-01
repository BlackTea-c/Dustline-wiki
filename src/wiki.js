(() => {
    'use strict';

    // 只加载作者整理的公开 JSON；绝不回退到原世界书。
    const REPOSITORY = 'BlackTea-c/Dustline-wiki';
    const RAW_BASE = 'https://raw.githubusercontent.com/' + REPOSITORY + '/main/';
    const API_BASE = 'https://api.github.com/repos/' + REPOSITORY;
    const CACHE_KEY = 'dustline-wiki:public-data:v1';
    const BUNDLED_DATA = __BUNDLED_DATA__;
    const LINK_CLASS = 'csmg-wiki-link';
    const POPOVER_CLASS = 'csmg-wiki-popover';
    const DIALOG_CLASS = 'csmg-wiki-dialog';
    const LIVE_INDEX = 'live';
    const DEMO_INDEX = 'demo';
    const STYLE_ID = 'csmg-wiki-style';
    const PREVIEW_BUTTON = '预览词条';
    const REFRESH_BUTTON = '刷新词条';
    const ABOUT_BUTTON = 'Wiki资料';
    const hostWindow = window.parent;
    const hostDocument = hostWindow.document;
    const demoEntries = BUNDLED_DATA.entries.filter(entry => ['李沐子', '夜色', '天衡集团', '蓬莱岛', '地球李家'].includes(entry.title));
    const previewMode = hostWindow.DUSTLINE_WIKI_PREVIEW === true;
    let dataSource = '随脚本基础资料';
    let stopped = false;
    let loadPromise;
    const requests = new Set();
    const stops = [];
    const discussionCache = new Map();
    let focusBeforeDialog;

    let liveIndex = createIndex(BUNDLED_DATA.entries);
    let modal;
    let popover;
    let popoverAnchor;
    let dialogSequence = 0;

    function readLocal(key) {
        try { return JSON.parse(hostWindow.localStorage.getItem(key) || 'null'); } catch { return null; }
    }

    function writeLocal(key, value) {
        try { hostWindow.localStorage.setItem(key, JSON.stringify(value)); } catch { /* 禁用存储时本次仍可使用。 */ }
    }

    function notify(message) {
        if (hostWindow.toastr?.info) hostWindow.toastr.info(message, '尘世命轨 Wiki');
        else console.info('[尘世命轨 Wiki] ' + message);
    }

    async function requestJson(url, options = {}) {
        const { timeout_ms = 12000, ...fetchOptions } = options;
        const controller = new AbortController();
        requests.add(controller);
        const timer = hostWindow.setTimeout(() => controller.abort(), timeout_ms);
        try {
            const response = await fetch(url, { ...fetchOptions, signal: controller.signal, credentials: 'omit' });
            if (!response.ok) {
                let message = response.status === 403 || response.status === 429
                    ? '请求过于频繁或服务暂不可用，请稍后重试。' : '请求失败（' + response.status + '），请稍后重试。';
                const error = new Error(message);
                error.status = response.status;
                throw error;
            }
            return await response.json();
        } finally { hostWindow.clearTimeout(timer); requests.delete(controller); }
    }

    function validData(data) {
        return data?.schema_version === 1 && data.project === '尘世命轨'
            && Array.isArray(data.entries) && data.entries.length > 0 && data.entries.length <= 3000
            && new Set(data.entries.map(entry => entry?.id)).size === data.entries.length
            && data.entries.every(entry => typeof entry?.id === 'string' && /^dl-[a-f0-9]{16}$/.test(entry.id)
                && typeof entry.title === 'string' && entry.title.trim().length >= 2 && entry.title.length <= 100
                && typeof entry.content === 'string' && entry.content.length <= 50000);
    }

    function escapeRegex(value) {
        return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function createIndex(entries) {
        const index = { entries: new Map(), terms: new Map(), regex: null };
        for (const entry of entries) {
            if (!entry || entry.enabled === false) continue;
            const display = String(entry.title || '').trim();
            const keys = (entry.match_terms || [display]).filter(term => term === display && term.length >= 2);
            if (!keys.length) continue;
            const id = entry.id;
            index.entries.set(id, {
                ...entry,
                title: display,
                sourceTitle: display,
                world: String(entry.world || '尘世命轨 · 作者基础资料'),
                content: String(entry.content || '这个词条还没有填写内容。'),
            });

            for (const key of keys) {
                const normalized = key.toLocaleLowerCase();
                const ids = index.terms.get(normalized) ?? [];
                ids.push(id);
                index.terms.set(normalized, ids);
            }
        }

        const terms = [...index.terms.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b));
        if (terms.length) index.regex = new RegExp(terms.map(escapeRegex).join('|'), 'giu');
        return index;
    }

    async function loadLiveIndex() {
        if (loadPromise) return loadPromise;
        loadPromise = (async () => {
            const cached = readLocal(CACHE_KEY);
            let data = validData(cached?.data) ? cached.data : BUNDLED_DATA;
            dataSource = data === BUNDLED_DATA ? '随脚本基础资料' : '本地缓存';
            try {
                if (!previewMode) {
                    const fresh = await requestJson(RAW_BASE + 'data/entries.json', { cache: 'no-cache' });
                    if (!validData(fresh)) throw new Error('远程基础资料格式不正确。');
                    data = fresh;
                    dataSource = 'GitHub 基础资料';
                    writeLocal(CACHE_KEY, { saved_at: Date.now(), data });
                }
            } catch (error) {
                if (!stopped) notify('仓库暂时无法读取，使用' + dataSource + '。');
            }
            if (stopped) return {};
            liveIndex = createIndex(data.entries);
            discussionCache.clear();
            enhanceAllMessages();
            return { entryCount: liveIndex.entries.size, nameCount: liveIndex.terms.size, source: dataSource };
        })();
        try { return await loadPromise; } finally { loadPromise = undefined; }
    }

    function shouldSkipTextNode(node) {
        const parent = node.parentElement;
        if (!parent || !node.nodeValue?.trim()) return true;
        return Boolean(parent.closest([
            'a', 'button', 'code', 'pre', 'script', 'style', 'textarea', 'select', 'input', 'svg',
            '[contenteditable="true"]', `.${LINK_CLASS}`, '.csmg-wiki-header', '.csmg-wiki-note', '.csmg-wiki-community', `.${POPOVER_CLASS}`,
        ].join(',')));
    }

    function enhanceTextContainer(container, index, indexId) {
        if (!container || !index?.regex) return;

        const nodeFilter = hostWindow.NodeFilter;
        const walker = hostDocument.createTreeWalker(container, nodeFilter.SHOW_TEXT, {
            acceptNode: node => shouldSkipTextNode(node) ? nodeFilter.FILTER_REJECT : nodeFilter.FILTER_ACCEPT,
        });
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);

        for (const textNode of nodes) {
            const text = textNode.nodeValue;
            const fragment = hostDocument.createDocumentFragment();
            let lastIndex = 0;
            let changed = false;
            index.regex.lastIndex = 0;

            for (const match of text.matchAll(index.regex)) {
                const label = match[0];
                const start = match.index;
                if (/^[a-z0-9_-]+$/i.test(label) && (/[a-z0-9_]/i.test(text[start - 1] || '') || /[a-z0-9_]/i.test(text[start + label.length] || ''))) continue;
                if (start > lastIndex) fragment.append(hostDocument.createTextNode(text.slice(lastIndex, start)));

                const ids = index.terms.get(label.toLocaleLowerCase()) ?? [];
                if (ids.length) {
                    const link = hostDocument.createElement('button');
                    link.type = 'button';
                    link.className = LINK_CLASS;
                    link.dataset.csmgWikiIndex = indexId;
                    link.dataset.csmgWikiIds = JSON.stringify(ids);
                    link.textContent = label;
                    link.setAttribute('aria-label', `查看“${label}”的尘世命轨资料`);
                    fragment.append(link);
                    changed = true;
                } else {
                    fragment.append(hostDocument.createTextNode(label));
                }
                lastIndex = start + label.length;
            }

            if (!changed) continue;
            if (lastIndex < text.length) fragment.append(hostDocument.createTextNode(text.slice(lastIndex)));
            textNode.replaceWith(fragment);
        }
    }

    function unwrapLinks(root) {
        root.querySelectorAll(`.${LINK_CLASS}`).forEach(link => {
            link.replaceWith(hostDocument.createTextNode(link.textContent));
        });
    }

    function isAssistantMessage(message) {
        return message?.getAttribute('is_user') !== 'true'
            && message?.getAttribute('is_system') !== 'true';
    }

    function enhanceMessage(messageId) {
        const $message = retrieveDisplayedMessage(messageId);
        const element = $message?.get?.(0);
        if (!element) return;
        unwrapLinks(element);
        const message = element.closest('.mes');
        if (isAssistantMessage(message)) enhanceTextContainer(element, liveIndex, LIVE_INDEX);
    }

    function enhanceAllMessages() {
        hostDocument.querySelectorAll('#chat .mes_text').forEach(element => {
            unwrapLinks(element);
            if (isAssistantMessage(element.closest('.mes'))) {
                enhanceTextContainer(element, liveIndex, LIVE_INDEX);
            }
        });
    }

    function installStyle() {
        hostDocument.getElementById(STYLE_ID)?.remove();
        const style = hostDocument.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .${LINK_CLASS} {
                appearance: none; display: inline; padding: 0; margin: 0; border: 0;
                border-bottom: 1px dotted #e4c878; border-radius: 0; background: transparent;
                color: inherit; font: inherit; line-height: inherit; cursor: pointer;
            }
            .${LINK_CLASS}:hover, .${LINK_CLASS}:focus-visible {
                color: #f8e8aa; border-bottom-style: solid; outline: none;
            }
            .${DIALOG_CLASS} {
                position: fixed; inset: 0; z-index: 2147483645; display: none;
                align-items: center; justify-content: center; padding: 1rem;
                color: #eef2ed; background: rgba(5, 9, 13, .78); backdrop-filter: blur(3px);
                font-family: Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
            }
            .${DIALOG_CLASS}.open { display: flex; }
            .csmg-wiki-card {
                box-sizing: border-box; width: min(42rem, calc(100vw - 2rem));
                max-height: min(82vh, 48rem); overflow: auto; padding: 1.2rem 1.35rem 1.4rem;
                color: #f2ead8; background: #12140f; border: 1px solid rgba(242,234,216,.18);
                border-radius: 14px; box-shadow: 0 24px 72px rgba(0,0,0,.62);
            }
            .csmg-wiki-header { position: sticky; top: -1.2rem; z-index: 2; display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin: -1.2rem -1.35rem 0; padding: 1.2rem 1.35rem .8rem; border-bottom: 1px solid rgba(242,234,216,.1); background: #12140f; }
            .csmg-wiki-kicker { color: #e4c878; font-size: 10px; letter-spacing: .14em; }
            .csmg-wiki-title { margin: .35rem 0 0; color: #f2ead8; font-size: 22px; font-weight: 500; letter-spacing: .02em; }
            .csmg-wiki-source { color: #9ed8cf; font-size: 11px; }
            .csmg-wiki-close { flex: 0 0 auto; width: 2rem; height: 2rem; border: 1px solid #ffffff24; border-radius: 50%; color: inherit; background: #ffffff0a; font-size: 1.2rem; cursor: pointer; }
            .csmg-wiki-content { margin-top: 1.1rem; padding-top: 1rem; border-top: 1px solid rgba(242,234,216,.14); color: #d4d9d4 !important; font-size: 12px; line-height: 1.8; white-space: normal; overflow-wrap: anywhere; }
            .csmg-wiki-content.csmg-wiki-plain { white-space: pre-wrap; }
            .csmg-wiki-content * { color: inherit !important; background-color: transparent !important; box-shadow: none !important; }
            .csmg-wiki-content > :first-child { margin-top: 0; }
            .csmg-wiki-content > :last-child { margin-bottom: 0; }
            .csmg-wiki-content p { margin: 0 0 .8em; }
            .csmg-wiki-content p:last-child { margin-bottom: 0; }
            .csmg-wiki-content h1, .csmg-wiki-content h2, .csmg-wiki-content h3, .csmg-wiki-content h4 { margin: 1.25em 0 .55em; padding-bottom: .35em; border-bottom: 1px solid rgba(185,154,104,.24); color: #e8d5ad !important; font-size: 1.08em; font-weight: 500; letter-spacing: .025em; }
            .csmg-wiki-content strong, .csmg-wiki-content b { color: #f0dfb7 !important; font-weight: 600; }
            .csmg-wiki-content .csmg-wiki-link { color: #e4c878 !important; }
            .csmg-wiki-content .csmg-wiki-link:hover, .csmg-wiki-content .csmg-wiki-link:focus-visible { color: #f8e8aa !important; }
            .csmg-wiki-content ul, .csmg-wiki-content ol { margin: .45em 0 .9em; padding-left: 1.5em; }
            .csmg-wiki-content li { margin: .28em 0; padding-left: .15em; }
            .csmg-wiki-content li::marker { color: #b99a68; }
            .csmg-wiki-content blockquote { margin: .9em 0; padding: .65em .9em; border-left: 2px solid #75b8a1; border-radius: 0 7px 7px 0; background: rgba(117,184,161,.07) !important; color: #c7d7ce !important; }
            .csmg-wiki-content hr { margin: 1.1em 0; border: 0; border-top: 1px solid rgba(242,234,216,.15); }
            .csmg-wiki-content code { padding: .12em .35em; border: 1px solid rgba(242,234,216,.12); border-radius: 4px; background: rgba(255,255,255,.06) !important; font-size: .92em; }
            .csmg-wiki-content pre { overflow: auto; padding: .8em; border: 1px solid rgba(242,234,216,.12); border-radius: 8px; background: rgba(0,0,0,.2) !important; white-space: pre; }
            .csmg-wiki-content table { display: block; width: 100%; overflow-x: auto; border-collapse: collapse; }
            .csmg-wiki-content th, .csmg-wiki-content td { padding: .45em .6em; border: 1px solid rgba(242,234,216,.15); text-align: left; }
            .csmg-wiki-content th { color: #e8d5ad !important; background: rgba(185,154,104,.09) !important; font-weight: 500; }
            .csmg-wiki-content a { color: #9ed8cf !important; text-decoration-color: rgba(158,216,207,.45); text-underline-offset: 2px; }
            .csmg-wiki-content img { max-width: 100%; height: auto; border-radius: 8px; }
            .csmg-wiki-note { color: #9da9a8; font-size: 12px; line-height: 1.7; }
            .csmg-wiki-choices { display: grid; gap: .55rem; margin-top: 1.1rem; }
            .csmg-wiki-choice { display: grid; gap: .2rem; padding: .75rem .85rem; border: 1px solid #ffffff1a; border-radius: 8px; color: inherit; text-align: left; background: #ffffff08; cursor: pointer; }
            .csmg-wiki-choice:hover { border-color: #b99a6877; background: #b99a6812; }
        `;
        style.textContent += [
            '.' + POPOVER_CLASS + ' { position:fixed; z-index:2147483646; box-sizing:border-box; width:min(calc(100vw - 1.5rem),17.5rem); max-height:min(calc(100dvh - 1.5rem),24rem); overflow:auto; padding:.9rem; border:1px solid rgba(242,234,216,.18); border-radius:.75rem; color:#f2ead8; background:rgba(18,20,15,.98); box-shadow:0 .875rem 2rem rgba(6,7,4,.36),0 .25rem .75rem rgba(6,7,4,.24); font:12px/1.65 Inter,\"PingFang SC\",\"Microsoft YaHei\",system-ui,sans-serif; }',
            '.' + POPOVER_CLASS + '::before { position:absolute; top:-.34rem; left:var(--csmg-wiki-arrow,1.25rem); width:.6rem; height:.6rem; content:\"\"; transform:rotate(45deg); border-top:1px solid rgba(242,234,216,.18); border-left:1px solid rgba(242,234,216,.18); background:#12140f; }',
            '.' + POPOVER_CLASS + '[data-placement=\"top\"]::before { top:auto; bottom:-.34rem; border:0; border-right:1px solid rgba(242,234,216,.18); border-bottom:1px solid rgba(242,234,216,.18); }',
            '.csmg-wiki-popover-kicker { color:#aaa08c; font-size:.7rem; letter-spacing:.08em; }',
            '.csmg-wiki-popover-title { margin:.2rem 0 0; color:#e4c878; font-size:14px; font-weight:500; letter-spacing:.02em; line-height:1.4; }',
            '.csmg-wiki-popover-source { margin-top:.2rem; color:#9ed8cf; font-size:10px; }',
            '.csmg-wiki-popover-summary { margin:.7rem 0 0; color:#d4d9d4; font-size:12px; line-height:1.75; overflow-wrap:anywhere; }',
            '.csmg-wiki-popover-related { display:grid; gap:.35rem; margin-top:.65rem; }',
            '.csmg-wiki-popover-related-label { color:#aaa08c; font-size:.72rem; }',
            '.csmg-wiki-popover-choice { appearance:none; display:flex; justify-content:space-between; gap:.6rem; width:100%; padding:.4rem .5rem; border:1px solid rgba(121,205,193,.26); border-radius:.45rem; color:#9ed8cf !important; background:rgba(121,205,193,.08) !important; text-align:left; font:inherit; cursor:pointer; }',
            '.csmg-wiki-popover-choice:hover { border-color:rgba(121,205,193,.58); background:rgba(121,205,193,.13) !important; }',
            '.csmg-wiki-popover-choice span:last-child { color:#aaa08c; font-size:.72rem; }',
            '.csmg-wiki-popover-action { appearance:none; width:100%; margin-top:.75rem; padding:.48rem .6rem; border:1px solid rgba(228,200,120,.44); border-radius:.45rem; color:#e4c878 !important; background:rgba(18,20,15,.72) !important; font:inherit; font-size:.8rem; cursor:pointer; }',
            '.csmg-wiki-popover-action:hover { border-color:rgba(228,200,120,.68); color:#f8e8aa !important; background:rgba(31,31,22,.9) !important; }',
            '.' + DIALOG_CLASS + ' { color:#f2ead8; }',
            '.csmg-wiki-kicker { color:#e4c878; } .csmg-wiki-title { color:#f2ead8; }',
            '.csmg-wiki-source { color:#9ed8cf; } .csmg-wiki-note { color:#aaa08c; }',
            '.csmg-wiki-content { border-color:rgba(242,234,216,.14); }',
            '.csmg-wiki-close { color:#f2ead8; border-color:rgba(242,234,216,.14); background:rgba(18,20,15,.72); }',
            '.csmg-wiki-choice { border-color:rgba(242,234,216,.14); background:rgba(255,255,255,.03); }',
            '.csmg-wiki-choice:hover { border-color:rgba(228,200,120,.44); background:rgba(228,200,120,.08); }',
            '.csmg-wiki-community { margin-top:1.25rem; border:1px solid #9ed8cf33; border-radius:10px; background:#9ed8cf06; font-size:12px; line-height:1.7; }',
            '.csmg-wiki-community > summary { display:flex; align-items:center; justify-content:space-between; gap:.5rem; padding:.85rem 1rem; color:#9ed8cf; cursor:pointer; font-weight:500; list-style:none; }',
            '.csmg-wiki-community > summary::-webkit-details-marker { display:none; }',
            '.csmg-wiki-community > summary::marker { content:""; }',
            '.csmg-wiki-community-state { flex-shrink:0; color:#aaa08c; font-size:11px; }',
            '.csmg-wiki-community-panel { padding:0 1rem 1rem; }',
            '.csmg-wiki-comment-list { display:grid; gap:.7rem; }',
            '.csmg-wiki-comment { padding:.85rem; border:1px solid #f2ead814; border-radius:8px; background:#070a0866; }',
            '.csmg-wiki-comment-meta { color:#e4c878; font-size:11px; }',
            '.csmg-wiki-comment-body { margin:.5rem 0; white-space:pre-wrap; overflow-wrap:anywhere; color:#d4d9d4; }',
            '.csmg-wiki-external { color:#9ed8cf !important; font-size:11px; }',
            '.csmg-wiki-comment-controls { display:flex; flex-wrap:wrap; gap:.5rem; margin:.75rem 0; }',
            '.csmg-wiki-action { appearance:none; display:inline-flex; padding:.5rem .75rem; border:1px solid #e4c87866; border-radius:7px; color:#e4c878 !important; background:#e4c87809 !important; font:inherit; text-decoration:none; cursor:pointer; }',
            '.csmg-wiki-action:disabled { opacity:.5; cursor:default; } .csmg-wiki-action[hidden] { display:none; }',
            '.csmg-wiki-community summary:focus-visible,.csmg-wiki-action:focus-visible { outline:2px solid #9ed8cf; outline-offset:3px; }',
            '.' + POPOVER_CLASS + ' .csmg-wiki-community { margin-top:.75rem; border-radius:8px; }',
            '.' + POPOVER_CLASS + ' .csmg-wiki-community > summary { padding:.6rem .65rem; font-size:12px; }',
            '.' + POPOVER_CLASS + ' .csmg-wiki-community-panel { max-height:min(38dvh,18rem); overflow:auto; overscroll-behavior:contain; padding:0 .65rem .65rem; }',
            '.' + POPOVER_CLASS + ' .csmg-wiki-note { font-size:11px; }',
            '.' + POPOVER_CLASS + ' .csmg-wiki-comment { padding:.6rem; }',
            '.' + POPOVER_CLASS + ' .csmg-wiki-action { padding:.35rem .5rem; font-size:11px; }',
        ].join('\n');
        hostDocument.head.append(style);
    }

    function ensureDialog() {
        if (modal?.isConnected) return modal;
        modal = hostDocument.createElement('div');
        modal.className = DIALOG_CLASS;
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', '尘世命轨词条资料');
        modal.addEventListener('click', event => {
            if (event.target === modal) closeDialog();
        });
        hostDocument.body.append(modal);
        return modal;
    }

    function closeDialog() {
        dialogSequence += 1;
        modal?.classList.remove('open');
        closePopover();
        if (focusBeforeDialog?.isConnected) focusBeforeDialog.focus();
    }

    function closePopover() {
        popover?.remove();
        hostDocument.querySelectorAll('.' + POPOVER_CLASS).forEach(element => element.remove());
        popover = undefined;
        popoverAnchor = undefined;
    }

    function summarizeContent(content, limit = 190) {
        const text = String(content || '')
            .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
            .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
            .replace(/<[^>]*>/g, ' ')
            .replace(/[*_>#~|]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return text.length > limit ? text.slice(0, limit).trimEnd() + '…' : text || '暂无简介，打开查看完整资料。';
    }

    function getRenderableEntryContent(entry) {
        return String(entry.content || '').trim();
    }

    function positionPopover(anchor) {
        if (!popover?.isConnected || !anchor?.isConnected) return;
        const anchorRect = anchor.getBoundingClientRect();
        const popoverRect = popover.getBoundingClientRect();
        const margin = 12;
        const gap = 10;
        const width = popoverRect.width || 280;
        const height = popoverRect.height || 120;
        const viewportWidth = hostWindow.innerWidth;
        const viewportHeight = hostWindow.innerHeight;
        const left = Math.max(margin, Math.min(anchorRect.left, viewportWidth - width - margin));
        const below = anchorRect.bottom + gap;
        const above = anchorRect.top - height - gap;
        const placeAbove = below + height > viewportHeight - margin && above >= margin;
        const top = placeAbove
            ? above
            : Math.max(margin, Math.min(below, viewportHeight - height - margin));
        const arrow = Math.max(12, Math.min(anchorRect.left + anchorRect.width / 2 - left - 5, width - 24));
        popover.dataset.placement = placeAbove ? 'top' : 'bottom';
        popover.style.left = left + 'px';
        popover.style.top = top + 'px';
        popover.style.setProperty('--csmg-wiki-arrow', arrow + 'px');
    }

    function showPopover(entries, anchor, index = liveIndex, selectedEntry = entries.length === 1 ? entries[0] : null, indexId = LIVE_INDEX) {
        closePopover();
        if (!entries.length) return;
        if (!modal?.classList.contains('open')) focusBeforeDialog = anchor;

        popover = hostDocument.createElement('aside');
        popover.className = POPOVER_CLASS;
        popover.setAttribute('role', 'dialog');
        popover.setAttribute('aria-label', '尘世命轨词条预览');
        popoverAnchor = anchor;

        const kicker = hostDocument.createElement('div');
        kicker.className = 'csmg-wiki-popover-kicker';
        kicker.textContent = selectedEntry ? '尘世命轨 · 设定词条' : '尘世命轨 · 多个资料来源';
        const title = hostDocument.createElement('h3');
        title.className = 'csmg-wiki-popover-title';
        title.textContent = selectedEntry?.title || anchor.textContent;
        popover.append(kicker, title);

        if (selectedEntry) {
            const source = hostDocument.createElement('div');
            source.className = 'csmg-wiki-popover-source';
            source.textContent = selectedEntry.world + ' · ' + selectedEntry.sourceTitle;
            const summary = hostDocument.createElement('p');
            summary.className = 'csmg-wiki-popover-summary';
            summary.textContent = selectedEntry.summary || summarizeContent(getRenderableEntryContent(selectedEntry));
            popover.append(source, summary);
        }

        if (entries.length > 1) {
            const related = hostDocument.createElement('div');
            related.className = 'csmg-wiki-popover-related';
            const label = hostDocument.createElement('div');
            label.className = 'csmg-wiki-popover-related-label';
            label.textContent = selectedEntry ? '其他同名资料' : '选择资料来源';
            related.append(label);
            for (const entry of entries) {
                if (entry === selectedEntry) continue;
                const choice = hostDocument.createElement('button');
                choice.type = 'button';
                choice.className = 'csmg-wiki-popover-choice';
                const name = hostDocument.createElement('span');
                name.textContent = entry.title;
                const world = hostDocument.createElement('span');
                world.textContent = entry.world;
                choice.append(name, world);
                choice.addEventListener('click', () => showPopover(entries, anchor, index, entry, indexId));
                related.append(choice);
            }
            popover.append(related);
        }

        if (selectedEntry && index?.entries) {
            const mentionedEntries = [...index.entries.values()]
                .filter(entry => entry !== selectedEntry && selectedEntry.content.includes(entry.title));
            if (mentionedEntries.length) {
                const related = hostDocument.createElement('div');
                related.className = 'csmg-wiki-popover-related';
                const label = hostDocument.createElement('div');
                label.className = 'csmg-wiki-popover-related-label';
                label.textContent = '相关词条';
                related.append(label);
                for (const entry of mentionedEntries) {
                    const choice = hostDocument.createElement('button');
                    choice.type = 'button';
                    choice.className = 'csmg-wiki-popover-choice';
                    const name = hostDocument.createElement('span');
                    name.textContent = entry.title;
                    const world = hostDocument.createElement('span');
                    world.textContent = entry.world;
                    choice.append(name, world);
                    choice.addEventListener('click', () => showPopover([entry], anchor, index, entry, indexId));
                    related.append(choice);
                }
                popover.append(related);
            }
        }

        if (selectedEntry) {
            const action = hostDocument.createElement('button');
            action.type = 'button';
            action.className = 'csmg-wiki-popover-action';
            action.textContent = '查看完整资料';
            action.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                closePopover();
                renderEntry(selectedEntry, index, indexId);
            });
            popover.append(action);
            attachCommunity(popover, selectedEntry, indexId);
        }

        (modal?.classList.contains('open') ? modal : hostDocument.body).append(popover);
        positionPopover(anchor);
    }

    function onPopoverOutsidePointerDown(event) {
        if (!popover || popover.contains(event.target)) return;
        if (event.target.closest?.('.' + LINK_CLASS)) return;
        closePopover();
    }

    function onPopoverKeyDown(event) {
        if (event.key === 'Escape') {
            closeDialog();
            closePopover();
        } else if (event.key === 'Tab' && modal?.classList.contains('open')) {
            const focusable = [...modal.querySelectorAll('button, a[href], input, textarea, summary')].filter(element => !element.disabled && element.getClientRects().length);
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (first && event.shiftKey && hostDocument.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (last && !event.shiftKey && hostDocument.activeElement === last) { event.preventDefault(); first.focus(); }
        }
    }

    function onPopoverViewportChange(event) {
        if (!popover) return;
        if (event?.type === 'scroll' && popover.contains(event.target)) return;
        if (!popoverAnchor?.isConnected) {
            closePopover();
            return;
        }
        positionPopover(popoverAnchor);
    }

    function buildCard(titleText, sourceText) {
        const card = hostDocument.createElement('section');
        card.className = 'csmg-wiki-card';
        const header = hostDocument.createElement('header');
        header.className = 'csmg-wiki-header';
        const titleGroup = hostDocument.createElement('div');
        const kicker = hostDocument.createElement('div');
        kicker.className = 'csmg-wiki-kicker';
        kicker.textContent = '尘世命轨 · 资料摘录';
        const title = hostDocument.createElement('h2');
        title.className = 'csmg-wiki-title';
        title.textContent = titleText;
        const source = hostDocument.createElement('div');
        source.className = 'csmg-wiki-source';
        source.textContent = sourceText;
        titleGroup.append(kicker, title, source);

        const close = hostDocument.createElement('button');
        close.type = 'button';
        close.className = 'csmg-wiki-close';
        close.textContent = '×';
        close.setAttribute('aria-label', '关闭资料卡');
        close.addEventListener('click', closeDialog);
        header.append(titleGroup, close);
        card.append(header);
        return card;
    }

    function setDialogContent(content) {
        const dialog = ensureDialog();
        if (!dialog.classList.contains('open') && !focusBeforeDialog?.isConnected) focusBeforeDialog = hostDocument.activeElement;
        dialogSequence += 1;
        dialog.replaceChildren(content);
        dialog.classList.add('open');
        content.querySelector('.csmg-wiki-close')?.focus();
    }

    function renderEntry(entry, index = liveIndex, indexId = LIVE_INDEX) {
        closePopover();
        modal?.classList.remove('open');
        modal?.replaceChildren();
        const card = buildCard(entry.title, entry.world + ' · ' + entry.sourceTitle);
        const body = hostDocument.createElement('div');
        body.className = 'csmg-wiki-content';
        const content = getRenderableEntryContent(entry);
        let rendered = null;
        try {
            if (typeof builtin !== 'undefined' && typeof builtin.renderMarkdown === 'function') {
                const html = builtin.renderMarkdown(content);
                const purifier = hostWindow.DOMPurify;
                if (purifier?.sanitize) {
                    rendered = purifier.sanitize(html, {
                        FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed'],
                        FORBID_ATTR: ['style'],
                    });
                }
            }
        } catch (error) {
            console.warn('[尘世命轨文本维基] Markdown 渲染失败，改为纯文本显示。', error);
        }
        if (rendered !== null && rendered.trim()) {
            body.innerHTML = rendered;
            if (!body.textContent.trim() && content) {
                body.classList.add('csmg-wiki-plain');
                body.textContent = content;
            }
        } else {
            renderSafeText(body, content);
        }
        enhanceTextContainer(body, index, indexId);
        card.append(body);
        setDialogContent(card);
        attachCommunity(card, entry, indexId);
    }

    function renderSafeText(container, content) {
        // 无 Markdown 渲染器时也用 DOM 绘制基础段落和粗体；不解释 HTML。
        for (const block of content.split(/\n\s*\n/)) {
            const heading = /^(#{1,4})\s+([^\n]+)$/.exec(block);
            const paragraph = node(heading ? 'h' + Math.min(4, heading[1].length + 1) : 'p');
            const text = heading ? heading[2] : block;
            let offset = 0;
            for (const match of text.matchAll(/\*\*([^*\n]+)\*\*/g)) {
                paragraph.append(hostDocument.createTextNode(text.slice(offset, match.index)), node('strong', '', match[1]));
                offset = match.index + match[0].length;
            }
            paragraph.append(hostDocument.createTextNode(text.slice(offset)));
            paragraph.style.whiteSpace = 'pre-wrap';
            container.append(paragraph);
        }
    }

    function openPreview() {
        const card = buildCard('正文词条预览', '《尘世命轨》· 地球篇 · 2012');
        const note = hostDocument.createElement('p');
        note.className = 'csmg-wiki-note';
        note.textContent = '基础资料取自作者公开词条。“天衡集团”可点；“药香”“野外”不标记。玩家补充须主动展开，可能包含剧透。';
        const paragraph = hostDocument.createElement('p');
        paragraph.className = 'csmg-wiki-content';
        paragraph.textContent = '档案室的暗门只在午夜开启。空气里残留药香，众人准备去野外寻线索。情报贩子说，夜色最近收到一批来自蓬莱岛的密信；与此同时，天衡集团也在追查同一条线索。';
        card.append(note, paragraph);
        enhanceTextContainer(paragraph, createIndex(demoEntries), DEMO_INDEX);
        setDialogContent(card);
    }

    function node(tag, className, text) {
        const element = hostDocument.createElement(tag);
        element.className = className || '';
        if (text !== undefined) element.textContent = text;
        return element;
    }

    function actionButton(text, callback) {
        const element = node('button', 'csmg-wiki-action', text);
        element.type = 'button';
        element.addEventListener('click', callback);
        return element;
    }

    function safeGithubLink(href, label) {
        try {
            const url = new URL(href);
            if (url.origin !== 'https://github.com' || !url.pathname.startsWith('/' + REPOSITORY + '/issues/')) return null;
            const anchor = node('a', 'csmg-wiki-external', label);
            anchor.href = url.href; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
            return anchor;
        } catch { return null; }
    }

    async function resolveDiscussion(entry) {
        const previous = discussionCache.get(entry.id);
        if (previous) return previous;
        let thread;
        if (Number.isInteger(entry.discussion?.issue_number) && entry.discussion.issue_number > 0) {
            const issue = await requestJson(API_BASE + '/issues/' + entry.discussion.issue_number);
            if (issue.pull_request || !String(issue.body || '').includes('<!-- dustline-entry:' + entry.id + ' -->')) throw new Error('评论区与词条不对应。');
            thread = { issue_number: issue.number, comment_count: issue.comments };
        } else {
            try {
                const manifest = await requestJson(RAW_BASE + 'data/discussions.json', { cache: 'no-cache' });
                thread = manifest.threads?.[entry.id];
            } catch { /* 评论区尚未建立时，在展开后使用 Issues 列表查找。 */ }
            if (!Number.isInteger(thread?.issue_number) || thread.issue_number < 1) {
                for (let page = 1; page <= 20; page += 1) {
                    const issues = await requestJson(API_BASE + '/issues?state=open&per_page=100&page=' + page);
                    if (!Array.isArray(issues)) throw new Error('评论区列表格式不正确。');
                    const issue = issues.find(item => !item.pull_request && ['blacktea-c', 'github-actions[bot]'].includes(String(item.user?.login).toLowerCase())
                        && String(item.body || '').includes('<!-- dustline-entry:' + entry.id + ' -->'));
                    if (issue) { thread = { issue_number: issue.number, comment_count: issue.comments }; break; }
                    if (issues.length < 100) break;
                }
            }
        }
        if (!Number.isInteger(thread?.issue_number) || thread.issue_number < 1) return null;
        discussionCache.set(entry.id, thread);
        return thread;
    }

    function readComment(comment) {
        const original = String(comment.body || '');
        const marker = /^<!-- dustline-comment-v1 ([^\n]+) -->\r?\n/;
        const match = marker.exec(original);
        if (match) {
            try {
                const meta = JSON.parse(decodeURIComponent(match[1]));
                return { nickname: String(meta.nickname || '匿名玩家').slice(0, 32), kind: meta.kind === '补充' ? '补充' : '吐槽',
                    body: original.slice(match[0].length).replace(/^\r?\n/, ''), anonymous: true };
            } catch { /* 普通 GitHub 评论保持其原始文字。 */ }
        }
        return { nickname: String(comment.user?.login || '玩家'), kind: '评论', body: original, anonymous: false };
    }

    function attachCommunity(card, entry, indexId) {
        const compact = card.classList.contains(POPOVER_CLASS);
        const section = node('details', 'csmg-wiki-community');
        const summary = node('summary');
        const label = node('span');
        const state = node('span', 'csmg-wiki-community-state');
        let commentCount = Number.isInteger(entry.discussion?.comment_count) ? entry.discussion.comment_count : null;
        function updateSummary() {
            label.textContent = (compact ? '玩家评论' : '玩家补充与吐槽') + (commentCount === null ? '' : '（' + commentCount + '）');
            state.textContent = section.open ? '收起 ▴' : '展开 ▾';
        }
        summary.append(label, state);
        updateSummary();
        const panel = node('div', 'csmg-wiki-community-panel');
        const note = node('p', 'csmg-wiki-note', compact ? '玩家观点，可能含剧透。发表需登录 GitHub。' : '以下为玩家观点，可能含剧透；不会用于正文匹配或作者资料。发表需登录 GitHub。');
        const status = node('p', 'csmg-wiki-note');
        status.setAttribute('role', 'status');
        const list = node('div', 'csmg-wiki-comment-list');
        const more = actionButton('加载更多', () => void loadComments(false));
        more.hidden = true;
        const refresh = actionButton('刷新评论', () => void loadComments(true));
        const writeLink = node('a', 'csmg-wiki-action', '去 GitHub 评论 ↗');
        writeLink.hidden = true;
        writeLink.target = '_blank';
        writeLink.rel = 'noopener noreferrer';
        const controls = node('div', 'csmg-wiki-comment-controls');
        controls.append(refresh, more, writeLink);
        panel.append(note, status, list, controls);
        section.append(summary, panel);
        card.append(section);
        const sequence = dialogSequence;
        let thread, page = 1, loading = false, loaded = false;
        const seen = new Set();
        const isCurrent = () => !stopped && section.isConnected && sequence === dialogSequence;
        const updateLayout = () => {
            if (isCurrent() && compact && card === popover) positionPopover(popoverAnchor);
        };

        async function loadComments(reset) {
            if (loading || !isCurrent()) return;
            loading = true; refresh.disabled = true; more.disabled = true;
            status.textContent = '正在读取玩家评论…';
            try {
                if (indexId === DEMO_INDEX || previewMode) {
                    list.replaceChildren(node('p', 'csmg-wiki-note', '这是本地预览，不请求或提交真实评论。'));
                    status.textContent = '预览模式；未打开真实 GitHub 评论区。'; loaded = true; return;
                }
                if (reset) { page = 1; thread = null; seen.clear(); list.replaceChildren(); writeLink.hidden = true; discussionCache.delete(entry.id); }
                thread = thread || await resolveDiscussion(entry);
                if (!isCurrent()) return;
                if (!thread) { status.textContent = '评论区尚未建立。仓库发布后运行“同步词条评论区”即可建立。'; more.hidden = true; writeLink.hidden = true; loaded = true; return; }
                const directLink = safeGithubLink('https://github.com/' + REPOSITORY + '/issues/' + thread.issue_number, '');
                if (directLink) { writeLink.href = directLink.href; writeLink.hidden = false; }
                const comments = await requestJson(API_BASE + '/issues/' + thread.issue_number + '/comments?per_page=30&page=' + page);
                if (!Array.isArray(comments)) throw new Error('评论数据格式不正确。');
                if (!isCurrent()) return;
                for (const comment of comments) {
                    if (seen.has(comment.id) || comment.minimized) continue;
                    seen.add(comment.id);
                    const parsed = readComment(comment);
                    const article = node('article', 'csmg-wiki-comment');
                    const date = new Date(comment.created_at);
                    const meta = node('div', 'csmg-wiki-comment-meta', parsed.nickname + ' · ' + parsed.kind
                        + (Number.isNaN(date.getTime()) ? '' : ' · ' + date.toLocaleDateString('zh-CN')));
                    const body = node('p', 'csmg-wiki-comment-body', parsed.body);
                    article.append(meta, body);
                    const link = safeGithubLink(comment.html_url, '原评论 ↗');
                    if (link) article.append(link);
                    list.append(article);
                }
                commentCount = Math.max(Number(thread.comment_count) || 0, seen.size);
                updateSummary();
                status.textContent = seen.size ? '已显示 ' + seen.size + ' 条评论。登录 GitHub 可发表。' : '还没有评论；登录 GitHub 后可发表。';
                page += 1; loaded = true; more.hidden = comments.length < 30;
            } catch (error) {
                if (isCurrent()) status.textContent = error.message + ' 点击“刷新评论”重试。';
            } finally { loading = false; refresh.disabled = false; more.disabled = false; updateLayout(); }
        }

        section.addEventListener('toggle', () => {
            updateSummary();
            if (section.open && !loaded) void loadComments(true);
            updateLayout();
        });
    }

    function openAbout() {
        closePopover();
        const card = buildCard('Wiki资料', '基础资料由作者维护，玩家评论独立展示');
        card.append(node('p', 'csmg-wiki-note', '资料与评论均来自 BlackTea-c/Dustline-wiki。评论默认折叠；登录 GitHub 后可在对应词条的评论区发表。'));
        const status = node('p', 'csmg-wiki-note', '当前资料：' + dataSource + ' · ' + liveIndex.entries.size + ' 条');
        status.setAttribute('role', 'status');
        card.append(status);
        setDialogContent(card);
    }

    function onWikiLinkClick(event) {
        const link = event.target.closest?.(`.${LINK_CLASS}`);
        if (!link) return;
        event.preventDefault();
        event.stopPropagation();

        let ids = [];
        try { ids = JSON.parse(link.dataset.csmgWikiIds || '[]'); } catch { /* ignore invalid markup */ }
        const indexId = link.dataset.csmgWikiIndex === DEMO_INDEX ? DEMO_INDEX : LIVE_INDEX;
        const index = indexId === DEMO_INDEX ? createIndex(demoEntries) : liveIndex;
        if (popoverAnchor === link) {
            closePopover();
            return;
        }
        const entries = ids.map(id => index.entries.get(id)).filter(Boolean);
        showPopover(entries, link, index, entries.length === 1 ? entries[0] : null, indexId);
    }

    async function refreshFromButton() {
        const result = await loadLiveIndex();
        if (!stopped) notify('已加载 ' + result.entryCount + ' 条基础资料 · ' + result.source);
    }

    function cleanup() {
        if (stopped) return;
        stopped = true;
        for (const stop of stops) stop?.stop?.();
        for (const controller of requests) controller.abort();
        hostDocument.removeEventListener('pointerdown', onPopoverOutsidePointerDown, true);
        hostDocument.removeEventListener('keydown', onPopoverKeyDown, true);
        hostWindow.removeEventListener('scroll', onPopoverViewportChange, true);
        hostWindow.removeEventListener('resize', onPopoverViewportChange);
        closePopover();
        hostDocument.removeEventListener('click', onWikiLinkClick);
        hostWindow.removeEventListener('pagehide', cleanup);
        hostDocument.querySelectorAll(`.${LINK_CLASS}`).forEach(link => {
            link.replaceWith(hostDocument.createTextNode(link.textContent));
        });
        hostDocument.getElementById(STYLE_ID)?.remove();
        modal?.remove();
    }

    function initialize() {
        if (!previewMode && (typeof eventOn !== 'function' || typeof appendInexistentScriptButtons !== 'function'
            || typeof getButtonEvent !== 'function' || typeof retrieveDisplayedMessage !== 'function' || typeof tavern_events === 'undefined')) {
            notify('需要酒馆助手的角色脚本环境。请把脚本导入角色脚本库后启用。');
            return;
        }
        hostWindow.__dustlineWiki?.cleanup?.();
        hostWindow.__dustlineWiki = { cleanup };
        installStyle();
        hostDocument.addEventListener('pointerdown', onPopoverOutsidePointerDown, true);
        hostDocument.addEventListener('keydown', onPopoverKeyDown, true);
        hostWindow.addEventListener('scroll', onPopoverViewportChange, true);
        hostWindow.addEventListener('resize', onPopoverViewportChange);
        hostDocument.addEventListener('click', onWikiLinkClick);
        if (!previewMode) {
            appendInexistentScriptButtons([
                { name: PREVIEW_BUTTON, visible: true },
                { name: REFRESH_BUTTON, visible: true },
                { name: ABOUT_BUTTON, visible: true },
            ]);
            stops.push(eventOn(getButtonEvent(PREVIEW_BUTTON), openPreview), eventOn(getButtonEvent(REFRESH_BUTTON), refreshFromButton),
                eventOn(getButtonEvent(ABOUT_BUTTON), openAbout), eventOn(tavern_events.CHARACTER_MESSAGE_RENDERED, enhanceMessage),
                eventOn(tavern_events.MESSAGE_UPDATED, enhanceMessage), eventOn(tavern_events.CHAT_CHANGED, () => { closeDialog(); enhanceAllMessages(); }));
        } else {
            hostDocument.getElementById('wiki-preview')?.addEventListener('click', openPreview);
            hostDocument.getElementById('wiki-settings')?.addEventListener('click', openAbout);
        }
        hostWindow.addEventListener('pagehide', cleanup);
        enhanceAllMessages();
        void loadLiveIndex();
    }
    if (hostDocument.readyState === 'loading') hostDocument.addEventListener('DOMContentLoaded', initialize, { once: true });
    else initialize();
})();
