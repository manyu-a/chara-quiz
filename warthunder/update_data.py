"""War Thunder通常ツリーのRB車両一覧を公開データマインから生成する。
利用例: python warthunder/update_data.py 2423f3099e
更新時は「ゲーム本番環境の」データマインコミットを明示する。
"""
import csv
import io
import json
import re
import sys
from pathlib import Path
from urllib.request import Request, urlopen

DEFAULT_REF = "2423f3099e"  # 現行版2.59.0.94 (2026-10-30)
SOURCE = "https://raw.githubusercontent.com/gszabi99/War-Thunder-Datamine/"
SECTIONS = {
    "army": "ground",
    "aviation": "air",
    "helicopters": "heli",
    "ships": "bluewater",
    "boats": "coastal",
}


def download(ref, path):
    req = Request(SOURCE + ref + "/" + path, headers={"User-Agent": "WTQuizDataUpdater/1.0"})
    with urlopen(req, timeout=90) as response:
        return response.read()


def tree_units(block):
    """研究列のフォルダも再帰的に開き、実車両のIDだけを返す。"""
    for key, value in block.items():
        if not isinstance(value, dict):
            continue
        if "rank" in value:
            yield key, value
        else:
            yield from tree_units(value)


def clean_name(name):
    name = (name or "").replace("\u00a0", " ").strip()
    # 国家マーカー・装飾記号・ゲーム専用フォントの文字を先頭から削る
    name = re.sub(r"^[^\w]+", "", name)
    # ゲームの翻訳CSVには、タブ位置を表す文字列 "\\t" がそのまま入っている。
    # 車両名には区切りとして不要なので、文字列と実際のタブの両方を削除する。
    name = name.replace(r"\t", "").replace("\t", "")
    return re.sub(r"\s+", " ", name)


def generate(ref=DEFAULT_REF):
    root = "char.vromfs.bin_u/config/"
    shop = json.loads(download(ref, root + "shop.blkx"))
    economy = json.loads(download(ref, root + "wpcost.blkx"))
    version = download(ref, "version").decode().strip()

    rows = csv.reader(io.StringIO(download(ref, "lang.vromfs.bin_u/lang/units.csv").decode("utf-8-sig")), delimiter=";")
    next(rows)
    names = {row[0]: (clean_name(row[1]), clean_name(row[11]))
             for row in rows if len(row) > 11 and row[0].endswith("_shop")}

    vehicles = []
    seen = set()
    for nation, branches in shop.items():
        country = nation.removeprefix("country_")
        for group, block in branches.items():
            kind = SECTIONS.get(group)
            if not kind:
                continue
            for line in block.get("range", []):
                items = list(tree_units(line))
                # 通常研究列は先頭に連続。プレミアム・イベント列が始まったら終了。
                # ランクIの無料予備車両は通常研究列として数える。
                def regular_entry(uid, item):
                    if any(item.get(flag) for flag in ("gift", "event", "showOnlyWhenBought",
                                                     "showOnlyWhenAvailableForPurchase")):
                        return False
                    price = economy.get(uid, {}).get("value", 0)
                    return price > 0 or (price == 0 and item.get("rank") == 1)

                regular_count = sum(regular_entry(uid, item) for uid, item in items)
                if not items or regular_count / len(items) < 0.8:
                    break

                for uid, item in items:
                    if any(item.get(flag) for flag in ("gift", "event", "showOnlyWhenBought",
                                                       "showOnlyWhenAvailableForPurchase")):
                        continue
                    if (country, group, uid) in seen:
                        continue
                    info = economy.get(uid)
                    label = names.get(uid + "_shop")
                    if not info or not label or not label[0]:
                        continue
                    rank = info.get("economicRankHistorical")
                    if group == "helicopters":
                        rank = info.get("economicRankTankHistorical", rank)
                    if rank is None:
                        continue

                    seen.add((country, group, uid))
                    br = round(1 + rank / 3, 1)
                    english, japanese = label
                    vehicles.append([uid, country, kind, br, english,
                                     japanese if japanese != english else ""])

    nations = ["usa", "germany", "ussr", "britain", "japan",
               "china", "italy", "france", "sweden", "israel"]
    groups = list(SECTIONS.values())
    vehicles.sort(key=lambda v: (nations.index(v[1]), groups.index(v[2]), v[3], v[4]))
    catalog = {"version": version, "ref": ref, "vehicles": vehicles}
    return "// Source: War Thunder Datamine (gszabi99), game version " + version + "\n" + \
           "window.WT_CATALOG=" + json.dumps(catalog, ensure_ascii=False, separators=(",", ":")) + ";\n"


if __name__ == "__main__":
    ref = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_REF
    output = Path(__file__).with_name("vehicles.js")
    output.write_text(generate(ref), encoding="utf-8")
    print(f"Updated {output} from {ref}")
