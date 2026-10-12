import json
import os
import urllib.parse
import urllib.request
from functools import lru_cache

import gradio as gr
from fastapi.responses import FileResponse, JSONResponse

from modules import script_callbacks, shared

EXT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_FILE = os.path.join(EXT_DIR, "data", "tags.json")
SECTION = ("zh_tag_autocomplete", "中文标签补全")

# 免 key 的谷歌翻译接口，前一个被限流时换下一个
GOOGLE_URLS = [
    ("https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=zh-CN&tl=en&q={q}", "dict"),
    ("https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-CN&tl=en&dt=t&q={q}", "gtx"),
]


def _opener():
    proxy = (_opt("zhtac_translate_proxy", "") or "").strip()
    if proxy:
        return urllib.request.build_opener(urllib.request.ProxyHandler({"http": proxy, "https": proxy}))
    return urllib.request.build_opener()  # 未设置时沿用系统环境变量 HTTP(S)_PROXY


DEEPSEEK_PROMPT = (
    "把下面这段 Stable Diffusion 提示词里的中文翻译成英文。"
    "如果它对应某个 Danbooru 标签，直接输出该标签（下划线换成空格，如 head out of frame）；"
    "否则输出简洁自然的英文短语。全部小写，只输出译文，不要解释、引号或句号。\n\n"
)


def _opt(key, default):
    return getattr(shared.opts, key, default)


def deepseek_translate(text):
    key = (_opt("zhtac_deepseek_key", "") or "").strip() or os.environ.get("DEEPSEEK_API_KEY", "")
    if not key:
        raise RuntimeError("未设置 DeepSeek API Key")
    base = (_opt("zhtac_deepseek_base", "") or "https://api.deepseek.com").strip().rstrip("/")
    model = (_opt("zhtac_deepseek_model", "") or "deepseek-flash").strip()
    req = urllib.request.Request(
        f"{base}/chat/completions",
        data=json.dumps({
            "model": model,
            "messages": [{"role": "user", "content": DEEPSEEK_PROMPT + text}],
            "temperature": 0,
            "max_tokens": 300,
            "thinking": {"type": "disabled"},  # 不开思考：快且省，否则思考会占满 max_tokens 导致译文为空
        }).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
    )
    # DeepSeek 国内可直连，不走代理设置（系统环境变量里的代理仍会生效）
    with urllib.request.urlopen(req, timeout=20) as r:
        out = json.loads(r.read().decode("utf-8"))["choices"][0]["message"]["content"]
    out = out.strip().strip("\"'“”").strip()
    if not out:
        raise RuntimeError("DeepSeek 返回为空")
    return out


@lru_cache(maxsize=4096)
def translate(text, engine):
    if engine == "DeepSeek":
        try:
            return deepseek_translate(text)
        except Exception as e:  # noqa: BLE001
            print(f"[zh-tag-autocomplete] DeepSeek 翻译失败，改用谷歌: {e}")
    return google_translate(text)


def google_translate(text):
    q = urllib.parse.quote(text)
    last = None
    for url, kind in GOOGLE_URLS:
        try:
            req = urllib.request.Request(url.format(q=q), headers={"User-Agent": "Mozilla/5.0"})
            with _opener().open(req, timeout=8) as r:
                data = json.loads(r.read().decode("utf-8"))
            if kind == "dict":
                # ["译文"] 或 [["译文", "zh-CN"]]
                first = data[0]
                out = first[0] if isinstance(first, list) else first
            else:
                out = "".join(part[0] for part in data[0] if part and part[0])
            if out:
                return out
        except Exception as e:  # noqa: BLE001
            last = e
    raise RuntimeError(f"google translate failed: {last}")


def on_app_started(_demo, app):
    @app.get("/zh_tag_autocomplete/tags.json")
    async def zhtac_tags():
        return FileResponse(DATA_FILE, media_type="application/json")

    # 普通 def：在线程池中执行，不阻塞事件循环
    @app.get("/zh_tag_autocomplete/translate")
    def zhtac_translate(q: str = ""):
        q = q.strip()[:500]
        if not q or not _opt("zhtac_google_translate", True):
            return JSONResponse({"text": ""})
        try:
            return JSONResponse({"text": translate(q, _opt("zhtac_translate_engine", "谷歌"))})
        except Exception as e:  # noqa: BLE001
            print(f"[zh-tag-autocomplete] {e}")
            return JSONResponse({"text": "", "error": str(e)}, status_code=502)


def on_ui_settings():
    def add(key, default, label, component=None, component_args=None):
        shared.opts.add_option(key, shared.OptionInfo(default, label, component, component_args, section=SECTION))

    add("zhtac_enabled", True, "启用中文标签补全")
    add("zhtac_max_results", 12, "候选数量上限", gr.Slider, {"minimum": 5, "maximum": 50, "step": 1})
    add("zhtac_replace_underscores", True, "插入时把下划线替换为空格（如 long_hair → long hair）")
    add("zhtac_escape_parentheses", True, "插入时转义括号（如 saber_(fate) → saber \(fate\)）")
    add("zhtac_append_comma", True, "插入后自动追加逗号")
    add("zhtac_english_search", "自动", "输入英文时也弹出补全（自动：已装 tagcomplete 时交给它处理）",
        gr.Radio, {"choices": ["自动", "开启", "关闭"]})
    add("zhtac_include_artists", True, "候选中包含画师标签")
    add("zhtac_show_preview", True, "在提示词框下方显示中文预览")
    add("zhtac_translate_hotkey", "Alt+T", "一键把提示词中的中文翻译为标签的快捷键")
    add("zhtac_google_translate", True, "字典里没有的中文用机器翻译（候选中显示译文；一键翻译时自动替换）")
    add("zhtac_translate_engine", "谷歌", "翻译引擎（DeepSeek 失败时自动改用谷歌）",
        gr.Radio, {"choices": ["谷歌", "DeepSeek"]})
    add("zhtac_translate_proxy", "", "谷歌翻译使用的代理（如 http://127.0.0.1:7890，留空则用系统环境变量）")
    add("zhtac_deepseek_key", "", "DeepSeek API Key（留空则读环境变量 DEEPSEEK_API_KEY）",
        gr.Textbox, {"type": "password"})
    add("zhtac_deepseek_base", "https://api.deepseek.com", "DeepSeek 接口地址（也可填其他 OpenAI 兼容接口）")
    add("zhtac_deepseek_model", "deepseek-flash", "DeepSeek 模型名")


script_callbacks.on_app_started(on_app_started)
script_callbacks.on_ui_settings(on_ui_settings)
