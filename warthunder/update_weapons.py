"""War Thunder車両クイズ用の武装ヒントを、同じ版の公開データマインから作る。
実行: python warthunder/update_weapons.py
先に update_data.py で vehicles.js を更新する。
"""
import json
import re
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import Request, urlopen

BASE = "https://raw.githubusercontent.com/gszabi99/War-Thunder-Datamine/"
ROOT = "aces.vromfs.bin_u/gamedata/"
MODEL_DIRS = {
    "ground": "units/tankmodels/",
    "air": "flightmodels/",
    "heli": "flightmodels/",
    "bluewater": "units/ships/",
    "coastal": "units/ships/",
}
CALIBER = re.compile(r"(?<!\d)(\d{1,3})(?:[_\.](\d{1,3}))?mm", re.I)


def as_list(value):
    return value if isinstance(value, list) else [value] if isinstance(value, dict) else []


def download(ref, path):
    url = BASE + ref + "/" + path
    request = Request(url, headers={"User-Agent": "WTQuizDataUpdater/1.0"})
    # 大きな公開スナップショットなので一時的な通信失敗のみ再試行する。
    for attempt in range(2):
        try:
            with urlopen(request, timeout=40) as response:
                return json.load(response)
        except Exception:
            if attempt:
                raise


def model(ref, vehicle):
    unit_id, _, kind = vehicle[:3]
    path = ROOT + MODEL_DIRS[kind] + unit_id.lower() + ".blkx"
    data = download(ref, path)
    return unit_id, {
        "kind": kind,
        "weapons": as_list((data.get("commonWeapons") or {}).get("Weapon")),
        "slots": data.get("WeaponSlots") or {},
        "presets": as_list((data.get("weapon_presets") or {}).get("preset")),
    }


def equipped_weapons(model_data):
    """通常装備と、初期状態の固定武装スロットを取得する。選択式外装兵装は含めない。"""
    slots = as_list(model_data["slots"].get("WeaponSlot"))
    weapons = []
    for weapon in model_data["weapons"]:
        if not isinstance(weapon, dict):
            continue
        if weapon.get("blk"):
            weapons.append(weapon)
            continue
        if "slot" not in weapon:
            continue
        slot = next((s for s in slots if s.get("index") == weapon["slot"]), None)
        if slot is None:
            continue
        preset = next((p for p in as_list(slot.get("WeaponPreset"))
                       if p.get("name") == weapon.get("preset")), None)
        if preset is not None:
            weapons.extend(as_list(preset.get("Weapon")))
    return weapons


def caliber_from_name(path):
    match = CALIBER.search(path)
    if not match:
        return None
    return float(match.group(1) + ("." + match.group(2) if match.group(2) else ""))


def weapon_caliber(ref, path):
    """名前にmmがない機銃・機関砲は弾薬のcaliberから求める。"""
    relative = path.lower().replace("gamedata/weapons/", "", 1).removesuffix(".blk") + ".blkx"
    data = download(ref, ROOT + "weapons/" + relative)
    for bullet in as_list(data.get("bullet")):
        caliber = bullet.get("caliber")
        if isinstance(caliber, (float, int)) and caliber > 0:
            return caliber * 1000
    return None


def printable_caliber(value):
    return str(int(value)) if value.is_integer() else f"{value:g}"


def hint(vehicle, model_data, extra_calibers):
    unit_id, _, kind = vehicle[:3]
    guns = []
    missiles = []
    for weapon in equipped_weapons(model_data):
        if not isinstance(weapon, dict) or weapon.get("dummy"):
            continue
        path = weapon.get("blk", "")
        group = weapon.get("triggerGroup", "")
        trigger = weapon.get("trigger", "")
        lower = path.lower()
        if (not path or "dummy_weapon" in lower or
                "countermeasure" in lower or "countermeasure" in trigger or
                "booster" in lower or "boosters" in trigger or
                "payloadguns" in lower or trigger == "undercarriage" or
                group in ("smoke", "special")):
            continue
        if kind == "ground" and group in ("coaxial", "machinegun", "commander"):
            continue
        if kind in ("bluewater", "coastal") and group != "primary":
            continue
        if any(term in lower for term in ("missile", "launcher", "rocketgun")):
            missiles.append("ロケット" if "rocket" in lower and "missile" not in lower else "ミサイル")
            continue
        caliber = caliber_from_name(path) or extra_calibers.get(path)
        if caliber:
            guns.append(caliber)

    # 主砲のない沿岸艇などでは副砲グループから最大口径を採る。
    if kind in ("bluewater", "coastal") and not guns and not missiles:
        for weapon in equipped_weapons(model_data):
            if not isinstance(weapon, dict) or weapon.get("dummy") or weapon.get("triggerGroup") != "secondary":
                continue
            path = weapon.get("blk", "")
            caliber = caliber_from_name(path) or extra_calibers.get(path)
            if caliber:
                guns.append(caliber)

    counts = Counter(guns)
    entries = []
    max_types = 3 if kind in ("air", "heli") else 2
    for caliber, count in sorted(counts.items(), reverse=True)[:max_types]:
        size = printable_caliber(caliber) + "mm"
        if kind in ("air", "heli"):
            size += "機銃" if caliber < 15 else "機関砲" if caliber < 40 else "砲"
            if count > 1:
                size += "×" + str(count)
        else:
            size += "機銃" if caliber < 15 else "砲"
            if count > 1:
                size += "×" + str(count) + ("挺" if caliber < 15 else "門")
        entries.append(size)
    if missiles:
        entries.append(sorted(set(missiles))[0])
    if len(counts) > max_types:
        entries.append("ほか")
    if entries:
        prefix = {
            "ground": "主武装",
            "air": "火器",
            "heli": "標準火器",
            "bluewater": "主砲",
            "coastal": "主武装",
        }[kind]
        return prefix + "：" + "・".join(entries)

    if kind == "ground" and ("_fcs" in unit_id or
                             any("launcher" in p.get("name", "").lower() for p in model_data["presets"])):
        return "武装：ミサイル発射システム"
    if kind in ("air", "heli") and model_data["presets"]:
        return "固定火器なし／搭載武装は選択式"
    return "武装データなし"


def generate(ref, vehicles, version):
    with ThreadPoolExecutor(max_workers=24) as pool:
        data = dict(pool.map(lambda vehicle: model(ref, vehicle), vehicles))
    # 銃の識別子に口径がない場合だけ、固有の弾薬定義を読み取る。
    paths = {w.get("blk") for item in data.values() for w in equipped_weapons(item)
             if isinstance(w, dict) and w.get("blk")}
    nonnumeric = sorted(p for p in paths if not caliber_from_name(p) and
                        "dummy_weapon" not in p.lower() and
                        "payloadguns" not in p.lower() and
                        "countermeasure" not in p.lower())
    def load_caliber(path):
        return path, weapon_caliber(ref, path)
    with ThreadPoolExecutor(max_workers=24) as pool:
        extra = {path: value for path, value in pool.map(load_caliber, nonnumeric)
                 if value is not None}
    hints = {v[0]: hint(v, data[v[0]], extra) for v in vehicles}
    result = {"version": version, "ref": ref, "hints": hints}
    return ("// Source: War Thunder Datamine (gszabi99), game version " + version + "\n" +
            "window.WT_WEAPON_HINTS=" + json.dumps(result, ensure_ascii=False, separators=(",", ":")) + ";\n")


def main():
    location = Path(__file__).with_name("vehicles.js")
    raw = location.read_text(encoding="utf-8")
    catalog = json.loads(raw.split("window.WT_CATALOG=", 1)[1].strip().removesuffix(";"))
    ref = sys.argv[1] if len(sys.argv) > 1 else catalog["ref"]
    if ref != catalog["ref"]:
        raise ValueError("vehicles.js と武装データのコミットSHAを一致させてください")
    output = Path(__file__).with_name("weapon_hints.js")
    output.write_text(generate(ref, catalog["vehicles"], catalog["version"]), encoding="utf-8")
    print(f"Updated {output} from {ref}: {len(catalog['vehicles'])} vehicles")


if __name__ == "__main__":
    main()
