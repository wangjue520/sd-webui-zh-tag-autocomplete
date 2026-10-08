# sd-webui-zh-tag-autocomplete

SD WebUI（Forge Neo / A1111）中文标签补全扩展。数据为 12.6 万个 Danbooru 标签（图数 ≥50）及其中文译名、同义词。

## 功能

- **中文补全**：在提示词框输入中文（如 `黑丝`、`吾王`、`双马尾`），弹出候选标签；↑↓ 选择，Enter / Tab 或点击插入英文标签，Esc 关闭。Ctrl+Enter 仍为生成。
- **一键翻译**：点提示词框下方的 `中→英` 或按 `Alt+T`，把提示词里所有中文段落替换为标签，保留权重与 LoRA 语法：
  `黑丝，双马尾、(初音:1.2)` → `black thighhighs, twintails, (hatsune miku:1.2)`
- **中文预览**：提示词框下方显示每个标签的中文；未翻译的中文以橙色显示并预告将转换成的标签。
- **英文补全**：默认“自动”——已装 tagcomplete 时交给它处理，避免两个弹窗；可在设置中改为开启/关闭。

## 输入法兼容

不依赖 composition 状态标志：在 `input` / `compositionend` / `keyup` 多个时机检查文本变化，只跳过事件本身标明处于拼写中（`isComposing` 或 keyCode 229）的情况。因此：

- 拼写中（文本框里是拼音）不会弹出英文候选，拼写中的 Enter / 方向键交给输入法；
- 不发 composition 事件、或上屏后不触发 input 的输入法也能正常补全；
- 拼写中途失焦导致拼音残留上屏（如 `chu初音`）时，按中文部分搜索/翻译，并连同残留一起替换。

## 设置

设置 → 中文标签补全：开关、候选数量、下划线转空格、括号转义、自动追加逗号、英文补全、画师候选、中文预览、翻译快捷键。

## 安装注意

扩展目录必须是 WebUI `extensions/` 下的真实目录。若用目录链接指向 WebUI 之外的位置，Gradio 会以 403 拒绝加载其中的 JS。

## 数据更新

`data/tags.json` 由字典项目生成：`python scripts/build_plugin_data.py`（见上级项目 README）。
