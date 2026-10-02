import { state } from "./state.js";
import { api } from "./api.js";
import { t, listLabel } from "./i18n.js";
import { $, el, icon, toast, openModal, closeModal, errorText } from "./dom.js";
import { renderLists, loadItems } from "./lists.js";

export async function loadRecipes() {
  const data = await api("/api/recipes");
  state.recipes = data.results || [];
  renderRecipes();
}

export function renderRecipes() {
  $("#recipesEmpty").hidden = state.recipes.length > 0;
  $("#recipesList").replaceChildren(
    ...state.recipes.map((r) => {
      const ingredients = Array.isArray(r.ingredients) ? r.ingredients : [];
      return el(
        "article",
        { class: "recipe-card" },
        el(
          "div",
          { class: "recipe-card-head" },
          el("div", {}, el("span", { class: "recipe-mark" }, icon("recipes")), el("strong", {}, r.name)),
          el(
            "div",
            { class: "recipe-actions" },
            el(
              "button",
              {
                type: "button",
                class: "row-action",
                title: t("editRecipe"),
                "aria-label": `${t("editRecipe")}: ${r.name}`,
                onclick: () => openRecipe(r),
              },
              icon("edit"),
            ),
            el(
              "button",
              {
                type: "button",
                class: "row-action danger",
                title: t("deleteRecipe"),
                "aria-label": `${t("deleteRecipe")}: ${r.name}`,
                onclick: () => deleteRecipe(r),
              },
              icon("close"),
            ),
          ),
        ),
        el(
          "div",
          { class: "recipe-ingredients" },
          ingredients.length
            ? ingredients.slice(0, 6).map((x) => el("span", {}, `• ${x}`))
            : el("span", { class: "empty-ingredient" }, t("recipeNoIngredients")),
          ingredients.length > 6 ? el("span", { class: "more" }, `+${ingredients.length - 6}`) : null,
        ),
        r.notes ? el("p", { class: "recipe-notes" }, r.notes) : null,
        el(
          "div",
          { class: "recipe-footer" },
          el(
            "button",
            { type: "button", class: "secondary small", dataset: { recipeAdd: r.id }, onclick: () => openRecipeAdd(r) },
            t("addToList"),
          ),
        ),
      );
    }),
  );
}

export function openRecipe(recipe = null) {
  state.editingRecipeId = recipe?.id || null;
  $("#recipeName").value = recipe?.name || "";
  $("#recipeIngredients").value = (recipe?.ingredients || []).join("\n");
  $("#recipeNotes").value = recipe?.notes || "";
  $("#recipeError").textContent = "";
  openModal("recipeModal", "#recipeName");
}
export const closeRecipe = () => {
  closeModal("recipeModal");
  state.editingRecipeId = null;
};

export async function saveRecipe() {
  const name = $("#recipeName").value.trim();
  if (!name) return;
  const body = {
    name,
    ingredients: $("#recipeIngredients")
      .value.split("\n")
      .map((x) => x.trim())
      .filter(Boolean),
    notes: $("#recipeNotes").value.trim(),
  };
  try {
    if (state.editingRecipeId) await api(`/api/recipes/${state.editingRecipeId}`, { method: "PUT", body });
    else await api("/api/recipes", { method: "POST", body });
    closeRecipe();
    await loadRecipes();
    toast(t("recipeSaved"));
  } catch (error) {
    $("#recipeError").textContent = errorText(error) || t("recipeError");
  }
}

export async function deleteRecipe(recipe) {
  if (!confirm(t("confirmDeleteRecipe"))) return;
  try {
    await api(`/api/recipes/${recipe.id}`, { method: "DELETE" });
    await loadRecipes();
    toast(t("recipeDeleted"));
  } catch (error) {
    toast(errorText(error), true);
  }
}

// ----------------------------------------------- adicionar ingredientes à lista
export function openRecipeAdd(recipe) {
  state.recipeToAdd = recipe.id;
  const ingredients = (recipe.ingredients || []).filter(Boolean);
  $("#recipeAddTitle").textContent = recipe.name;
  $("#recipeAddHint").textContent = ingredients.length ? t("recipeSelectIngredients") : t("recipeNoIngredients");
  $("#recipeAddList").replaceChildren(
    ...state.lists.map((list) => el("option", { value: list.id, selected: state.activeList?.id === list.id }, listLabel(list))),
  );
  $("#recipeIngredientChoices").replaceChildren(
    ...ingredients.map((name) =>
      el("label", { class: "recipe-choice" }, el("input", { type: "checkbox", checked: true, value: name }), el("span", {}, name)),
    ),
  );
  $("#recipeAddError").textContent = "";
  $("#recipeAddConfirm").disabled = !ingredients.length;
  openModal("recipeAddModal", "#recipeAddList");
}

export async function confirmRecipeAdd() {
  const list = state.lists.find((l) => l.id === $("#recipeAddList").value);
  const selected = [...document.querySelectorAll("#recipeIngredientChoices input:checked")].map((x) => x.value).filter(Boolean);
  const error = $("#recipeAddError");
  error.textContent = "";
  if (!list) return void (error.textContent = t("connectionError"));
  if (!selected.length) return void (error.textContent = t("recipeAddNone"));
  $("#recipeAddConfirm").disabled = true;
  try {
    await api(`/api/lists/${list.id}/items/bulk`, {
      method: "POST",
      body: { items: selected.map((name) => ({ name, category: "Outros", quantity: 1, unit: "un." })) },
    });
    state.activeList = list;
    closeModal("recipeAddModal");
    renderLists();
    await loadItems();
    toast(t("recipeAddedCount", { count: selected.length }));
  } catch (e) {
    error.textContent = errorText(e);
  } finally {
    $("#recipeAddConfirm").disabled = false;
  }
}
