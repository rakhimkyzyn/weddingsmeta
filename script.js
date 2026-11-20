"use strict";

const positions = document.querySelector("#positions");
const template = document.querySelector("#position-template");
const addButton = document.querySelector("#add-position");
const grandTotal = document.querySelector("#grand-total");
const status = document.querySelector("#status");
const discountRate = document.querySelector("#discount-rate");
const vatRate = document.querySelector("#vat-rate");
const currency = document.querySelector("#currency");
const draftKey = "smeta-five-minutes-draft-v1";
const draftFields = {
  sender: document.querySelector('[name="sender"]'),
  recipient: document.querySelector('[name="recipient"]'),
  number: document.querySelector('[name="estimate-number"]'),
  date: document.querySelector("#estimate-date"),
  comment: document.querySelector("#comment"),
  discount: discountRate,
  vat: vatRate,
  currency,
  prepayment: document.querySelector("#prepayment"),
  weddingDate: document.querySelector("#wedding-date"),
  fittingDate: document.querySelector("#fitting-date"),
  article: document.querySelector("#dress-article"),
  size: document.querySelector("#dress-size"),
  color: document.querySelector("#dress-color"),
  alterations: document.querySelector("#dress-alterations"),
};
const legacyFields = ["sender", "recipient", "number", "date", "comment", "discount", "vat", "currency"];
const orderFieldLabels = { weddingDate: "Дата свадьбы", fittingDate: "Примерка", article: "Артикул платья", size: "Размер", color: "Цвет", alterations: "Необходимые изменения" };
const historyKey = "smeta-orders-v1";
const catalogKey = "smeta-catalog-v1";
let activeOrderId = null;
let catalogEditId = null;
let orders = [];
let catalog = [];
const positionFields = { name: ".item-name", quantity: ".item-quantity", unit: ".item-unit", price: ".item-price" };
let copyStatusTimer;
let validationStarted = false;
let validationErrorId = 0;
const validationErrors = new Map();
const currencyFormatter = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 0,
});

function readAmount(value) {
  const normalized = value.trim().replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function parseAmount(value) {
  return readAmount(value) ?? 0;
}

function formatMoney(amount, sign = currency.value) {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  return `${currencyFormatter.format(safeAmount).replace(/[\u00a0\u202f]/g, " ")} ${sign}`;
}

function roundMoney(amount) {
  return Number.isFinite(amount) ? Math.round(amount) : 0;
}

function recalculate() {
  let total = 0;
  for (const row of positions.rows) {
    const quantity = parseAmount(row.querySelector(".item-quantity").value);
    const price = parseAmount(row.querySelector(".item-price").value);
    const lineTotal = roundMoney(quantity * price);
    row.querySelector(".line-total").textContent = formatMoney(lineTotal);
    total += lineTotal;
  }
  total = roundMoney(total);
  const discount = roundMoney(total * (Math.min(100, parseAmount(discountRate.value)) / 100));
  const discounted = total - discount;
  const rate = parseAmount(vatRate.value);
  const vat = roundMoney(discounted * (rate / (100 + rate)));
  document.querySelector("#subtotal").textContent = formatMoney(total);
  document.querySelector("#discount-total").textContent = formatMoney(discount);
  document.querySelector("#discounted-total").textContent = formatMoney(discounted);
  document.querySelector("#vat-total").textContent = formatMoney(vat);
  document.querySelector("#discount-row").hidden = discount === 0;
  document.querySelector("#discounted-row").hidden = discounted === 0;
  document.querySelector("#vat-row").hidden = vat === 0;
  grandTotal.textContent = formatMoney(discounted);
  const prepayment = roundMoney(parseAmount(draftFields.prepayment.value));
  document.querySelector("#prepayment-total").textContent = formatMoney(prepayment);
  document.querySelector("#balance-total").textContent = formatMoney(Math.max(0, discounted - prepayment));
  for (const label of document.querySelectorAll(".price-label")) {
    label.textContent = `Цена, ${currency.value}`;
  }
  updateRowLabels();
  if (validationStarted) validateEstimate(false);
}

function clearValidation() {
  for (const [field, error] of validationErrors) {
    field.removeAttribute("aria-invalid");
    const descriptions = (field.getAttribute("aria-describedby") || "").split(" ").filter((id) => id && id !== error.id);
    if (descriptions.length) field.setAttribute("aria-describedby", descriptions.join(" "));
    else field.removeAttribute("aria-describedby");
    error.remove();
  }
  validationErrors.clear();
  document.querySelector("#validation-list").replaceChildren();
  document.querySelector("#validation-summary").hidden = true;
}

function validateEstimate(focus = true) {
  validationStarted = true;
  clearValidation();
  function report(field, message) {
    const error = document.createElement("span");
    error.id = `field-error-${++validationErrorId}`;
    error.className = "field-error";
    error.textContent = message;
    field.setAttribute("aria-invalid", "true");
    field.setAttribute("aria-describedby", `${field.getAttribute("aria-describedby") || ""} ${error.id}`.trim());
    field.insertAdjacentElement("afterend", error);
    validationErrors.set(field, error);
    const item = document.createElement("li");
    item.textContent = message;
    document.querySelector("#validation-list").append(item);
  }
  for (const [name, message] of Object.entries({
    sender: "Укажите название свадебного магазина в поле «От кого».",
    recipient: "Укажите имя клиента в поле «Для кого».",
    number: "Укажите номер сметы.",
    date: "Укажите дату сметы.",
  })) {
    if (!draftFields[name].value.trim()) report(draftFields[name], message);
  }
  if (!positions.rows.length) report(addButton, "Добавьте хотя бы одну позицию.");
  let total = 0;
  Array.from(positions.rows).forEach((row, index) => {
    const prefix = `Позиция ${index + 1}: `;
    const name = row.querySelector(".item-name");
    const quantityField = row.querySelector(".item-quantity");
    const priceField = row.querySelector(".item-price");
    const quantity = readAmount(quantityField.value);
    const price = readAmount(priceField.value);
    if (!name.value.trim()) report(name, `${prefix}укажите название товара или услуги.`);
    if (quantity === null || quantity <= 0) report(quantityField, `${prefix}количество должно быть числом больше нуля.`);
    if (price === null) report(priceField, `${prefix}укажите цену числом от нуля (0 — для подарка).`);
    else if (quantity !== null && quantity > 0) {
      const line = Math.round(quantity * price);
      total += line;
      if (!Number.isSafeInteger(line) || !Number.isSafeInteger(total)) report(priceField, `${prefix}сумма слишком велика. Проверьте количество и цену.`);
    }
  });
  for (const [field, title, maximum] of [[discountRate, "Скидка", 100], [vatRate, "НДС", Infinity]]) {
    const value = readAmount(field.value);
    if (value === null || value > maximum) report(field, `${title}: укажите число от 0${maximum === 100 ? " до 100" : ""}.`);
  }
  const prepayment = readAmount(draftFields.prepayment.value);
  const discounted = total - roundMoney(total * (Math.min(100, parseAmount(discountRate.value)) / 100));
  if (prepayment === null || !Number.isSafeInteger(Math.round(prepayment)) || Math.round(prepayment) > discounted) {
    report(draftFields.prepayment, "Предоплата должна быть числом от 0 до стоимости заказа после скидки.");
  }
  if (draftFields.weddingDate.value && draftFields.fittingDate.value && draftFields.fittingDate.value.slice(0, 10) > draftFields.weddingDate.value) {
    report(draftFields.fittingDate, "Дата примерки не должна быть позже даты свадьбы.");
  }
  const invalid = validationErrors.size > 0;
  document.querySelector("#validation-summary").hidden = !invalid;
  if (invalid && focus) validationErrors.keys().next().value.focus();
  return !invalid;
}

function updateRowLabels() {
  Array.from(positions.rows).forEach((row, index) => {
    const number = index + 1;
    for (const field of row.querySelectorAll("input, select")) {
      const label = field.closest("td").querySelector(".mobile-label").textContent;
      field.setAttribute("aria-label", `${label}, позиция ${number}`);
    }
    row.querySelector(".remove-button").setAttribute("aria-label", `Удалить позицию ${number}`);
  });
}

function createPosition(values = {}) {
  const row = template.content.firstElementChild.cloneNode(true);
  for (const [name, selector] of Object.entries(positionFields)) {
    if (typeof values[name] === "string") row.querySelector(selector).value = values[name];
  }
  return row;
}

function addPosition(focus = true) {
  const row = createPosition();
  positions.append(row);
  recalculate();
  if (focus) {
    row.querySelector(".item-name").focus();
    status.textContent = `Добавлена позиция ${positions.rows.length}`;
    saveDraft();
  }
}

addButton.addEventListener("click", () => addPosition());
positions.addEventListener("input", recalculate);
discountRate.addEventListener("input", recalculate);
vatRate.addEventListener("input", recalculate);
currency.addEventListener("change", recalculate);
currency.addEventListener("change", renderCatalog);
draftFields.prepayment.addEventListener("input", recalculate);
positions.addEventListener("click", (event) => {
  const button = event.target.closest(".remove-button");
  if (!button) return;
  const row = button.closest("tr");
  const nextRow = row.nextElementSibling || row.previousElementSibling;
  row.remove();
  recalculate();
  saveDraft();
  if (nextRow) nextRow.querySelector(".item-name").focus();
  else addButton.focus();
  status.textContent = `Позиция удалена. Осталось: ${positions.rows.length}`;
});
positions.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.isComposing || event.repeat) return;
  if (!event.target.matches("input, select")) return;
  if (event.target.closest("tr") !== positions.lastElementChild) return;
  event.preventDefault();
  addPosition();
});

function todayValue() {
  const today = new Date();
  return [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-");
}

function formatDocumentDate(value) {
  const parts = value.split("-");
  return parts.length === 3 && parts.every(Boolean) ? parts.reverse().join(".") : "—";
}

function preparePrint() {
  recalculate();
  const number = document.querySelector('[name="estimate-number"]').value.trim() || "—";
  const date = formatDocumentDate(document.querySelector("#estimate-date").value);
  document.querySelector("#print-title").textContent = `Смета № ${number} от ${date}`;

  // Текстовые копии не обрезают длинные значения и многострочный комментарий на печати.
  for (const field of document.querySelectorAll(".workspace input, .workspace select, .workspace textarea")) {
    if (field.closest(".calculation-settings") || field.closest("#copy-fallback") || field.closest(".screen-only") || field.closest(".payment-settings")) continue;
    let printedValue = field.parentElement.querySelector(".print-value");
    if (!printedValue) {
      printedValue = document.createElement("span");
      printedValue.className = "print-value";
      printedValue.setAttribute("aria-hidden", "true");
      field.insertAdjacentElement("afterend", printedValue);
    }
    let value = field.value;
    if (field.type === "date") value = formatDocumentDate(value);
    if (field.type === "datetime-local") value = formatFittingDate(value);
    if (field.matches(".item-price")) value = currencyFormatter.format(parseAmount(value));
    if (field.matches(".item-quantity")) value = String(parseAmount(value)).replace(".", ",");
    printedValue.textContent = value;
  }
}

document.querySelector("#save-pdf").addEventListener("click", () => {
  if (!validateEstimate()) return;
  preparePrint();
  window.print();
});
window.addEventListener("beforeprint", preparePrint);

function makeSnapshot() {
  return {
    version: 1,
    activeOrderId,
    fields: Object.fromEntries(Object.entries(draftFields).map(([name, field]) => [name, field.value])),
    positions: Array.from(positions.rows, (row) => Object.fromEntries(
      Object.entries(positionFields).map(([name, selector]) => [name, row.querySelector(selector).value])
    )),
  };
}

function saveDraft() {
  try {
    localStorage.setItem(draftKey, JSON.stringify(makeSnapshot()));
    document.querySelector("#draft-status").textContent = "Черновик сохранён в этом браузере.";
  } catch {
    document.querySelector("#draft-status").textContent = "Браузер не разрешил сохранить черновик. После обновления данные могут потеряться.";
  }
}

function validSnapshot(draft) {
  return Boolean(draft && draft.version === 1 && draft.fields && Array.isArray(draft.positions)
    && legacyFields.every((name) => typeof draft.fields[name] === "string")
    && Object.keys(draftFields).every((name) => draft.fields[name] === undefined || typeof draft.fields[name] === "string")
    && ["₸", "₽", "$", "€"].includes(draft.fields.currency)
    && draft.positions.every((row) => row && Object.keys(positionFields).every((name) => typeof row[name] === "string") && ["шт", "час", "услуга"].includes(row.unit)));
}

function applySnapshot(draft) {
  validationStarted = false;
  clearValidation();
  clearCopyFeedback();
  for (const [name, field] of Object.entries(draftFields)) field.value = draft.fields[name] ?? (name === "prepayment" ? "0" : "");
  activeOrderId = typeof draft.activeOrderId === "string" ? draft.activeOrderId : null;
  positions.replaceChildren(...draft.positions.map(createPosition));
  recalculate();
}

function restoreDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(draftKey));
    if (!validSnapshot(draft)) return false;
    applySnapshot(draft);
    document.querySelector("#draft-status").textContent = "Черновик восстановлен.";
    return true;
  } catch {
    return false;
  }
}

document.querySelector(".workspace").addEventListener("input", (event) => {
  if (event.target.closest(".screen-only") || event.target.readOnly) return;
  if (event.target.matches("input, select, textarea") && !event.target.readOnly) saveDraft();
  if (validationStarted) validateEstimate(false);
});
document.querySelector(".workspace").addEventListener("change", (event) => {
  if (event.target.closest(".screen-only") || event.target.readOnly) return;
  if (event.target.matches("input, select, textarea") && !event.target.readOnly) saveDraft();
  if (validationStarted) validateEstimate(false);
});

function nextEstimateNumber(value) {
  const current = value.trim();
  if (!current) return "1";
  if (!/\d+$/.test(current)) return `${current}-1`;
  return current.replace(/\d+$/, (digits) => String(BigInt(digits) + 1n).padStart(digits.length, "0"));
}

function clearCopyFeedback() {
  clearTimeout(copyStatusTimer);
  document.querySelector("#copy-status").textContent = "";
  document.querySelector("#copy-fallback").hidden = true;
  document.querySelector("#copy-text").value = "";
}

document.querySelector("#new-estimate").addEventListener("click", () => {
  if (!window.confirm("Создать новую смету? Текущий черновик будет очищен.")) return;
  const number = nextEstimateNumber(draftFields.number.value);
  for (const field of Object.values(draftFields)) field.value = "";
  draftFields.number.value = number;
  draftFields.date.value = todayValue();
  discountRate.value = "0";
  vatRate.value = "0";
  currency.value = "₸";
  draftFields.prepayment.value = "0";
  activeOrderId = null;
  positions.replaceChildren(createPosition());
  validationStarted = false;
  clearValidation();
  clearCopyFeedback();
  recalculate();
  saveDraft();
  renderCatalog();
  document.querySelector("#order-status").textContent = "";
  draftFields.sender.focus();
  status.textContent = `Создана новая смета № ${number}`;
});

function buildMessage() {
  recalculate();
  const lines = [`Смета № ${draftFields.number.value.trim() || "—"} от ${formatDocumentDate(draftFields.date.value)}`];
  if (draftFields.sender.value.trim()) lines.push(`От кого: ${draftFields.sender.value.trim()}`);
  if (draftFields.recipient.value.trim()) lines.push(`Для кого: ${draftFields.recipient.value.trim()}`);
  for (const [name, label] of Object.entries(orderFieldLabels)) {
    const value = draftFields[name].value.trim();
    if (value) lines.push(`${label}: ${name === "weddingDate" ? formatDocumentDate(value) : name === "fittingDate" ? formatFittingDate(value) : value}`);
  }
  lines.push("");
  for (const row of positions.rows) {
    const name = row.querySelector(".item-name").value.trim() || "Без наименования";
    const quantity = String(parseAmount(row.querySelector(".item-quantity").value)).replace(".", ",");
    const unit = row.querySelector(".item-unit").value;
    const price = formatMoney(parseAmount(row.querySelector(".item-price").value));
    lines.push(`• ${name} — ${quantity} ${unit} × ${price} = ${row.querySelector(".line-total").textContent}`);
  }
  lines.push("", `Сумма: ${document.querySelector("#subtotal").textContent}`);
  if (!document.querySelector("#discount-row").hidden) {
    lines.push(`Скидка: ${document.querySelector("#discount-total").textContent}`);
    lines.push(`Сумма со скидкой: ${document.querySelector("#discounted-total").textContent}`);
  }
  if (!document.querySelector("#vat-row").hidden) lines.push(`В том числе НДС (${vatRate.value.trim()} %): ${document.querySelector("#vat-total").textContent}`);
  lines.push(`Итого к оплате: ${grandTotal.textContent}`);
  lines.push(`Предоплата: ${document.querySelector("#prepayment-total").textContent}`);
  lines.push(`Осталось оплатить: ${document.querySelector("#balance-total").textContent}`);
  if (draftFields.comment.value.trim()) lines.push("", draftFields.comment.value.trim());
  return lines.join("\n");
}

document.querySelector("#copy-whatsapp").addEventListener("click", async () => {
  clearCopyFeedback();
  if (!validateEstimate()) return;
  const text = buildMessage();
  try {
    await navigator.clipboard.writeText(text);
    document.querySelector("#copy-status").textContent = "Скопировано ✓";
    copyStatusTimer = setTimeout(() => { document.querySelector("#copy-status").textContent = ""; }, 2000);
  } catch {
    document.querySelector("#copy-fallback").hidden = false;
    const field = document.querySelector("#copy-text");
    field.value = text;
    field.focus();
    field.select();
  }
});

function formatFittingDate(value) {
  if (!value) return "—";
  const [date, time] = value.split("T");
  return `${formatDocumentDate(date)}${time ? ` в ${time}` : ""}`;
}

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readCollection(key, validEntry, statusId) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries) || !entries.every(validEntry)) throw new Error("Invalid collection");
    return entries;
  } catch {
    document.querySelector(statusId).textContent = "Не удалось прочитать сохранённые данные в этом браузере.";
    return [];
  }
}

function writeCollection(key, entries, statusId) {
  try {
    localStorage.setItem(key, JSON.stringify(entries));
    return true;
  } catch {
    document.querySelector(statusId).textContent = "Не удалось сохранить данные. Проверьте доступ к хранилищу браузера.";
    return false;
  }
}

function actionButton(text, action, id) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-button";
  button.textContent = text;
  button.dataset.action = action;
  button.dataset.id = id;
  return button;
}

function listText(title, description) {
  const text = document.createElement("div");
  text.className = "saved-item-text";
  const strong = document.createElement("strong");
  strong.textContent = title;
  const small = document.createElement("small");
  small.textContent = description;
  text.append(strong, small);
  return text;
}

function renderCatalog() {
  const list = document.querySelector("#catalog-list");
  list.replaceChildren();
  const visible = catalog.filter((item) => item.currency === currency.value);
  for (const item of visible) {
    const li = document.createElement("li");
    li.append(listText(item.name, `${formatMoney(parseAmount(item.price), item.currency)} / ${item.unit}`),
      actionButton("Добавить в заказ", "add", item.id), actionButton("Изменить", "edit", item.id), actionButton("Удалить", "remove", item.id));
    list.append(li);
  }
  if (!visible.length) {
    const li = document.createElement("li");
    li.textContent = `В каталоге пока нет товаров в валюте ${currency.value}. Добавьте первый товар выше.`;
    list.append(li);
  }
}

function resetCatalogForm() {
  catalogEditId = null;
  document.querySelector("#catalog-form").reset();
  document.querySelector("#catalog-name").setCustomValidity("");
  document.querySelector("#catalog-price").setCustomValidity("");
  document.querySelector("#catalog-currency").value = currency.value;
  document.querySelector("#catalog-cancel").hidden = true;
  document.querySelector('#catalog-form button[type="submit"]').textContent = "Сохранить в каталог";
}

document.querySelector("#catalog-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const nameField = document.querySelector("#catalog-name");
  const priceField = document.querySelector("#catalog-price");
  const price = readAmount(priceField.value);
  nameField.setCustomValidity(nameField.value.trim() ? "" : "Укажите наименование.");
  priceField.setCustomValidity(price !== null && Number.isSafeInteger(Math.round(price)) ? "" : "Укажите цену числом от нуля.");
  if (!event.currentTarget.reportValidity()) return;
  const item = { id: catalogEditId || createId(), name: nameField.value.trim(), price: priceField.value.trim(), unit: document.querySelector("#catalog-unit").value, currency: document.querySelector("#catalog-currency").value };
  const updated = catalogEditId ? catalog.map((entry) => entry.id === catalogEditId ? item : entry) : [...catalog, item];
  if (!writeCollection(catalogKey, updated, "#catalog-status")) return;
  catalog = updated;
  resetCatalogForm();
  renderCatalog();
  document.querySelector("#catalog-status").textContent = "Товар сохранён в каталог.";
});
for (const id of ["#catalog-name", "#catalog-price"]) {
  document.querySelector(id).addEventListener("input", (event) => event.target.setCustomValidity(""));
}
document.querySelector("#catalog-cancel").addEventListener("click", resetCatalogForm);
document.querySelector("#catalog-list").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const item = catalog.find((entry) => entry.id === button.dataset.id);
  if (!item) return;
  if (button.dataset.action === "edit") {
    resetCatalogForm();
    catalogEditId = item.id;
    for (const name of ["name", "price", "unit", "currency"]) document.querySelector(`#catalog-${name}`).value = item[name];
    document.querySelector("#catalog-cancel").hidden = false;
    document.querySelector('#catalog-form button[type="submit"]').textContent = "Сохранить изменения";
    document.querySelector("#catalog-name").focus();
  } else if (button.dataset.action === "remove") {
    if (!window.confirm(`Удалить «${item.name}» из каталога? Позиции в заказах сохранятся.`)) return;
    const updated = catalog.filter((entry) => entry.id !== item.id);
    if (!writeCollection(catalogKey, updated, "#catalog-status")) return;
    catalog = updated;
    if (catalogEditId === item.id) resetCatalogForm();
    renderCatalog();
  } else if (button.dataset.action === "add") {
    if (item.currency !== currency.value) return;
    let row = Array.from(positions.rows).find((entry) => [".item-name", ".item-quantity", ".item-price"].every((selector) => !entry.querySelector(selector).value.trim()));
    if (!row) { row = createPosition(); positions.append(row); }
    for (const [name, value] of Object.entries({ name: item.name, quantity: "1", price: item.price, unit: item.unit })) row.querySelector(positionFields[name]).value = value;
    recalculate();
    saveDraft();
    row.querySelector(".item-quantity").focus();
    document.querySelector("#catalog-status").textContent = `«${item.name}» добавлено в заказ.`;
  }
});

function orderTotal(snapshot) {
  const sum = snapshot.positions.reduce((total, row) => total + roundMoney(parseAmount(row.quantity) * parseAmount(row.price)), 0);
  return sum - roundMoney(sum * (Math.min(100, parseAmount(snapshot.fields.discount)) / 100));
}

function renderHistory() {
  const list = document.querySelector("#history-list");
  const search = document.querySelector("#history-search").value.trim().toLocaleLowerCase("ru");
  list.replaceChildren();
  const visible = orders.filter((order) => [order.snapshot.fields.recipient, order.snapshot.fields.number, order.snapshot.fields.article || ""].join(" ").toLocaleLowerCase("ru").includes(search));
  for (const order of visible) {
    const fields = order.snapshot.fields;
    const li = document.createElement("li");
    li.append(listText(`№ ${fields.number} · ${fields.recipient}`, `${formatDocumentDate(fields.date)} · ${formatMoney(orderTotal(order.snapshot), fields.currency)}${fields.weddingDate ? ` · Свадьба ${formatDocumentDate(fields.weddingDate)}` : ""}`), actionButton("Открыть и изменить", "open", order.id));
    list.append(li);
  }
  if (!visible.length) {
    const li = document.createElement("li");
    li.textContent = search ? "Заказы не найдены." : "Сохранённых заказов пока нет.";
    list.append(li);
  }
}

document.querySelector("#save-order").addEventListener("click", () => {
  if (!validateEstimate()) return;
  const id = activeOrderId || createId();
  const snapshot = { ...makeSnapshot(), activeOrderId: id };
  const order = { id, snapshot, updatedAt: new Date().toISOString() };
  const updated = [order, ...orders.filter((entry) => entry.id !== id)];
  if (!writeCollection(historyKey, updated, "#order-status")) return;
  orders = updated;
  activeOrderId = id;
  saveDraft();
  renderHistory();
  document.querySelector("#order-status").textContent = `Заказ № ${draftFields.number.value} сохранён в историю.`;
});
document.querySelector("#history-search").addEventListener("input", renderHistory);
document.querySelector("#history-list").addEventListener("click", (event) => {
  const button = event.target.closest('button[data-action="open"]');
  if (!button) return;
  const order = orders.find((entry) => entry.id === button.dataset.id);
  if (!order || !window.confirm("Открыть сохранённый заказ? Текущая форма будет заменена. Если нужно, сначала сохраните её в историю.")) return;
  applySnapshot(order.snapshot);
  activeOrderId = order.id;
  saveDraft();
  renderCatalog();
  draftFields.recipient.focus();
  document.querySelector("#order-status").textContent = "Заказ открыт. После редактирования нажмите «Сохранить заказ в историю».";
});

orders = readCollection(historyKey, (entry) => entry && typeof entry.id === "string" && validSnapshot(entry.snapshot), "#order-status");
catalog = readCollection(catalogKey, (entry) => entry && typeof entry.id === "string" && typeof entry.name === "string" && typeof entry.price === "string" && readAmount(entry.price) !== null && ["шт", "час", "услуга"].includes(entry.unit) && ["₸", "₽", "$", "€"].includes(entry.currency), "#catalog-status");
if (!restoreDraft()) {
  draftFields.date.value = todayValue();
  addPosition(false);
}
resetCatalogForm();
renderCatalog();
renderHistory();
