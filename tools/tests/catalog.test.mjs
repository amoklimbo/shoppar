import { test } from "node:test";
import assert from "node:assert/strict";
import { SHOP_CATEGORIES, HOME_CATEGORIES, CATEGORY_KEYWORDS, guessCategory, categoriesFor } from "../../public/js/catalog.js";

const shop = { name: "Supermercado" };
const home = { name: "Casa" };

test("todas as categorias do dicionário existem nas listas de categorias (e vice-versa)", () => {
  for (const c of Object.keys(CATEGORY_KEYWORDS.shop)) assert.ok(SHOP_CATEGORIES.includes(c), `Supermercado sem chip: ${c}`);
  for (const c of Object.keys(CATEGORY_KEYWORDS.home)) assert.ok(HOME_CATEGORIES.includes(c), `Casa sem chip: ${c}`);
  for (const c of SHOP_CATEGORIES.filter((c) => (c !== "Outros" && c !== "Higiene" && c !== "Casa" ? true : true))) {
    if (c !== "Outros") assert.ok(CATEGORY_KEYWORDS.shop[c], `categoria sem palavras: ${c}`);
  }
  assert.equal(SHOP_CATEGORIES.at(-1), "Outros");
  assert.equal(HOME_CATEGORIES.at(-1), "Outros");
});

test("deteção de categoria em exemplos reais", () => {
  const cases = [
    ["Leite", "Laticínios"],
    ["Atum", "Conservas"],
    ["atum em lata", "Conservas"],
    ["Atum fresco", "Carne e peixe"],
    ["Sardinhas", "Conservas"],
    ["Bolachas", "Snacks e doces"],
    ["Chocolate", "Mercearia"],
    ["Fraldas", "Bebé"],
    ["Pão", "Padaria"],
    ["Cerveja", "Bebidas"],
    ["Maçãs", "Fruta"],
    ["Papel higiénico", "Higiene"],
    ["tuna", "Conservas"],
  ];
  for (const [name, expected] of cases) assert.equal(guessCategory(shop, name), expected, name);
  assert.equal(guessCategory(home, "Detergente da loiça"), "Limpeza");
  assert.equal(guessCategory(home, "Lâmpada"), "Eletrónica");
  assert.equal(guessCategory(shop, "xyzzy"), null);
  for (const [name] of cases) assert.ok(categoriesFor(shop).includes(guessCategory(shop, name)));
});
