// 中文标签补全：输入中文/英文弹出 Danbooru 标签候选，选择后插入英文标签；
// 支持一键把提示词中的中文翻译为标签，并在提示词框下方显示中文预览。
(() => {
    "use strict";

    const DATA_URL = "/zh_tag_autocomplete/tags.json";
    const CAT_NAME = { 0: "通用", 1: "画师", 3: "作品", 4: "角色", 5: "元" };
    const CJK = /[㐀-鿿豈-﫿]/;
    const SEP = /[,，、\n]/;
    // 输入法拼写中途失焦会把拼音残留上屏（如 "chu初音"）
    const PINYIN_RESIDUE = /^[a-z']+\s*(?=[㐀-鿿])/;
    // 这些颜文字类标签保留下划线
    const KEEP_UNDERSCORE = new Set(["0_0", "(o)_(o)", "+_+", "+_-", "._.", "<o>_<o>", "<|>_<|>", "=_=", ">_<", "3_3", "6_9", ">_o", "@_@", "^_^", "o_o", "u_u", "x_x", "|_|", "||_||"]);

    // 数据：每条为 {tag, cat, count, zh, syn[], alias[], note, zhAll, tagL}
    let entries = null;
    let byTag = new Map();
    let byZh = new Map();
    let loading = null;

    let popup = null;
    let state = { textarea: null, results: [], index: 0, tokenStart: 0, tokenEnd: 0 };
    let suppressInput = false;
    let searchTimer = null;

    const opt = (key, dflt) => (typeof opts !== "undefined" && opts[key] !== undefined ? opts[key] : dflt);

    // ---------- 数据加载与索引 ----------

    function loadData() {
        if (loading) return loading;
        loading = fetch(DATA_URL)
            .then((r) => r.json())
            .then((rows) => {
                entries = rows.map(([tag, cat, count, zh, syn, alias, note]) => {
                    const synArr = syn ? syn.split("|") : [];
                    const aliasArr = alias ? alias.split("|") : [];
                    const e = {
                        tag, cat, count, zh, note,
                        syn: synArr,
                        alias: aliasArr,
                        zhAll: [zh, ...synArr].join("|"),
                        tagL: tag.toLowerCase(),
                        aliasL: aliasArr.join("|").toLowerCase(),
                    };
                    byTag.set(tag, e);
                    for (const term of [zh, ...synArr]) {
                        if (!term) continue;
                        const list = byZh.get(term);
                        if (list) list.push(e);
                        else byZh.set(term, [e]);
                    }
                    return e;
                });
                console.log(`[zh-tag-autocomplete] loaded ${entries.length} tags`);
            })
            .catch((err) => {
                console.error("[zh-tag-autocomplete] failed to load tags", err);
                loading = null;
            });
        return loading;
    }

    // ---------- 搜索 ----------

    // 返回 [{e, score, hit}]，score 越小越靠前；hit 为命中的中文词（用于显示）
    function search(query, limit) {
        if (!entries || !query) return [];
        const includeArtists = opt("zhtac_include_artists", true);
        const out = [];
        if (CJK.test(query)) {
            for (const e of entries) {
                if (e.zhAll.indexOf(query) === -1) continue;
                if (e.cat === 1 && !includeArtists) continue;
                let score = 9, hit = "";
                const terms = [e.zh, ...e.syn];
                for (let i = 0; i < terms.length; i++) {
                    const t = terms[i];
                    if (!t) continue;
                    const s = t === query ? (i === 0 ? 0 : 1) : t.startsWith(query) ? 2 : t.includes(query) ? 3 : 9;
                    if (s < score) { score = s; hit = t; }
                }
                out.push({ e, score, hit });
            }
            if (out.length < limit) out.push(...fuzzySearch(query, new Set(out.map((r) => r.e)), includeArtists));
        } else {
            if (!englishSearchEnabled()) return [];
            out.push(...searchEnglish(query, includeArtists));
        }
        out.sort((a, b) => a.score - b.score || b.e.count - a.e.count);
        return out.slice(0, limit);
    }

    // 模糊匹配：子串找不到时（如“头部在画面外” vs “头部出画框”），按字与相邻两字的重合度打分
    function fuzzySearch(query, exclude, includeArtists) {
        const q = query.trim();
        if (q.length < 3) return [];
        const grams = [...new Set(Array.from({ length: q.length - 1 }, (_, i) => q.slice(i, i + 2)))];
        const chars = [...new Set(q)];
        const out = [];
        for (const e of entries) {
            if (exclude.has(e) || !e.zhAll || (e.cat === 1 && !includeArtists)) continue;
            if (!grams.some((g) => e.zhAll.includes(g))) continue; // 快速排除
            let best = 0, hit = "";
            for (const t of [e.zh, ...e.syn]) {
                if (!t) continue;
                const gc = grams.filter((g) => t.includes(g)).length / grams.length;
                const cc = chars.filter((c) => t.includes(c)).length / chars.length;
                // 词本身也要大部分被查询覆盖，避免长词因包含常见字而入选
                const back = [...new Set(t)].filter((c) => q.includes(c)).length / new Set(t).size;
                const s = (gc + cc + back) / 3;
                if (s > best) { best = s; hit = t; }
            }
            if (best >= 0.5) out.push({ e, score: 5 - best, hit });
        }
        return out;
    }

    function searchEnglish(query, includeArtists) {
        const out = [];
        const q = query.toLowerCase().trim().replace(/\s+/g, "_").replace(/\\([()])/g, "$1");
        if (!q) return out;
        for (const e of entries) {
            if (e.cat === 1 && !includeArtists) continue;
            let score = 9, hit = "";
            if (e.tagL === q) score = 0;
            else if (e.tagL.startsWith(q)) score = 1;
            else if (e.aliasL && ("|" + e.aliasL + "|").includes("|" + q + "|")) { score = 1; hit = q; }
            else if (e.tagL.includes("_" + q) || e.tagL.includes("(" + q)) score = 2;
            else if (e.aliasL && e.aliasL.includes(q)) {
                const a = e.alias.find((x) => x.toLowerCase().includes(q));
                const al = a ? a.toLowerCase() : "";
                score = al === q ? 1 : al.startsWith(q) ? 2 : 3;
                hit = a || "";
            } else if (q.length >= 3 && e.tagL.includes(q)) score = 3;
            if (score < 9) out.push({ e, score, hit });
        }
        return out;
    }

    // ---------- 谷歌翻译（经后端转发） ----------

    const gtCache = new Map(); // 中文 → Promise<译文|null>
    const gtDone = new Map(); // 中文 → 译文（已完成的，供同步读取）

    function googleTranslate(text) {
        text = text.trim();
        if (!text || !opt("zhtac_google_translate", true)) return Promise.resolve(null);
        if (gtCache.has(text)) return gtCache.get(text);
        const p = fetch(`/zh_tag_autocomplete/translate?q=${encodeURIComponent(text)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => {
                const t = j && j.text ? j.text.trim().replace(/[.。]+$/, "").toLowerCase() : null;
                if (t) gtDone.set(text, t);
                else gtCache.delete(text); // 失败不缓存，下次重试
                return t;
            })
            .catch(() => { gtCache.delete(text); return null; });
        gtCache.set(text, p);
        return p;
    }

    // 译文 → 标签：译文恰好是标签/别名时（如 "head out of frame"）直接用标签
    function tagForEnglish(en) {
        const e = byTag.get(normalizeTag(en));
        if (e) return e;
        const r = searchEnglish(en, true).filter((x) => x.score === 0 || (x.score === 1 && x.hit))
            .sort((a, b) => a.score - b.score || b.e.count - a.e.count)[0];
        return r ? r.e : null;
    }

    function formatPhrase(text) {
        return opt("zhtac_escape_parentheses", true) ? text.replace(/([()])/g, "\\$1") : text;
    }

    // 已装 tagcomplete 时英文补全交给它，避免两个弹窗抢 Enter/Tab
    function englishSearchEnabled() {
        const mode = opt("zhtac_english_search", "自动");
        if (mode === true || mode === "开启") return true;
        if (mode === false || mode === "关闭") return false;
        return !(typeof TAC_CFG !== "undefined" && TAC_CFG && TAC_CFG.activeIn && TAC_CFG.activeIn.global !== false);
    }

    // 中文词 → 最佳标签（用于一键翻译）
    function bestTagFor(term) {
        const exact = byZh.get(term);
        if (exact) return exact.reduce((a, b) => (b.count > a.count ? b : a));
        const r = search(term, 1)[0];
        return r && r.score <= 2 ? r.e : null;
    }

    // ---------- 标签格式化 ----------

    function formatTag(tag) {
        let t = tag;
        if (opt("zhtac_replace_underscores", true) && !KEEP_UNDERSCORE.has(t)) t = t.replace(/_/g, " ");
        if (opt("zhtac_escape_parentheses", true)) t = t.replace(/([()])/g, "\\$1");
        return t;
    }

    function normalizeTag(text) {
        return text.trim().replace(/\\([()])/g, "$1").replace(/ /g, "_").toLowerCase();
    }

    // 拆出权重语法：(xxx:1.2) / [xxx] / {xxx}
    function splitWeight(seg) {
        const m = seg.match(/^(\s*[(\[{]*)(.*?)((?::[\d.]+)?[)\]}]*\s*)$/s);
        return m ? [m[1], m[2], m[3]] : ["", seg, ""];
    }

    function formatCount(n) {
        if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
        if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
        return String(n);
    }

    // ---------- 当前输入词 ----------

    function currentToken(textarea) {
        const pos = textarea.selectionStart;
        if (pos !== textarea.selectionEnd) return null;
        const text = textarea.value;
        let start = pos;
        while (start > 0 && !SEP.test(text[start - 1])) start--;
        let raw = text.slice(start, pos);
        // 跳过前导空格与权重括号
        const lead = raw.match(/^[\s(\[{]*/)[0];
        start += lead.length;
        raw = raw.slice(lead.length);
        if (!raw || /[:<>]/.test(raw)) return null; // 权重/LoRA 语法中不补全
        // 有拼音残留时只用中文部分搜索，替换范围仍从残留开头算起，选中后一并替换掉
        const m = raw.match(PINYIN_RESIDUE);
        return { start, end: pos, text: m ? raw.slice(m[0].length) : raw };
    }

    // ---------- 弹窗 ----------

    function ensurePopup() {
        if (popup) return popup;
        popup = document.createElement("div");
        popup.id = "zhtac-popup";
        popup.addEventListener("mousedown", (ev) => {
            ev.preventDefault(); // 不让 textarea 失焦
            const item = ev.target.closest(".zhtac-item");
            if (item) choose(Number(item.dataset.i));
        });
        document.body.appendChild(popup);
        return popup;
    }

    function hidePopup() {
        if (popup) popup.style.display = "none";
        state.results = [];
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    }

    function renderPopup() {
        const p = ensurePopup();
        if (!state.results.length) return hidePopup();
        p.innerHTML = state.results
            .map(({ e, hit, gt, src }, i) => {
                if (gt) {
                    return `<div class="zhtac-item${i === state.index ? " zhtac-active" : ""}" data-i="${i}" title="谷歌翻译，插入译文原文">
                        <span class="zhtac-cat zhtac-cat-gt">翻译</span>
                        <span class="zhtac-tag">${escapeHtml(gt)}</span>
                        <span class="zhtac-zh">${escapeHtml(src)}</span>
                    </div>`;
                }
                const extra = hit && hit !== e.zh ? `<span class="zhtac-hit">≈${escapeHtml(hit)}</span>` : "";
                const title = e.note ? ` title="${escapeHtml(e.note)}"` : "";
                return `<div class="zhtac-item${i === state.index ? " zhtac-active" : ""}" data-i="${i}"${title}>
                    <span class="zhtac-cat zhtac-cat-${e.cat}">${CAT_NAME[e.cat] || ""}</span>
                    <span class="zhtac-tag">${escapeHtml(e.tag)}</span>
                    <span class="zhtac-zh">${escapeHtml(e.zh)}</span>${extra}
                    <span class="zhtac-count">${formatCount(e.count)}</span>
                </div>`;
            })
            .join("");
        positionPopup();
        p.style.display = "block";
        const active = p.querySelector(".zhtac-active");
        if (active) active.scrollIntoView({ block: "nearest" });
    }

    // 用镜像 div 计算光标在页面中的坐标
    function caretCoords(textarea, pos) {
        const style = getComputedStyle(textarea);
        const div = document.createElement("div");
        for (const prop of ["boxSizing", "width", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing",
            "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderLeftWidth",
            "borderRightWidth", "borderBottomWidth", "textTransform", "wordSpacing", "tabSize"]) {
            div.style[prop] = style[prop];
        }
        div.style.position = "absolute";
        div.style.visibility = "hidden";
        div.style.whiteSpace = "pre-wrap";
        div.style.wordWrap = "break-word";
        div.style.overflow = "hidden";
        div.textContent = textarea.value.slice(0, pos);
        const span = document.createElement("span");
        span.textContent = "​";
        div.appendChild(span);
        document.body.appendChild(div);
        const rect = textarea.getBoundingClientRect();
        const top = rect.top + span.offsetTop - textarea.scrollTop + parseFloat(style.lineHeight || 20);
        const left = rect.left + span.offsetLeft - textarea.scrollLeft;
        document.body.removeChild(div);
        return { top, left };
    }

    function positionPopup() {
        const { top, left } = caretCoords(state.textarea, state.tokenStart);
        const maxLeft = window.innerWidth - popup.offsetWidth - 8;
        popup.style.top = `${top + window.scrollY + 4}px`;
        popup.style.left = `${Math.max(4, Math.min(left, maxLeft)) + window.scrollX}px`;
    }

    // ---------- 插入 ----------

    function setValue(textarea, value, caret) {
        suppressInput = true;
        textarea.value = value;
        textarea.selectionStart = textarea.selectionEnd = caret;
        textarea.dispatchEvent(new Event("input", { bubbles: true })); // 通知 Gradio 更新
        suppressInput = false;
        updatePreview(textarea);
    }

    function choose(i) {
        const r = state.results[i];
        const ta = state.textarea;
        if (!r || !ta) return;
        const text = ta.value;
        let insert = r.gt ? formatPhrase(r.gt) : formatTag(r.e.tag);
        let after = text.slice(state.tokenEnd);
        // 吃掉光标后同一词的剩余部分
        const rest = after.match(/^[^,，、\n()\[\]{}:<>]*/)[0];
        after = after.slice(rest.length);
        if (opt("zhtac_append_comma", true) && !/^\s*[,，)\]}:]/.test(after)) insert += ", ";
        const before = text.slice(0, state.tokenStart);
        setValue(ta, before + insert + after, before.length + insert.length);
        hidePopup();
        ta.focus();
    }

    // ---------- 一键翻译 ----------

    // 字典优先；查不到的中文用 translations（中文 → 译文）替换，没有译文则原样保留
    function translateText(text, translations = gtDone) {
        return text
            .split("\n")
            .map((line) => {
                if (!CJK.test(line)) return line;
                return line
                    .split(/[,，、]/)
                    .map((seg) => {
                        if (!CJK.test(seg) || /<[^>]*>/.test(seg)) return seg.trim();
                        const [pre, core, post] = splitWeight(seg);
                        const term = core.trim().replace(PINYIN_RESIDUE, "");
                        const e = bestTagFor(term);
                        if (e) return (pre + formatTag(e.tag) + post).trim();
                        const en = translations.get(term);
                        if (!en) return seg.trim();
                        const te = tagForEnglish(en);
                        return (pre + (te ? formatTag(te.tag) : formatPhrase(en)) + post).trim();
                    })
                    .filter((s, i, arr) => s || i < arr.length - 1)
                    .join(", ");
            })
            .join("\n");
    }

    // 字典里找不到的中文片段（送去谷歌翻译）
    function untranslatedTerms(text) {
        const out = new Set();
        for (const seg of text.split(/[,，、\n]/)) {
            if (!CJK.test(seg) || /<[^>]*>/.test(seg)) continue;
            const term = splitWeight(seg)[1].trim().replace(PINYIN_RESIDUE, "");
            if (term && !bestTagFor(term)) out.add(term);
        }
        return [...out];
    }

    async function translateTextarea(textarea) {
        await loadData();
        if (!entries) return;
        const v = textarea.value;
        await Promise.all(untranslatedTerms(v).map(googleTranslate));
        if (textarea.value !== v) return; // 等翻译期间用户又改了内容，放弃本次
        const t = translateText(v);
        if (t !== v) setValue(textarea, t, t.length);
    }

    // ---------- 中文预览 ----------

    function previewEl(textarea) {
        const block = textarea.closest("[id$='_prompt'], [id$='_neg_prompt']") || textarea.parentElement;
        let el = block.querySelector(":scope > .zhtac-preview");
        if (!el) {
            el = document.createElement("div");
            el.className = "zhtac-preview";
            el.innerHTML = '<button type="button" class="zhtac-translate" title="把提示词中的中文翻译为标签">中→英</button><div class="zhtac-chips"></div>';
            el.querySelector(".zhtac-translate").addEventListener("click", () => translateTextarea(textarea));
            block.appendChild(el);
        }
        return el;
    }

    function updatePreview(textarea) {
        if (!opt("zhtac_show_preview", true) || !entries || !isPromptBox(textarea)) return;
        const el = previewEl(textarea);
        const chips = [];
        for (const seg of textarea.value.split(SEP)) {
            if (!seg.trim() || /<[^>]*>/.test(seg)) continue;
            const core = splitWeight(seg)[1].trim().replace(PINYIN_RESIDUE, "");
            if (!core || core.toUpperCase() === "BREAK") continue;
            if (CJK.test(core)) {
                const e = bestTagFor(core);
                const target = e ? e.tag : gtDone.get(core) || (opt("zhtac_google_translate", true) ? "谷歌翻译" : "?");
                chips.push(`<span class="zhtac-chip zhtac-pending" title="点“中→英”或按 ${escapeHtml(opt("zhtac_translate_hotkey", "Alt+T"))} 转换">${escapeHtml(core)} → ${escapeHtml(target)}</span>`);
            } else {
                const e = byTag.get(normalizeTag(core));
                if (e && e.zh) chips.push(`<span class="zhtac-chip" title="${escapeHtml(e.note || e.tag)}">${escapeHtml(e.zh)}</span>`);
                else chips.push(`<span class="zhtac-chip zhtac-unknown">${escapeHtml(core)}</span>`);
            }
        }
        el.querySelector(".zhtac-chips").innerHTML = chips.join("");
    }

    // ---------- 事件 ----------

    function isPromptBox(el) {
        return el && el.tagName === "TEXTAREA" && !!el.closest("[id*='prompt']") && !el.closest("#zhtac-popup");
    }

    function scheduleSearch(textarea) {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(async () => {
            await loadData();
            const tok = currentToken(textarea);
            if (!tok) return hidePopup();
            state.textarea = textarea;
            state.tokenStart = tok.start;
            state.tokenEnd = tok.end;
            const limit = opt("zhtac_max_results", 12);
            state.results = search(tok.text, limit);
            state.index = 0;
            renderPopup();
            if (CJK.test(tok.text)) addTranslation(textarea, tok.text.trim(), limit);
        }, 60);
    }

    // 谷歌译文异步返回后并入候选：译文本身是标签时置顶该标签，另附一条“翻译”候选插入译文原文
    function addTranslation(textarea, query, limit) {
        googleTranslate(query).then((en) => {
            if (!en || state.textarea !== textarea) return;
            const tok = currentToken(textarea);
            if (!tok || tok.text.trim() !== query || document.activeElement !== textarea) return;
            const results = state.results.filter((r) => !r.gt);
            const te = tagForEnglish(en);
            if (te && !results.some((r) => r.e === te)) results.unshift({ e: te, score: 0, hit: `译:${en}` });
            const gtItem = { gt: en, src: query };
            if (!te || normalizeTag(en) !== te.tag) {
                const strong = results.some((r) => r.score <= 1);
                if (strong) results.splice(Math.min(results.length, limit - 1), 0, gtItem);
                else results.unshift(gtItem);
            }
            state.results = results.slice(0, limit);
            renderPopup();
        });
    }

    function hotkeyMatches(ev) {
        const parts = String(opt("zhtac_translate_hotkey", "Alt+T")).toLowerCase().split("+").map((s) => s.trim());
        const key = parts.pop();
        return !!key && ev.key.toLowerCase() === key
            && ev.altKey === parts.includes("alt") && ev.ctrlKey === parts.includes("ctrl")
            && ev.shiftKey === parts.includes("shift");
    }

    // 输入法兼容：不同输入法/浏览器触发 input、compositionend 的顺序和次数不一致，
    // 有的拼写中途失焦不会触发 compositionend，有的根本不发 composition 事件。
    // 因此不维护“正在拼写”的状态，而是在多个时机检查文本是否变化，变了就重新搜索；
    // 只在事件本身标明处于拼写中（isComposing / keyCode 229）时跳过。
    const lastSeen = new WeakMap();

    function isImeEvent(ev) {
        return ev.isComposing || ev.keyCode === 229;
    }

    function checkChanged(ta) {
        if (suppressInput || !isPromptBox(ta) || !opt("zhtac_enabled", true)) return;
        const sig = ta.value + "|" + ta.selectionStart;
        if (lastSeen.get(ta) === sig) return;
        lastSeen.set(ta, sig);
        scheduleSearch(ta);
        clearTimeout(ta._zhtacPreviewTimer);
        ta._zhtacPreviewTimer = setTimeout(() => updatePreview(ta), 300);
    }

    function onInput(ev) {
        if (isImeEvent(ev)) return; // 拼写中（文本框里是拼音），等上屏后再搜
        checkChanged(ev.target);
    }

    // 不改变文本的按键，弹窗打开时由 onKeyDown 处理，keyup 不应重新搜索
    const NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Enter", "Tab", "Escape", "Shift", "Control", "Alt", "Meta"]);

    function onKeyUp(ev) {
        if (isImeEvent(ev) || NAV_KEYS.has(ev.key)) return;
        checkChanged(ev.target); // 兜底：部分输入法上屏后不触发 input
    }

    function onKeyDown(ev) {
        const ta = ev.target;
        if (!isPromptBox(ta) || !opt("zhtac_enabled", true) || isImeEvent(ev)) return; // 拼写中的按键交给输入法
        if (hotkeyMatches(ev)) {
            ev.preventDefault();
            hidePopup();
            translateTextarea(ta);
            return;
        }
        if (!state.results.length || state.textarea !== ta || popup.style.display === "none") return;
        const n = state.results.length;
        let handled = true;
        switch (ev.key) {
            case "ArrowDown": state.index = (state.index + 1) % n; renderPopup(); break;
            case "ArrowUp": state.index = (state.index - 1 + n) % n; renderPopup(); break;
            case "PageDown": state.index = Math.min(n - 1, state.index + 5); renderPopup(); break;
            case "PageUp": state.index = Math.max(0, state.index - 5); renderPopup(); break;
            case "Enter":
                if (ev.ctrlKey || ev.metaKey || ev.shiftKey) { handled = false; break; } // Ctrl+Enter 仍为生成
                choose(state.index); break;
            case "Tab": choose(state.index); break;
            case "Escape": hidePopup(); break;
            default: handled = false;
        }
        if (handled) {
            ev.preventDefault();
            ev.stopPropagation();
        }
    }

    function install() {
        const root = typeof gradioApp === "function" ? gradioApp() : document;
        root.addEventListener("input", onInput, true);
        root.addEventListener("keydown", onKeyDown, true);
        root.addEventListener("keyup", onKeyUp, true);
        root.addEventListener("compositionstart", (ev) => { if (isPromptBox(ev.target)) hidePopup(); }, true);
        root.addEventListener("compositionend", (ev) => {
            const ta = ev.target;
            // Chrome 在 compositionend 时文本已上屏；Firefox 随后还会再发一次 input，checkChanged 会自动去重
            setTimeout(() => checkChanged(ta), 0);
        }, true);
        root.addEventListener("focusout", (ev) => {
            if (isPromptBox(ev.target)) setTimeout(() => { if (document.activeElement !== state.textarea) hidePopup(); }, 150);
        }, true);
        root.addEventListener("focusin", (ev) => {
            if (isPromptBox(ev.target) && opt("zhtac_enabled", true)) loadData().then(() => updatePreview(ev.target));
        }, true);
        window.addEventListener("resize", hidePopup);
        loadData().then(() => {
            if (!opt("zhtac_enabled", true)) return;
            root.querySelectorAll("#txt2img_prompt textarea, #txt2img_neg_prompt textarea, #img2img_prompt textarea, #img2img_neg_prompt textarea")
                .forEach(updatePreview);
        });
    }

    if (typeof onUiLoaded === "function") onUiLoaded(install);
    else document.addEventListener("DOMContentLoaded", install);

    // 供调试/其他脚本使用
    window.zhTagAutocomplete = { search, translateText, loadData, googleTranslate, untranslatedTerms };
})();
