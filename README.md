# sd-webui-zh-tag-autocomplete

SD WebUI 中文标签补全扩展：在提示词框里**直接打中文**，弹出对应的 Danbooru 英文标签供选择；也可以把整段中文提示词**一键翻译**成标签。

- 收录 Danbooru 图数 ≥50 的 **125,778** 个标签（2026-10 数据）
- 每个标签带中文名与多个中文同义词，例如 `black_pantyhose` ← 黑色连裤袜 / 黑丝 / 黑色丝袜 / 黑裤袜…
- 角色、作品支持译名、简称和社区昵称，例如 `saber_(fate)` ← 吾王 / 呆毛王 / 骑士王
- 适用于 A1111 系 WebUI：Stable Diffusion WebUI、Forge、Forge Neo

字典数据与制作脚本见 [danbooru-zh-dict](https://github.com/wangjue520/danbooru-zh-dict)。

---

## 安装

**方式一：从网址安装（推荐）**

1. WebUI →「扩展 Extensions」→「从网址安装 Install from URL」
2. 填入 `https://github.com/wangjue520/sd-webui-zh-tag-autocomplete`，点「安装」
3. 回到「已安装」页点「应用并重启 UI」，或直接重启 WebUI

**方式二：git**

```bash
cd stable-diffusion-webui/extensions
git clone https://github.com/wangjue520/sd-webui-zh-tag-autocomplete
```

**方式三：压缩包**

在 GitHub 页面点「Code → Download ZIP」，解压到 WebUI 的 `extensions` 目录，确保结构为 `extensions/sd-webui-zh-tag-autocomplete/README.md`（不要多套一层文件夹），然后重启 WebUI。

> 不需要安装任何 Python 依赖。

---

## 使用指南

### 1. 中文补全

在正向/反向提示词框（也包括 ADetailer 等扩展的提示词框）里输入中文：

```
masterpiece, 1girl, 黑丝
```

输入法上屏后会弹出候选：

| 分类 | 标签 | 中文 | 命中词 | 图数 |
| --- | --- | --- | --- | --- |
| 通用 | black_thighhighs | 黑色过膝袜 | ≈黑丝 | 512.0k |
| 通用 | black_pantyhose | 黑色连裤袜 | ≈黑丝 | 302.1k |

选择后自动替换为 `black thighhighs, `。

| 按键 | 作用 |
| --- | --- |
| ↑ / ↓ | 上下选择 |
| PageUp / PageDown | 翻 5 项 |
| Enter / Tab | 插入选中的标签 |
| Esc | 关闭候选 |
| 鼠标点击 | 插入该标签 |
| Ctrl+Enter | 照常生成图片（不被插件拦截） |

- 候选按「完全匹配 → 开头匹配 → 包含」排序，同级按 Danbooru 图数从多到少排列
- 分类颜色：蓝 = 通用，绿 = 角色，紫 = 作品，橙 = 元标签，红 = 画师
- 鼠标悬停在候选上可以看到该标签的中文说明
- 输入英文也能补全，而且会匹配英文别名，例如 `miku` → `hatsune_miku`（装了 tagcomplete 时默认交给它处理，见下文设置）

### 2. 一键中译英

先用中文把想要的元素写下来，再一次性转换：

```
黑丝，双马尾、(初音:1.2), 吾王, <lora:xxx:0.8>
```

点提示词框下方的 **「中→英」** 按钮，或按 **Alt+T**：

```
black thighhighs, twintails, (hatsune miku:1.2), artoria pendragon \(fate\), <lora:xxx:0.8>
```

- 中文逗号 `，`、顿号 `、`、英文逗号 `,` 都可以作为分隔
- 权重 `(xx:1.2)`、`[xx]`、`{xx}` 和 LoRA `<lora:…>` 保持不变
- 匹配不到的中文原样保留，方便手动修改
- 一个中文词对应多个标签时，取最常用（图数最多）的那个；需要别的标签时请用补全手动选

### 3. 中文预览

提示词框下方会实时显示每个标签的中文，方便核对英文提示词的含义：

- 灰底：已识别的标签，显示中文名（悬停可看说明）
- 橙底：尚未翻译的中文，显示「中文 → 将转换成的标签」
- 半透明：字典里没有的词（如 `masterpiece` 这类非 Danbooru 标签）

---

## 设置

「设置 Settings」→「中文标签补全」：

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| 启用中文标签补全 | 开 | 总开关 |
| 候选数量上限 | 12 | 5–50 |
| 下划线替换为空格 | 开 | `long_hair` → `long hair`；`^_^` 等颜文字标签保留下划线 |
| 转义括号 | 开 | `saber_(fate)` → `saber \(fate\)`，避免被当成权重语法 |
| 插入后自动追加逗号 | 开 | |
| 输入英文时也弹出补全 | 自动 | 自动：检测到 tagcomplete 时英文交给它，避免两个弹窗抢按键 |
| 候选中包含画师标签 | 开 | 画师标签只有原名，不翻译 |
| 显示中文预览 | 开 | |
| 一键翻译快捷键 | Alt+T | 可改为 `Ctrl+Shift+Y` 这类组合 |

---

## 中文输入法说明

插件专门处理了输入法的各种情况：

- **打拼音过程中不弹窗**：文本框里还是拼音时不会搜索，拼写中的 Enter、方向键会留给输入法，上屏后才弹出候选
- **兼容不同输入法的事件差异**：有的输入法上屏后不触发 input 事件，有的根本不发 composition 事件，插件会在多个时机检查文本变化，上屏后都能触发
- **拼音残留**：拼到一半切走焦点时，浏览器可能把拼音直接上屏，变成 `chu初音`；插件只用中文部分搜索，选中后连同残留一起替换

如果遇到某个输入法不触发，请提 issue，并写明输入法名称、浏览器和操作步骤。

---

## 常见问题

**没有弹出候选 / 没有「中→英」按钮**
- 确认扩展已启用，并且已经重启 WebUI（只刷新页面不会加载新扩展的后端）
- 按 F12 打开控制台，正常加载时会看到 `[zh-tag-autocomplete] loaded 125778 tags`
- 首次打开页面需要加载约 15MB 的字典，要等一两秒

**控制台显示 403，插件 JS 加载失败**
扩展目录必须是 `extensions/` 下的真实文件夹。用目录链接（junction/symlink）指向 WebUI 之外的位置时，Gradio 会拒绝加载。

**和 tagcomplete 同时弹出两个候选框**
把设置里的「输入英文时也弹出补全」设为「自动」或「关闭」。

**翻译不准 / 想加自己的叫法**
字典由大模型辅助生成，热门标签经过抽查，冷门角色可能有错。欢迎到 [danbooru-zh-dict](https://github.com/wangjue520/danbooru-zh-dict) 提 issue 或 PR。

---

## 数据与许可

- 代码：MIT License
- 字典数据：标签与别名来自 Danbooru（经 licyk/danbooru_tags、DominikDoom/a1111-sd-webui-tagcomplete、newtextdoc1111/danbooru-tag-csv、NSFW-API Danbooru wiki dump）；中文底稿来自 [amenorira/danbooru-tags-data-zh](https://github.com/amenorira/danbooru-tags-data-zh)（MIT）；同义词扩展由大模型生成
- 字典包含成人内容标签的翻译
