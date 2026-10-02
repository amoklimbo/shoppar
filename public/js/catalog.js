// Categorias por tipo de lista, deteção automática da categoria e produtos já usados neste dispositivo.
import { store, KEYS } from "./state.js";

export const SHOP_CATEGORIES = [
  "Fruta",
  "Vegetais",
  "Laticínios",
  "Carne e peixe",
  "Padaria",
  "Mercearia",
  "Bebidas",
  "Congelados",
  "Higiene",
  "Casa",
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
    "frango carne bife bifes peru porco vaca salmao atum bacalhau peixe camarao fiambre chourico salsichas presunto hamburguer hamburgueres carne-picada polvo lulas robalo dourada chicken beef pork fish salmon tuna shrimp ham sausage meat",
  ),
  Padaria: w("pao baguete bolo bolos croissant torradas broa carcaca bread cake bagel pastel pasteis"),
  Mercearia: w(
    "arroz massa esparguete farinha acucar sal azeite oleo vinagre cafe cha cereais bolachas feijao grao lentilhas conservas molho ketchup maionese mostarda cacau chocolate mel compota nutella aveia fermento rice pasta flour sugar salt coffee tea cereal cookies beans sauce snacks",
  ),
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
  Mercearia: ["batatas fritas", "azeitonas"],
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

export function remember(list, item) {
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

export function guessCategory(list, name) {
  const key = `${isHomeList(list) ? "h" : "s"}:${normalize(name)}`;
  const seen = load()[key];
  if (seen && categoriesFor(list).includes(seen.category)) return seen.category;
  const home = isHomeList(list);
  return lookup(name, home ? HOME_WORDS : SHOP_WORDS, home ? HOME_PHRASES : SHOP_PHRASES);
}

export function suggestions(list, text, limit = 4) {
  const q = normalize(text);
  if (q.length < 2) return [];
  const prefix = `${isHomeList(list) ? "h" : "s"}:`;
  return Object.entries(load())
    .filter(([key, v]) => key.startsWith(prefix) && normalize(v.name).includes(q) && normalize(v.name) !== q)
    .sort(
      (a, b) =>
        Number(normalize(b[1].name).startsWith(q)) - Number(normalize(a[1].name).startsWith(q)) ||
        b[1].count - a[1].count ||
        (b[1].at || 0) - (a[1].at || 0),
    )
    .slice(0, limit)
    .map(([, v]) => v);
}
