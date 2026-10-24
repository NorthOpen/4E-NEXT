"""图标字体子集化：一次性产物生成器（不进构建流程）。

背景：web/src/assets/fonts/material-symbols-outlined.woff2 是完整变量字体
（6605 字形 × FILL/GRAD/opsz/wght 四轴，约 3.9MB），首屏就要下载它，
在跨境链路上几乎不可能在合理时间内传完，图标会长时间空白。

做法：只保留源码里真正用到的字形，并按需保留变量轴，再由 pyftsubset 重新打包。
输出仍是同一个文件名，因此 styles.css 与 245 处调用点一行都不用改。

依赖：Python 3 + fonttools（pip install fonttools brotli）

用法：
    python web/scripts/build-icon-font.py            # 生成子集，覆盖 src 里的 woff2
    python web/scripts/build-icon-font.py --dry-run  # 只测算体积，不写文件

注意：
  · 新增图标后需要重跑本脚本，否则该图标会渲染成连字文本（如 auto_awesome）。
  · web/scripts/check-icons.mjs 会在构建时做一次名单校验，漏跑时给出警告。
  · 变量轴的选择见 KEEP_AXES：FILL 与 wght 有实际使用（填充图标、细体空态图标），
    必须保留；GRAD 与 opsz 在界面里只有 20/24 两档的极小差别，钉死即可。
"""

import argparse
import json
import os
import re
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.dirname(HERE)
SRC = os.path.join(WEB, "src")
# 源字体（完整变量字体，3.9MB，只作为生成器的输入；不随构建产物分发）
FULL_FONT = os.path.join(HERE, "fonts", "material-symbols-outlined.full.woff2")
# 产物（子集，随包分发；文件名与 CSS 里的 url() 保持一致）
FONT = os.path.join(SRC, "assets", "fonts", "material-symbols-outlined.woff2")
NAMES_OUT = os.path.join(SRC, "assets", "icon-names.json")

# 钉死的轴（GRAD 恒定 0；opsz 界面里只用 20/24，取 24）
PINNED = {"GRAD": 0, "opsz": 24}
# 保留的轴：FILL（styles.extra.css 的 .ab-card-mark 用 FILL 1）、wght（.empty-hint 用 300）
KEEP_AXES = ["FILL", "wght"]

ASCII = "".join(chr(c) for c in range(0x20, 0x7F))
LIGATURE_RE = re.compile(r'material-symbols-outlined[^>]*>\s*([a-z0-9_]+)\s*<')
LITERAL_RE = re.compile(r'["\']([a-z0-9_]{2,40})["\']')


def walk_sources():
    for root, _, files in os.walk(SRC):
        for name in files:
            if name.endswith((".ts", ".tsx")):
                yield os.path.join(root, name)


def collect(font):
    """返回 (直接写在 span 里的图标, 源码字符串字面量里出现的图标)"""
    glyphs = set(font.getGlyphOrder())
    direct, literals = set(), set()
    for path in walk_sources():
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        direct.update(LIGATURE_RE.findall(text))
        for lit in LITERAL_RE.findall(text):
            if lit in glyphs:
                literals.add(lit)
    return sorted(direct), sorted(literals)


def build(font, names, keep_axes):
    opts = subset.Options()
    opts.layout_features = ["*"]
    # 关键：不做布局闭包。默认的闭包会沿着 GSUB 的 4275 条连字规则
    # 把所有图标字形又拉回来，等于没做子集。
    opts.layout_closure = False
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    opts.hinting = False

    work = TTFont(FULL_FONT)

    sub = subset.Subsetter(options=opts)
    sub.populate(glyphs=names, unicodes=[ord(c) for c in ASCII])
    sub.subset(work)

    if keep_axes:
        # 先子集再钉轴：反过来做的话，部分实例化会裁掉部分字形的 gvar 数据，
        # 子集阶段再去查这些字形就会 KeyError（fontTools 的已知坑）。
        work = instancer.instantiateVariableFont(work, PINNED, inplace=False, updateFontNames=False)

    work.flavor = "woff2"
    return work


def kb(path):
    return os.path.getsize(path) / 1024


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not os.path.exists(FULL_FONT):
        sys.exit("找不到源字体：" + FULL_FONT + "\n（它应当随仓库提交在 web/scripts/fonts/ 下）")

    full = TTFont(FULL_FONT)
    direct, literals = collect(full)
    available = set(full.getGlyphOrder())
    names = sorted(set(direct) | set(literals))
    missing = [n for n in names if n not in available]
    names = [n for n in names if n in available]

    print("直接引用的图标：%d" % len(direct))
    print("字面量里出现的图标：%d" % len(literals))
    print("并集：%d（不可用 %d：%s）" % (len(names), len(missing), ", ".join(missing[:8])))

    tmp = os.path.join(os.environ.get("TEMP", "/tmp"), "icon-subset")
    os.makedirs(tmp, exist_ok=True)

    print()
    print("原始体积：%.1f KB" % kb(FULL_FONT))
    for label, keep in (("只保留 FILL+wght 轴", True), ("保留全部四条轴", False)):
        out = os.path.join(tmp, "candidate-%s.woff2" % ("var" if keep else "static"))
        font = build(full, names, keep)
        font.save(out)
        axes = len(font["fvar"].axes) if "fvar" in font else 0
        print("  %-18s %.1f KB  (axes %d, glyphs %d)" % (label, kb(out), axes, len(font.getGlyphOrder())))

    if args.dry_run:
        print("\n[dry-run] 未写入任何文件")
        return

    out_font = os.path.join(tmp, "candidate-var.woff2")
    # 用候选文件覆盖源字体（同名，CSS 无需改动）
    with open(out_font, "rb") as src, open(FONT, "wb") as dst:
        dst.write(src.read())
    with open(NAMES_OUT, "w", encoding="utf-8") as fh:
        json.dump(
            {"generatedBy": "web/scripts/build-icon-font.py", "glyphs": names},
            fh,
            ensure_ascii=False,
            indent=0,
        )

    print("\n已写入：%s（%.1f KB）" % (FONT, kb(FONT)))
    print("已写入：%s（%d 个名字）" % (NAMES_OUT, len(names)))


if __name__ == "__main__":
    main()
