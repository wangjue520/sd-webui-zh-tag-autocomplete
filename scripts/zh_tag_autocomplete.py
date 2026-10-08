import os

import gradio as gr
from fastapi.responses import FileResponse

from modules import script_callbacks, shared

EXT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_FILE = os.path.join(EXT_DIR, "data", "tags.json")
SECTION = ("zh_tag_autocomplete", "中文标签补全")


def on_app_started(_demo, app):
    @app.get("/zh_tag_autocomplete/tags.json")
    async def zhtac_tags():
        return FileResponse(DATA_FILE, media_type="application/json")


def on_ui_settings():
    def add(key, default, label, component=None, component_args=None):
        shared.opts.add_option(key, shared.OptionInfo(default, label, component, component_args, section=SECTION))

    add("zhtac_enabled", True, "启用中文标签补全")
    add("zhtac_max_results", 12, "候选数量上限", gr.Slider, {"minimum": 5, "maximum": 50, "step": 1})
    add("zhtac_replace_underscores", True, "插入时把下划线替换为空格（如 long_hair → long hair）")
    add("zhtac_escape_parentheses", True, "插入时转义括号（如 saber_(fate) → saber \\(fate\\)）")
    add("zhtac_append_comma", True, "插入后自动追加逗号")
    add("zhtac_english_search", "自动", "输入英文时也弹出补全（自动：已装 tagcomplete 时交给它处理）",
        gr.Radio, {"choices": ["自动", "开启", "关闭"]})
    add("zhtac_include_artists", True, "候选中包含画师标签")
    add("zhtac_show_preview", True, "在提示词框下方显示中文预览")
    add("zhtac_translate_hotkey", "Alt+T", "一键把提示词中的中文翻译为标签的快捷键")


script_callbacks.on_app_started(on_app_started)
script_callbacks.on_ui_settings(on_ui_settings)
