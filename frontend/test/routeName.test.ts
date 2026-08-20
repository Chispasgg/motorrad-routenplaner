import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestRouteName } from "../src/routeName.js";

test("verbindet Start und Ziel", () => {
  assert.equal(suggestRouteName(["Bilbao", "Gernika"], false), "Bilbao → Gernika");
});

test("markiert eine Rundtour", () => {
  assert.equal(suggestRouteName(["Bilbao", "Gernika"], true), "Rundtour Bilbao");
});

test("nennt bei Zwischenzielen deren Anzahl", () => {
  assert.equal(
    suggestRouteName(["Bilbao", "Durango", "Gernika"], false),
    "Bilbao → Gernika (1 Zwischenziel)",
  );
  assert.equal(suggestRouteName(["A", "B", "C", "D"], false), "A → D (2 Zwischenziele)");
});

test("kürzt sehr lange Ortsnamen", () => {
  const lang = "Donostia / San Sebastián, Gipuzkoa, Euskadi, España";
  const name = suggestRouteName([lang, lang], false);
  assert.ok(name.length <= 120, `zu lang: ${name.length}`);
  assert.ok(name.includes("→"), name);
});

test("kommt mit leeren Bezeichnungen zurecht", () => {
  assert.equal(suggestRouteName(["", ""], false), "Route");
});

test("gibt bei zu wenigen Punkten einen neutralen Namen zurück", () => {
  assert.equal(suggestRouteName([], false), "Route");
  assert.equal(suggestRouteName(["Nur einer"], false), "Route");
});
