"use strict";

// 使徒一覧は characters.js にあります。
// HTML要素の取得と、性格ごとの表示色だけここで定義します。
const el = (id) => document.getElementById(id);
const groups = [
  ["純粋", "#a6c879"],
  ["狂気", "#e48ca0"],
  ["活発", "#e7b46b"],
  ["憂鬱", "#a88bce"],
  ["冷静", "#82b9d4"],
  ["裏面", "#b5a99f"]
];

// よく使われる短縮名・別表記。足したいときはここに追加します。
const aliases = {
  "シオン・ザ・DB": ["シオン", "シオンザDB", "シオンザディービー"],
  "コミー(水着)": ["水着コミー", "コミー水着", "水着こみー"],
  "スピッキー": ["スピキ"],
  "マエストロMK2": ["マエストロ", "マエストロマーク2"],
  "グウィン": ["グイン"],
  "エルフィン": ["エルピン"],
  "リニュア": ["リニューア"]
};

// カタカナ/ひらがな、半角/全角、スペース・記号の違いを吸収します。
function normalizeName(value) {
  return value.normalize("NFKC").toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 96))
    .replace(/[\s・･（）()_\-－.。]/g, "");
}

const saveKey = "trickcal-chara-quiz-v1";
let saved = {};
try {
  saved = JSON.parse(localStorage.getItem(saveKey) || "{}") || {};
} catch (_) {
  saved = {};
}

const validNames = new Set(characters.map((c) => c.name));
const solved = new Set((Array.isArray(saved.solved) ? saved.solved : [])
  .filter((name) => validNames.has(name)));
let ended = Boolean(saved.ended);
let gaveUp = Boolean(saved.gaveUp);
let elapsedBefore = Number(saved.elapsed) > 0 ? Number(saved.elapsed) : 0;
let running = Boolean(saved.started && !ended);
let clockStarted = Date.now();
let onlyUnsolved = false;
let selected = null;

const tileByName = new Map();
const countByGroup = new Map();

function currentElapsed() {
  return elapsedBefore + (running ? Date.now() - clockStarted : 0);
}

function formatTime(ms) {
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = String(Math.floor(seconds / 60) % 60).padStart(2, "0");
  const secs = String(seconds % 60).padStart(2, "0");
  return hours ? hours + ":" + minutes + ":" + secs : minutes + ":" + secs;
}

function saveProgress() {
  try {
    localStorage.setItem(saveKey, JSON.stringify({
      solved: [...solved],
      elapsed: currentElapsed(),
      started: running || Boolean(saved.started),
      ended,
      gaveUp
    }));
  } catch (_) {
    // プライベートブラウズなどで保存できない場合でもゲームは続けられます。
  }
}

function startClock() {
  if (running || ended) return;
  clockStarted = Date.now();
  running = true;
  saved.started = true;
}

function stopClock() {
  elapsedBefore = currentElapsed();
  running = false;
}

function notify(text) {
  el("message").textContent = text;
}

// 1キャラにつき「?」のマスを1つ作ります。
function createTile(character, index, color) {
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "tile";
  tile.style.setProperty("--color", color);

  const number = document.createElement("span");
  number.className = "index";
  number.textContent = String(index + 1).padStart(2, "0");

  const question = document.createElement("span");
  question.className = "question";
  question.textContent = "?";

  const image = document.createElement("img");
  image.className = "portrait";
  image.alt = "";
  image.loading = "lazy";
  image.referrerPolicy = "no-referrer";
  image.onerror = () => tile.classList.add("image-failed");

  const name = document.createElement("span");
  name.className = "name";
  name.textContent = character.name;

  tile.append(number, question, image, name);
  tile.addEventListener("click", () => selectTile(character, tile));
  tileByName.set(character.name, { tile, image });
  return tile;
}

function createCollections() {
  const container = el("collections");
  groups.forEach(([type, color]) => {
    const list = characters.filter((c) => c.type === type);
    if (!list.length) return;

    const section = document.createElement("section");
    section.className = "group";
    const heading = document.createElement("div");
    heading.className = "group-heading";
    heading.style.setProperty("--color", color);

    const dot = document.createElement("span");
    dot.className = "bullet";
    const title = document.createElement("span");
    title.textContent = type;
    const count = document.createElement("small");
    heading.append(dot, title, count);
    countByGroup.set(type, count);

    const grid = document.createElement("div");
    grid.className = "grid";
    list.forEach((c) => grid.append(createTile(c, characters.indexOf(c), color)));
    section.append(heading, grid);
    container.append(section);
  });
}

// 画像は正解・ギブアップしたときに初めて読み込みます。
function updateScreen() {
  characters.forEach((c) => {
    const { tile, image } = tileByName.get(c.name);
    const correct = solved.has(c.name);
    const revealed = gaveUp && !correct;
    tile.classList.toggle("solved", correct);
    tile.classList.toggle("revealed", revealed);
    tile.classList.toggle("filtered", onlyUnsolved && correct);
    tile.classList.toggle("selected", selected === c.name && !correct && !ended);
    tile.setAttribute("aria-label", correct || revealed ? c.name : "未回答の使徒・" + c.type);
    if ((correct || revealed) && !image.src) {
      image.alt = c.name;
      image.src = c.image;
    }
  });

  for (const [type, counter] of countByGroup) {
    const total = characters.filter((c) => c.type === type).length;
    const found = characters.filter((c) => c.type === type && solved.has(c.name)).length;
    counter.textContent = found + " / " + total;
  }
  el("score").textContent = solved.size + " / " + characters.length;
  el("remaining").textContent = (characters.length - solved.size) + "人";
  el("timer").textContent = formatTime(currentElapsed());
  el("collectionSummary").textContent = "全" + characters.length + "使徒";
  el("filterToggle").classList.toggle("active", onlyUnsolved);
  el("filterToggle").textContent = onlyUnsolved ? "すべて表示" : "未回答だけ表示";
  el("answer").disabled = ended;
  el("answerForm").querySelector("button").disabled = ended;
}

// 使徒を答える処理。正解時のみタイマーを開始します。
function submitAnswer(event) {
  event.preventDefault();
  if (ended) return;
  const input = el("answer");
  const answer = normalizeName(input.value.trim());
  if (!answer) return;

  const match = characters.find((c) =>
    [c.name, ...(aliases[c.name] || [])]
      .some((name) => normalizeName(name) === answer)
  );

  if (!match) {
    notify("その名前は登録されていません。入力を確認してください。");
    return;
  }
  if (solved.has(match.name)) {
    notify(match.name + " は回答済みです。");
    input.select();
    return;
  }

  startClock();
  solved.add(match.name);
  input.value = "";
  notify("正解！ " + match.name + "（" + solved.size + " / " + characters.length + "）");

  if (solved.size === characters.length) {
    stopClock();
    ended = true;
    notify("全問正解！ おめでとうございます。");
  }
  saveProgress();
  updateScreen();
  input.focus();
}

// 選択したマスに対してヒントを表示します。
function selectTile(character, tile) {
  if (ended || solved.has(character.name)) return;
  selected = character.name;
  el("hintPanel").hidden = false;
  el("hintTarget").textContent = "選択中：" + character.type + "属性の「？」（" +
    String(characters.indexOf(character) + 1).padStart(2, "0") + "番）";
  el("hintOutput").textContent = "種族・職業・配置・実装日から選べます。";
  updateScreen();
}

function showHint(field) {
  if (!selected || ended) {
    el("hintOutput").textContent = "先に未回答の「？」のマスを選んでください。";
    return;
  }
  const character = characters.find((c) => c.name === selected);
  const labels = { race: "種族", role: "職業", position: "配置", release: "実装日" };
  startClock();
  el("hintOutput").textContent = labels[field] + "：" + character[field];
  saveProgress();
  updateScreen();
}

function finishByGivingUp() {
  if (ended || !confirm("ギブアップして残りの答えを公開しますか？")) return;
  stopClock();
  ended = true;
  gaveUp = true;
  selected = null;
  saveProgress();
  updateScreen();
  notify("お疲れさまでした。正解は " + solved.size + " / " + characters.length + " 人です。");
  el("hintPanel").hidden = true;
}

// 結果カードはキャンバスで生成するため、画像ファイルやライブラリは不要です。
function drawResult() {
  const canvas = el("resultCanvas");
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = "#fff7e9";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#d7779a";
  ctx.fillRect(0, 0, w, 15);
  ctx.fillStyle = "#394555";
  ctx.textAlign = "center";
  ctx.font = "bold 38px sans-serif";
  ctx.fillText("トリッカル 全使徒言えるかな？", w / 2, 90);
  ctx.font = "19px sans-serif";
  ctx.fillStyle = "#7c8591";
  ctx.fillText("GLOBAL SERVER • CHARACTER QUIZ", w / 2, 126);
  ctx.fillStyle = "#c7668a";
  ctx.font = "bold 92px sans-serif";
  ctx.fillText(solved.size + " / " + characters.length, w / 2, 245);
  ctx.fillStyle = "#394555";
  ctx.font = "23px sans-serif";
  ctx.fillText("正答率 " + Math.round(solved.size / characters.length * 100) +
    "%   |   経過時間 " + formatTime(currentElapsed()), w / 2, 289);

  groups.forEach(([type, color], i) => {
    const x = 78 + (i % 3) * 265;
    const y = 349 + Math.floor(i / 3) * 58;
    const count = characters.filter((c) => c.type === type && solved.has(c.name)).length;
    const total = characters.filter((c) => c.type === type).length;
    ctx.fillStyle = color;
    ctx.fillRect(x, y - 17, 12, 17);
    ctx.textAlign = "left";
    ctx.fillStyle = "#394555";
    ctx.font = "19px sans-serif";
    ctx.fillText(type + "  " + count + "/" + total, x + 25, y - 2);
  });
  ctx.textAlign = "center";
  ctx.fillStyle = "#9b8b7c";
  ctx.font = "14px sans-serif";
  ctx.fillText("非公式ファン制作  •  manyu-a.github.io/chara-quiz", w / 2, 479);
}

function toggleResult() {
  const panel = el("resultPanel");
  panel.hidden = !panel.hidden;
  el("resultToggle").classList.toggle("active", !panel.hidden);
  if (!panel.hidden) drawResult();
}

async function shareResult() {
  const text = "トリッカル 全使徒言えるかな？\n" +
    solved.size + "/" + characters.length + "人 正解（" +
    Math.round(solved.size / characters.length * 100) +
    "%）\n" + window.location.href;
  if (navigator.share) {
    try { await navigator.share({ text }); } catch (_) {}
  } else if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      notify("結果をクリップボードにコピーしました。");
    } catch (_) {
      window.prompt("結果をコピーしてください", text);
    }
  } else {
    window.prompt("結果をコピーしてください", text);
  }
}

createCollections();
updateScreen();

if (ended) {
  notify(gaveUp ? "ギブアップ済みの結果を表示しています。" : "全問正解済みです。");
}

el("answerForm").addEventListener("submit", submitAnswer);
el("hintToggle").addEventListener("click", () => {
  const panel = el("hintPanel");
  panel.hidden = !panel.hidden;
  el("hintToggle").classList.toggle("active", !panel.hidden);
});
document.querySelectorAll("[data-hint]").forEach((button) =>
  button.addEventListener("click", () => showHint(button.dataset.hint))
);
el("filterToggle").addEventListener("click", () => {
  onlyUnsolved = !onlyUnsolved;
  updateScreen();
});
el("resultToggle").addEventListener("click", toggleResult);
el("share").addEventListener("click", shareResult);
el("giveup").addEventListener("click", finishByGivingUp);
el("restart").addEventListener("click", () => {
  if (!confirm("現在の回答を消して最初からやり直しますか？")) return;
  localStorage.removeItem(saveKey);
  location.reload();
});
el("downloadResult").addEventListener("click", () => {
  drawResult();
  const a = document.createElement("a");
  a.href = el("resultCanvas").toDataURL("image/png");
  a.download = "trickcal-quiz-result.png";
  a.click();
});

// ブラウザを再読み込みしても記録が残ります。
setInterval(() => {
  if (!running) return;
  el("timer").textContent = formatTime(currentElapsed());
  saveProgress();
}, 1000);
