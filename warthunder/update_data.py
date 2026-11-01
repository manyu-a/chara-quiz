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


# ゲームの unittags.blkx の type_* タグを日本語の車両種別に変換する。
# 先頭から一致を探す（1台に複数タグがある場合もある）。
ROLE_TAGS = {
    "ground": [
        ("type_light_tank", "軽戦車"),
        ("type_medium_tank", "中戦車"),
        ("type_heavy_tank", "重戦車"),
        ("type_tank_destroyer", "駆逐戦車"),
        ("type_spaa", "対空車両"),
        ("type_missile_tank", "対戦車ミサイル車両"),
    ],
    "air": [
        ("type_fighter", "戦闘機"),
        ("type_assault", "攻撃機"),
        ("type_bomber", "爆撃機"),
    ],
    "heli": [
        ("type_attack_helicopter", "攻撃ヘリ"),
        ("type_utility_helicopter", "汎用ヘリ"),
    ],
    "bluewater": [
        ("type_battlecruiser", "巡洋戦艦"),
        ("type_battleship", "戦艦"),
        ("type_heavy_cruiser", "重巡洋艦"),
        ("type_light_cruiser", "軽巡洋艦"),
        ("type_frigate", "フリゲート"),
        ("type_destroyer", "駆逐艦"),
    ],
    "coastal": [
        ("type_torpedo_gun_boat", "魚雷砲艇"),
        ("type_torpedo_boat", "魚雷艇"),
        ("type_submarine_chaser", "駆潜艇"),
        ("type_armored_boat", "装甲艇"),
        ("type_heavy_gun_boat", "大型砲艇"),
        ("type_gun_boat", "砲艇"),
        ("type_frigate", "フリゲート"),
        ("type_naval_aa_ferry", "対空艀"),
        ("type_naval_ferry_barge", "砲艀"),
        ("type_boat", "小型艇"),
    ],
}


# この4件は元の翻訳と一致する場合に限り補正。将来の公式修正を上書きしない。
JAPANESE_NAME_FIXES = {
    "it_9a33bm3": ("オサーAK", "オサーAKM"),
    "beaufighter_mk6c": ("ボーファイター Mk.Vlc", "ボーファイター Mk.VIc"),
    "spitfire_mk5c": ("スピットファイア Mk.Vc", "スピットファイア Mk.Vc/trop"),
    "cn_zts_63_1980": ("63式水陸両用戦車", "63式水陸両用戦車（1980）"),
}


def vehicle_role(unittags, unit_id, kind):
    tags = unittags.get(unit_id, {}).get("tags", {})
    for tag, label in ROLE_TAGS[kind]:
        if tags.get(tag):
            return label
    raise ValueError(f"種別タグを判定できない車両: {unit_id} ({kind})")


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
    unittags = json.loads(download(ref, root + "unittags.blkx"))
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
                    fix = JAPANESE_NAME_FIXES.get(uid)
                    if fix and japanese == fix[0]:
                        japanese = fix[1]
                    vehicles.append([uid, country, kind, br, english,
                                     japanese if japanese != english else "",
                                     vehicle_role(unittags, uid, kind)])

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
