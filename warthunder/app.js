"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const catalog = window.WT_CATALOG;
  if (!catalog || !Array.isArray(catalog.vehicles)) {
    $("message").textContent = "車両データを読み込めませんでした。ページを再読み込みしてください。";
    return;
  }

  // 武装ヒントは同じデータマイン版の別ファイルから読み込む。
  const weaponData = window.WT_WEAPON_HINTS;
  const weaponHints = weaponData?.version === catalog.version && weaponData?.ref === catalog.ref
    ? weaponData.hints : {};

  // 日本語名の有無を保持し、英語名だけの車両でマスクを重複表示しない。
  // vehicles.js の1件: [内部ID, 国, 兵種, RB, 英語名, 日本語名, 車両種別]
  const vehicles = catalog.vehicles.map(([id, country, kind, br, name, ja, role]) =>
    ({ id, country, kind, br, name, ja: ja || name, jaOriginal: ja || "",
       role: role || "不明", weapon: weaponHints?.[id] || "武装データ未取得" })
  );
  const countries = {
    usa: "アメリカ", germany: "ドイツ", ussr: "ソ連",
    britain: "イギリス", japan: "日本", china: "中国",
    italy: "イタリア", france: "フランス", sweden: "スウェーデン",
    israel: "イスラエル"
  };
  const modeNames = {
    ground: "陸", air: "空", naval: "海", all: "陸・空・海"
  };
  const kindNames = {
    ground: "地上", air: "航空機", heli: "ヘリ",
    bluewater: "外洋", coastal: "沿岸"
  };
  const settingsKey = "wt-vehicle-quiz-settings-v1";
  const progressPrefix = "wt-vehicle-quiz-v1-" + catalog.version + ":";

  // 過去の公式名称など、型式を取り違えない範囲で個別に許容する別名。
  const answerAliases = {
    ussr_zsu_23_4: ["ZSU-23-4"],
    it_zsu_23_4: ["ZSU-23-4"],
    il_zsu_23_4: ["ZSU-23-4"],
    // Bardelas は車両系列名だが、現状該当車両が1台のみなので短縮名も許容。
    il_m113_hvms: ["Bardelas", "バルデラス"],
    // ゲーム全体の型式名を調査し、系列名のみで一意な車両に限った短縮回答。
    germ_flakpanzer_zerstorer_45: ["Zerstörer","ツェルシュテーラー"],
    germ_begleitpanzer_57: ["Begleitpanzer"],
    fr_vextra_105: ["Vextra"],
    uk_a17_mk_1_tetrarch: ["Tetrarch","テトラーク"],
    uk_a25_mk_8: ["Harry Hopkins","ハリー・ホプキンス"],
    brigand_b1: ["Brigand","ブリガンド"],
    blenheim_mkiv: ["Blenheim","ブレニム"],
    beaufort_mkviii: ["Beaufort","ボーフォート"],
    v_156_b1: ["Chesapeake","チェサピーク"],
    firebrand_tf4: ["Firebrand","ファイアブランド"],
    gladiator_mk2_navy: ["Sea Gladiator","シーグラディエーター"],
    meteor_fmk3_navy: ["Sea Meteor","シーミーティア"],
    sea_venom_faw20: ["Sea Venom","シーベノム"],
    javelin_fmk9: ["Javelin","ジャベリン"],
    wessex_mk5: ["Wessex","ウェセックス"],
    it_mc492_baleno: ["Baleno","バレーノ"],
    germ_radpanzer_90: ["Radkampfwagen"],
    uk_arjun_mk1: ["Arjun","アージュン"],
    sw_lago_1: ["Lago","ラーゴ"],
    il_sabra_mk1: ["Sabra","サブラ"],
    sagittario_2: ["Sagittario","サジッタリオ"]
  };
  const allBRs = [...new Set(vehicles.map((vehicle) => vehicle.br))]
    .sort((a, b) => a - b);

  let scope;
  let active = [];
  let solved = new Set();
  let ended = false;
  let gaveUp = false;
  let elapsedBefore = 0;
  let clockStarted = 0;
  let running = false;
  let started = false;
  let onlyUnsolved = false;
  let selected = null;
  let hintStage = 0;
  const tileMap = new Map();
  const countryCounters = new Map();

  // 「三号」「三式」「三二型」などの漢数字を 3号・3式・32型に統一。
  const kanjiDigits = {
    "〇": 0, "零": 0, "一": 1, "二": 2, "三": 3, "四": 4,
    "五": 5, "六": 6, "七": 7, "八": 8, "九": 9
  };
  function normalizeKanjiNumber(text) {
    if (!/[十百千]/.test(text)) {
      return [...text].map((c) => kanjiDigits[c]).join("");
    }
    let total = 0;
    let current = 0;
    for (const c of text) {
      if (c in kanjiDigits) {
        current = current * 10 + kanjiDigits[c];
      } else {
        const unit = { "十": 10, "百": 100, "千": 1000 }[c];
        total += (current || 1) * unit;
        current = 0;
      }
    }
    return String(total + current);
  }

  // Unicodeの「Ⅲ」はNFKCで「III」になる。ローマ数字I～XXも3などに統一。
  const romanNumbers = {
    i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8,
    ix: 9, x: 10, xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15,
    xvi: 16, xvii: 17, xviii: 18, xix: 19, xx: 20
  };

  // 表記揺れのみ吸収し、部分一致にはしない（F-4EとF-4EJは別扱い）。
  function normalizeName(value) {
    // 欧文のアクセントを無視する。和文の濁点(U+3099/309A)は消さない。
    return String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .normalize("NFKC").toLowerCase()
      .replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 96))
      // よくある音写の違いだけを統一する。型式や愛称は省略しない。
      .replace(/ビッカース/g, "ヴィッカース")
      .replace(/ジャギュア|ジャグア|ヤグアル/g, "ジャガー")
      .replace(/バンパイア/g, "ヴァンパイア")
      .replace(/ゲパード/g, "ゲパルト")
      .replace(/トルネード/g, "トーネード")
      .replace(/レオパルド/g, "レオパルト")
      .replace(/[〇零一二三四五六七八九十百千]+/g, normalizeKanjiNumber)
      .replace(/(^|[^a-z0-9])([ivxlcdm]+)(?=$|[^a-z0-9])/g,
        (whole, before, roman) => before + (romanNumbers[roman] || roman))
      // 括弧・空白・ハイフン・点・飾り記号などをすべて無視。
      .replace(/[^\p{L}\p{N}]/gu, "");
  }

  function isAnswer(vehicle, normalized) {
    return normalizeName(vehicle.name) === normalized ||
      normalizeName(vehicle.ja) === normalized ||
      (answerAliases[vehicle.id] || []).some((alias) => normalizeName(alias) === normalized);
  }

  function brText(value) { return Number(value).toFixed(1); }
  function notify(text) { $("message").textContent = text; }

  function matchesScope(vehicle, chosen) {
    if (chosen.country !== "all" && vehicle.country !== chosen.country) return false;
    if (chosen.mode === "ground" && vehicle.kind !== "ground") return false;
    if (chosen.mode === "air" && !["air", "heli"].includes(vehicle.kind)) return false;
    if (chosen.mode === "naval" && !["bluewater", "coastal"].includes(vehicle.kind)) return false;
    return vehicle.br >= chosen.min && vehicle.br <= chosen.max;
  }

  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); }
    catch (_) { return null; }
  }

  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (_) { /* 保存が使えない環境でもプレイ可能 */ }
  }

  function currentScope() {
    return {
      country: $("country").value,
      mode: $("mode").value,
      min: Number($("brMin").value),
      max: Number($("brMax").value)
    };
  }

  function progressKey() {
    return progressPrefix + [scope.country, scope.mode, brText(scope.min), brText(scope.max)].join(":");
  }

  function elapsedMs() {
    return elapsedBefore + (running ? Date.now() - clockStarted : 0);
  }

  function formatTime(ms) {
    const secs = Math.floor(ms / 1000);
    const h = Math.floor(secs / 3600);
    const m = String(Math.floor(secs / 60) % 60).padStart(2, "0");
    const s = String(secs % 60).padStart(2, "0");
    return h ? h + ":" + m + ":" + s : m + ":" + s;
  }

  function saveProgress() {
    if (!scope) return;
    writeJSON(progressKey(), {
      solved: [...solved],
      elapsed: elapsedMs(),
      started,
      ended,
      gaveUp
    });
  }

  function startClock() {
    if (running || ended) return;
    running = true;
    started = true;
    clockStarted = Date.now();
  }

  function stopClock() {
    elapsedBefore = elapsedMs();
    running = false;
  }

  function updatePreview() {
    const chosen = currentScope();
    const count = vehicles.filter((v) => matchesScope(v, chosen)).length;
    $("previewCount").textContent = count
      ? "対象 " + count + " 台 · BR " + brText(chosen.min) + " ～ " + brText(chosen.max)
      : "対象車両がありません。条件を変更してください。";
    $("apply").disabled = count === 0;
  }

  function makeTile(vehicle, index) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "tile";
    const number = document.createElement("span");
    number.className = "tile-number";
    number.textContent = String(index + 1).padStart(3, "0");
    const br = document.createElement("span");
    br.className = "tile-br";
    br.textContent = "BR " + brText(vehicle.br);
    const question = document.createElement("span");
    question.className = "tile-question";
    question.textContent = "?";
    const image = document.createElement("img");
    image.className = "tile-image";
    image.alt = "";
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => tile.classList.add("image-failed"));
    const name = document.createElement("span");
    name.className = "tile-name";
    name.textContent = vehicle.ja;
    const kind = document.createElement("span");
    kind.className = "tile-kind";
    kind.textContent = kindNames[vehicle.kind];
    tile.append(number, br, question, image, name, kind);
    tile.addEventListener("click", () => selectTile(vehicle));
    tileMap.set(vehicle.id, { tile, image });
    return tile;
  }

  function buildCollection() {
    $("collections").replaceChildren();
    tileMap.clear();
    countryCounters.clear();
    const byCountry = new Map();
    for (const vehicle of active) {
      if (!byCountry.has(vehicle.country)) byCountry.set(vehicle.country, []);
      byCountry.get(vehicle.country).push(vehicle);
    }

    let index = 0;
    for (const [country, list] of byCountry) {
      const section = document.createElement("section");
      section.className = "group";
      const heading = document.createElement("div");
      heading.className = "group-heading";
      const title = document.createElement("span");
      title.textContent = countries[country];
      const counter = document.createElement("small");
      countryCounters.set(country, counter);
      heading.append(title, counter);
      const grid = document.createElement("div");
      grid.className = "grid";
      const fragment = document.createDocumentFragment();
      for (const v of list) fragment.append(makeTile(v, index++));
      grid.append(fragment);
      section.append(heading, grid);
      $("collections").append(section);
    }
  }

  function updateScreen() {
    for (const v of active) {
      const nodes = tileMap.get(v.id);
      if (!nodes) continue;
      const correct = solved.has(v.id);
      const revealed = gaveUp && !correct;
      nodes.tile.classList.toggle("solved", correct);
      nodes.tile.classList.toggle("revealed", revealed);
      nodes.tile.classList.toggle("filtered", onlyUnsolved && correct);
      nodes.tile.classList.toggle("selected", selected === v.id && !ended && !correct);
      nodes.tile.setAttribute("aria-label", correct || revealed
        ? v.ja : "未回答 " + countries[v.country] + " " + kindNames[v.kind] +
          " BR " + brText(v.br));
      if ((correct || revealed) && !nodes.image.getAttribute("src")) {
        nodes.image.alt = v.ja;
        nodes.image.src = "https://wtvehiclesapi.duckdns.org/assets/techtrees/" +
          encodeURIComponent(v.id) + ".png";
      }
    }
    for (const [country, counter] of countryCounters) {
      const total = active.filter((v) => v.country === country).length;
      const done = active.filter((v) => v.country === country && solved.has(v.id)).length;
      counter.textContent = done + " / " + total;
    }
    $("score").textContent = solved.size + " / " + active.length;
    $("remaining").textContent = (active.length - solved.size) + "台";
    $("timer").textContent = formatTime(elapsedMs());
    $("collectionSummary").textContent = modeNames[scope.mode] + " · " + active.length + "台";
    $("onlyUnsolved").classList.toggle("active", onlyUnsolved);
    $("onlyUnsolved").textContent = onlyUnsolved ? "すべて表示" : "未回答だけ表示";
    $("answer").disabled = ended || !active.length;
    $("answerForm").querySelector("button").disabled = ended || !active.length;
    $("giveUp").disabled = ended || !active.length;
    $("hintType").disabled = ended || !selected;
    $("hintWeapon").disabled = ended || !selected || hintStage < 1;
    $("hintMask").disabled = ended || !selected || hintStage < 2;
    $("hintFirst").disabled = ended || !selected || hintStage < 3;
    if (!$("resultPanel").hidden) drawResult();
  }

  function startQuiz(reset = false) {
    const chosen = currentScope();
    const next = vehicles.filter((v) => matchesScope(v, chosen));
    if (!next.length) { notify("条件に合う車両がありません。"); return; }

    // リセット時に消した記録を再保存しない。同じ条件の記録だけを破棄する。
    if (scope) {
      stopClock();
      const sameScope = scope.country === chosen.country && scope.mode === chosen.mode &&
        scope.min === chosen.min && scope.max === chosen.max;
      if (!reset || !sameScope) saveProgress();
    }
    scope = chosen;
    active = next;
    if (reset) {
      try { localStorage.removeItem(progressKey()); } catch (_) {}
    }
    const state = reset ? {} : (readJSON(progressKey()) || {});
    const validIds = new Set(active.map((v) => v.id));
    solved = new Set((Array.isArray(state.solved) ? state.solved : [])
      .filter((id) => validIds.has(id)));
    ended = Boolean(state.ended);
    gaveUp = Boolean(state.gaveUp);
    elapsedBefore = Number.isFinite(state.elapsed) && state.elapsed > 0 ? state.elapsed : 0;
    started = Boolean(state.started);
    running = started && !ended;
    clockStarted = Date.now();
    if (solved.size === active.length) { ended = true; running = false; }
    selected = null;
    hintStage = 0;
    onlyUnsolved = false;

    writeJSON(settingsKey, chosen);
    buildCollection();
    $("answer").value = "";
    $("hintPanel").hidden = true;
    $("hintToggle").classList.remove("active");
    $("resultPanel").hidden = true;
    $("resultToggle").classList.remove("active");
    notify(ended ? (gaveUp ? "ギブアップ済みの結果です。" : "全問正解済みです。")
      : "車両名を入力してください。正解すると時間計測が始まります。");
    updateScreen();
    $("answer").focus();
  }

  function submitAnswer(event) {
    event.preventDefault();
    if (ended) return;
    const raw = $("answer").value.trim();
    const value = normalizeName(raw);
    if (!value) return;

    const matches = active.filter((v) => isAnswer(v, value));
    if (!matches.length) {
      const elsewhere = vehicles.some((v) => isAnswer(v, value));
      notify(elsewhere
        ? "登録されている名前ですが、現在の出題条件には含まれません。"
        : "該当する車両がありません。表記を確認してください。");
      return;
    }
    const fresh = matches.filter((v) => !solved.has(v.id));
    if (!fresh.length) { notify("その名前の車両は回答済みです。"); $("answer").select(); return; }
    startClock();
    fresh.forEach((v) => solved.add(v.id));
    selected = null;
    hintStage = 0;
    $("answer").value = "";
    notify("正解！ " + fresh[0].ja +
      (fresh.length > 1 ? " ほか " + (fresh.length - 1) + "台" : "") +
      "（" + solved.size + " / " + active.length + "）");

    if (solved.size === active.length) {
      stopClock();
      ended = true;
      notify("全 " + active.length + " 台正解しました！");
    }
    saveProgress();
    updateScreen();
    $("answer").focus();
  }

  function selectTile(vehicle) {
    if (ended || solved.has(vehicle.id)) return;
    selected = vehicle.id;
    hintStage = 0;
    $("hintPanel").hidden = false;
    $("hintToggle").classList.add("active");
    $("hintTarget").textContent = countries[vehicle.country] + " · " +
      kindNames[vehicle.kind] + " · BR " + brText(vehicle.br) + " の「？」を選択中";
    $("hintOutput").textContent = "ヒント1から順番に開示できます。";
    updateScreen();
  }

  // 名前の形だけを残す。NFCで「Ⅲ」などのローマ数字1文字表記を維持する。
  function maskName(name) {
    const source = String(name).normalize("NFC");
    // 英字のI/V/Xから成る独立したローマ数字と、Unicodeのローマ数字記号を一括して◇にする。
    // I-16 / V-990のような型式先頭の英字はローマ数字として扱わない。
    const romanMasked = source.replace(
      /[\u2160-\u2188]+|(?<![A-Za-z0-9])(?:[IVX]+)(?![A-Za-z0-9])/gu,
      (part, index) => index === 0 && /^-\d/u.test(source.slice(part.length)) ? part : "◇"
    );
    return Array.from(romanMasked, (char) => {
      if (char === "◇") return char;
      if (/\p{Nd}/u.test(char)) return "□";
      if (/[\p{L}\p{M}\p{Nl}]/u.test(char)) return "○";
      return char;
    }).join("");
  }

  function revealHint(stage) {
    const vehicle = active.find((v) => v.id === selected);
    if (!vehicle || ended || solved.has(vehicle.id) || stage > hintStage + 1) return;
    startClock();
    hintStage = Math.max(hintStage, stage);
    const lines = ["ヒント1： " + vehicle.role];
    if (hintStage >= 2) lines.push("ヒント2： " + vehicle.weapon);
    if (hintStage >= 3) {
      lines.push("ヒント3： 名称の形");
      lines.push("凡例：○＝文字1文字／□＝数字1桁／◇＝ローマ数字（ひとまとまり）");
      if (vehicle.jaOriginal) lines.push("日本語： " + maskName(vehicle.jaOriginal));
      lines.push("英語： " + maskName(vehicle.name));
    }
    if (hintStage >= 4) {
      lines.push("ヒント4： 名前の先頭「" + Array.from(vehicle.ja)[0] + "」");
    }
    $("hintOutput").textContent = lines.join("\n");
    saveProgress();
    updateScreen();
  }

  function giveUp() {
    if (ended || !window.confirm("ギブアップして未回答の車両名をすべて表示しますか？")) return;
    stopClock();
    ended = true;
    gaveUp = true;
    selected = null;
    hintStage = 0;
    saveProgress();
    updateScreen();
    notify("結果：" + solved.size + " / " + active.length + "台");
  }

  function scopeDescription() {
    return (scope.country === "all" ? "全国家" : countries[scope.country]) +
      " / " + modeNames[scope.mode] + " / BR " + brText(scope.min) +
      "～" + brText(scope.max);
  }

  function resultText() {
    const percent = active.length ? Math.round(solved.size / active.length * 100) : 0;
    return "War Thunder 全車両言えるかな？\n" + scopeDescription() + "\n" +
      solved.size + "/" + active.length + "台 正解（" + percent + "%）\n" +
      "経過時間 " + formatTime(elapsedMs()) + "\n" + location.href;
  }

  async function copyResult() {
    const text = resultText();
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw Error("Unsupported");
      await navigator.clipboard.writeText(text);
      notify("結果テキストをコピーしました。");
    } catch (_) { window.prompt("結果テキストをコピーしてください", text); }
  }

  function drawResult() {
    const canvas = $("resultCanvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    ctx.fillStyle = "#141c2a";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#d7ad69";
    ctx.fillRect(0, 0, w, 12);
    ctx.textAlign = "center";
    ctx.fillStyle = "#e9eef6";
    ctx.font = "bold 40px sans-serif";
    ctx.fillText("WAR THUNDER VEHICLE QUIZ", w / 2, 92);
    ctx.font = "24px sans-serif";
    ctx.fillStyle = "#b7c4d5";
    ctx.fillText(scopeDescription(), w / 2, 150);
    ctx.font = "bold 100px sans-serif";
    ctx.fillStyle = "#d7ad69";
    ctx.fillText(solved.size + " / " + active.length, w / 2, 280);
    ctx.fillStyle = "#e9eef6";
    ctx.font = "25px sans-serif";
    ctx.fillText("正答率 " + Math.round(solved.size / active.length * 100) +
      "%   |   経過時間 " + formatTime(elapsedMs()), w / 2, 336);
    ctx.font = "16px sans-serif";
    ctx.fillStyle = "#a9b8ca";
    ctx.fillText("RB " + catalog.version + " · manyu-a.github.io/chara-quiz/warthunder/", w / 2, 420);
  }

  function toggleResult() {
    $("resultPanel").hidden = !$("resultPanel").hidden;
    $("resultToggle").classList.toggle("active", !$("resultPanel").hidden);
    if (!$("resultPanel").hidden) drawResult();
  }

  // 初期化。設定と進捗はブラウザに保存し、出題条件ごとに分離する。
  for (const br of allBRs) {
    for (const id of ["brMin", "brMax"]) {
      const option = document.createElement("option");
      option.value = brText(br);
      option.textContent = brText(br);
      $(id).append(option);
    }
  }
  const previous = readJSON(settingsKey) || {};
  $("country").value = countries[previous.country] || previous.country === "all"
    ? previous.country : "japan";
  $("mode").value = modeNames[previous.mode] ? previous.mode : "ground";
  $("brMin").value = allBRs.includes(Number(previous.min)) ? brText(previous.min) : brText(allBRs[0]);
  $("brMax").value = allBRs.includes(Number(previous.max)) ? brText(previous.max) : "6.0";
  if (!$("brMax").value) $("brMax").value = brText(allBRs.at(-1));
  if (Number($("brMin").value) > Number($("brMax").value)) $("brMax").value = $("brMin").value;

  $("dataVersion").textContent = "ゲーム版 " + catalog.version;
  $("footerVersion").textContent = catalog.version;
  for (const id of ["country", "mode"]) $(id).addEventListener("change", updatePreview);
  $("brMin").addEventListener("change", () => {
    if (Number($("brMin").value) > Number($("brMax").value)) $("brMax").value = $("brMin").value;
    updatePreview();
  });
  $("brMax").addEventListener("change", () => {
    if (Number($("brMax").value) < Number($("brMin").value)) $("brMin").value = $("brMax").value;
    updatePreview();
  });
  $("apply").addEventListener("click", () => startQuiz());
  $("answerForm").addEventListener("submit", submitAnswer);
  $("hintToggle").addEventListener("click", () => {
    $("hintPanel").hidden = !$("hintPanel").hidden;
    $("hintToggle").classList.toggle("active", !$("hintPanel").hidden);
  });
  $("hintType").addEventListener("click", () => revealHint(1));
  $("hintWeapon").addEventListener("click", () => revealHint(2));
  $("hintMask").addEventListener("click", () => revealHint(3));
  $("hintFirst").addEventListener("click", () => revealHint(4));
  $("onlyUnsolved").addEventListener("click", () => {
    onlyUnsolved = !onlyUnsolved;
    updateScreen();
  });
  $("resultToggle").addEventListener("click", toggleResult);
  $("share").addEventListener("click", copyResult);
  $("giveUp").addEventListener("click", giveUp);
  $("restart").addEventListener("click", () => {
    if (!window.confirm("この条件の回答記録を消して最初からやり直しますか？")) return;
    startQuiz(true);
  });
  $("downloadResult").addEventListener("click", () => {
    drawResult();
    const anchor = document.createElement("a");
    anchor.href = $("resultCanvas").toDataURL("image/png");
    anchor.download = "war-thunder-quiz-result.png";
    anchor.click();
  });

  updatePreview();
  startQuiz();
  let tick = 0;
  window.setInterval(() => {
    if (!scope) return;
    $("timer").textContent = formatTime(elapsedMs());
    if (running && ++tick % 5 === 0) saveProgress();
  }, 1000);
  window.addEventListener("pagehide", saveProgress);
})();
