// Categorias por tipo de lista, deteção automática da categoria e produtos já usados neste dispositivo.
import { store, KEYS } from "./state.js";

export const SHOP_CATEGORIES = [
  "Fruta",
  "Vegetais",
  "Laticínios",
  "Carne e peixe",
  "Padaria",
  "Mercearia",
  "Conservas",
  "Snacks e doces",
  "Bebidas",
  "Congelados",
  "Higiene",
  "Casa",
  "Animais",
  "Bebé",
  "Outros",
];
export const HOME_CATEGORIES = [
  "Limpeza",
  "Cozinha",
  "Casa de banho",
  "Quarto e sala",
  "Bricolage",
  "Jardim",
  "Eletrónica",
  "Animais",
  "Outros",
];

export const isHomeList = (list) => list?.name === "Casa";
export const categoriesFor = (list) => (isHomeList(list) ? HOME_CATEGORIES : SHOP_CATEGORIES);

// Posição de uma categoria no percurso da loja; desconhecidas ficam antes de "Outros".
export function categoryRank(list, category) {
  const set = categoriesFor(list);
  const i = set.indexOf(category);
  return i >= 0 ? i : category === "Outros" ? set.length + 1 : set.length;
}

// Palavras (sem acentos, minúsculas) que identificam cada categoria; português e inglês.
const w = (text) => text.split(/\s+/);
const SHOP_WORDS = {
  Fruta: w(
    "maca pera banana laranja limao uva uvas morango morangos melancia melao kiwi ananas manga pessego ameixa cereja framboesas mirtilos abacate tangerina clementina figo fruta apple orange lemon grapes strawberry strawberries pear peach cherry avocado fruit",
  ),
  Vegetais: w(
    "alface tomate tomates cebola alho batata batatas cenoura cenouras curgete pepino pimento brocolos couve espinafres cogumelos beringela abobora salada rucula nabo beterraba alho-frances legumes vegetais lettuce tomato onion garlic potato potatoes carrot cucumber spinach mushrooms salad vegetables",
  ),
  Laticínios: w(
    "leite queijo iogurte iogurtes manteiga natas requeijao ovos ovo skyr kefir mozzarella milk cheese yogurt butter cream eggs egg",
  ),
  "Carne e peixe": w(
    "frango carne bife bifes peru porco vaca salmao bacalhau peixe camarao fiambre chourico salsichas presunto hamburguer hamburgueres carne-picada polvo lulas robalo dourada chicken beef pork fish salmon shrimp ham sausage meat",
  ),
  Padaria: w("pao baguete bolo bolos croissant torradas broa carcaca bread cake bagel pastel pasteis"),
  Mercearia: w(
    "arroz massa esparguete farinha acucar sal azeite oleo vinagre cafe cha cereais feijao grao lentilhas molho ketchup maionese mostarda cacau chocolate mel compota nutella aveia fermento rice pasta flour sugar salt coffee tea cereal beans sauce",
  ),
  Conservas: w(
    "atum sardinhas sardinha cavala anchovas conservas conserva pate ervilhas milho cogumelos-lata tuna sardines mackerel canned",
  ),
  "Snacks e doces": w(
    "bolachas bolacha chocolate chocolates gomas rebuscados pipocas batatas-fritas amendoins frutos-secos barras snacks cookies candy popcorn nuts crisps biscoitos doces",
  ),
  Animais: w("racao areia coleira petisco gato cao pet dog"),
  Bebé: w("fraldas papas biberao chucha toalhitas diapers baby"),
  Bebidas: w("agua sumo sumos refrigerante cerveja vinho cola sumol gin whisky vodka licor espumante juice water beer wine soda"),
  Congelados: w("gelado gelados congelado congelados nuggets pizza pizzas frozen"),
  Higiene: w(
    "champo sabonete dentifrico escova desodorizante gel creme cotonetes absorventes pensos shampoo soap toothpaste deodorant shaving lamina amaciante-cabelo condicionador fio-dentario",
  ),
  Casa: w(
    "detergente lixivia esfregao esponja amaciador desinfetante pilhas lampada aluminio pelicula guardanapos bleach sponge batteries",
  ),
};
const SHOP_PHRASES = {
  Higiene: ["pasta de dentes", "papel higienico", "gel de banho", "fio dentario", "protetor solar"],
  Casa: ["sacos do lixo", "papel de cozinha", "detergente da loica", "pastilhas maquina", "saco do lixo"],
  Mercearia: [],
  Conservas: ["tomate pelado", "feijao em lata", "grao em lata", "azeitonas", "atum em lata"],
  "Snacks e doces": ["batatas fritas", "frutos secos"],
  "Carne e peixe": ["atum fresco", "lombo de atum", "carne picada"],
  Vegetais: ["feijao verde"],
};
const HOME_WORDS = {
  Limpeza: w(
    "detergente lixivia esfregao esponja amaciador desinfetante vassoura pano panos luvas multiusos spray bleach mop broom cloth limpa-vidros pa balde",
  ),
  Cozinha: w("aluminio pelicula guardanapos tupperware panela frigideira tabuleiro talheres copos pratos tacas chavenas kitchen cutlery"),
  "Casa de banho": w("toalha toalhas cortina sabonete-liquido wc towel"),
  "Quarto e sala": w("lencois almofada almofadas edredon cobertor candeeiro sofa colchao cabides pillow sheets cobertores"),
  Bricolage: w("parafusos fita martelo chave tinta pregos bricolage tools drill paint glue cola berbequim"),
  Jardim: w("plantas planta vaso vasos terra adubo mangueira relva sementes garden"),
  Eletrónica: w("pilhas lampada carregador cabo tomada extensao bateria usb led battery charger cable bulb"),
  Animais: w("racao areia coleira petisco gato cao pet dog"),
};
const HOME_PHRASES = {
  Limpeza: ["sacos do lixo", "saco do lixo", "detergente da loica", "pastilhas maquina"],
  Cozinha: ["papel de cozinha"],
  "Casa de banho": ["papel higienico", "escova wc", "tapete de banho", "sabonete liquido"],
  "Quarto e sala": ["lencois de cama"],
};

export const normalize = (text) =>
  String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

function lookup(name, words, phrases) {
  const text = normalize(name);
  if (!text) return null;
  for (const [category, list] of Object.entries(phrases)) if (list.some((p) => text.includes(p))) return category;
  const tokens = text.split(/[^a-z0-9-]+/).filter(Boolean);
  for (const token of tokens) {
    const singular = token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token;
    for (const [category, list] of Object.entries(words)) if (list.includes(token) || list.includes(singular)) return category;
  }
  return null;
}

// ---- produtos conhecidos (neste dispositivo): categoria, unidade e último preço de cada nome
const MAX_KNOWN = 400;
let known = null;
function load() {
  if (known) return known;
  try {
    const parsed = JSON.parse(store.get(KEYS.known) || "{}");
    known = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    known = {};
  }
  return known;
}
function save() {
  const entries = Object.entries(load());
  if (entries.length > MAX_KNOWN) {
    entries.sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
    known = Object.fromEntries(entries.slice(0, MAX_KNOWN));
  }
  store.set(KEYS.known, JSON.stringify(known));
}

export function remember(list, item, manual = false) {
  const key = `${isHomeList(list) ? "h" : "s"}:${normalize(item.name)}`;
  if (!normalize(item.name)) return;
  const all = load();
  const previous = all[key] || { count: 0 };
  all[key] = {
    name: item.name,
    category: item.category,
    unit: item.unit || "un.",
    quantity: item.quantity || 1,
    price: item.price ?? previous.price ?? null,
    manual: manual || (previous.manual && previous.category === item.category) || false,
    count: previous.count + 1,
    at: Date.now(),
  };
  save();
}

// Junta os produtos de uma lista (vindos do servidor) sem alterar contagens já guardadas.
export function learnFrom(list, items) {
  const all = load();
  let changed = false;
  for (const item of items) {
    const key = `${isHomeList(list) ? "h" : "s"}:${normalize(item.name)}`;
    if (all[key] || !normalize(item.name)) continue;
    all[key] = {
      name: item.name,
      category: item.category,
      unit: item.unit || "un.",
      quantity: item.quantity || 1,
      price: item.price ?? null,
      count: 1,
      at: item.created_at || 0,
    };
    changed = true;
  }
  if (changed) save();
}

// Ordem de prioridade: escolha manual guardada → dicionário → categoria já usada (se não for "Outros").
export function guessCategory(list, name) {
  const key = `${isHomeList(list) ? "h" : "s"}:${normalize(name)}`;
  const set = categoriesFor(list);
  const seen = load()[key];
  if (seen?.manual && set.includes(seen.category)) return seen.category;
  const home = isHomeList(list);
  const guess = lookup(name, home ? HOME_WORDS : SHOP_WORDS, home ? HOME_PHRASES : SHOP_PHRASES);
  if (guess && set.includes(guess)) return guess;
  if (seen && seen.category !== "Outros" && set.includes(seen.category)) return seen.category;
  return null;
}

export const CATEGORY_KEYWORDS = { shop: SHOP_WORDS, home: HOME_WORDS };

// alias: devolve o nome tal como é mostrado (ex.: "Leite" → "Milk"), para também se encontrar por aí.
export function suggestions(list, text, limit = 4, alias = (x) => x) {
  const q = normalize(text);
  if (q.length < 2) return [];
  const prefix = `${isHomeList(list) ? "h" : "s"}:`;
  return Object.entries(load())
    .filter(
      ([key, v]) =>
        key.startsWith(prefix) &&
        [v.name, alias(v.name)].some((n) => normalize(n).includes(q)) &&
        ![v.name, alias(v.name)].some((n) => normalize(n) === q),
    )
    .sort(
      (a, b) =>
        Number(normalize(b[1].name).startsWith(q)) - Number(normalize(a[1].name).startsWith(q)) ||
        b[1].count - a[1].count ||
        (b[1].at || 0) - (a[1].at || 0),
    )
    .slice(0, limit)
    .map(([, v]) => v);
}
