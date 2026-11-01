# War Thunder 車両名クイズ

公開先： https://manyu-a.github.io/chara-quiz/warthunder/

HTML / CSS / JavaScript の静的サイトです。依存ライブラリやビルドは必要ありません。

## データ

- `vehicles.js`: ゲーム版 **2.59.0.94** の通常研究ツリー用スナップショット
- `update_data.py`: [War Thunder Datamine](https://github.com/gszabi99/War-Thunder-Datamine) を参照してデータを再生成する標準ライブラリのみの Python スクリプト
- 同じ国・内部IDに重複が生じないよう抽出し、プレミアム・イベント・所持者限定の列は除外
- 空の航空機には空RB、ヘリには陸RB、陸・海にはそれぞれのRBを使用
- 内部データは `[ID, 国家, 分類, RB, 英語名, 日本語名]` の配列形式

## 更新

**公開ライブ版**のデータマインコミットを確認してから、リポジトリルートで実行します。

```bash
python warthunder/update_data.py <公開ライブ版のコミットSHA>
```

データマインの `master` には開発サーバー版が混在するため、無確認で最新版の SHA を指定しないでください。車両の追加・削除、名称変更、BR変更を確認してから `vehicles.js` をコミットします。

## 判定・セーブ

- `app.js` は Unicode NFKC 正規化、大小文字差分の除去、スペース・句読点・ハイフン・括弧等の全記号の除去を行い、正式名称を比較します
- 文字列の部分一致・あいまいな編集距離は使わず、車両の派生型を誤回答として受理しないようにしています
- 国・兵種・BRの組み合わせとゲーム版ごとに、進捗をブラウザの `localStorage` に保存します
- 車両アイコンは名前を正解した際かギブアップ時だけ、[War Thunder Vehicles API](https://github.com/Sgambe33/WarThunder-Vehicles-API) から読み込みます（画像なしでもクイズは使用可能）
