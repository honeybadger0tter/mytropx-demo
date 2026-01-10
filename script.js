/* Tropx Demo Kit — Premium e-commerce interactions
   - Static friendly (catalog.json fallback)
   - Optional server mode (/api/catalog + /create-checkout-session)
*/

// Hero video: try to autoplay; if blocked/missing, hide video to avoid Safari play icon
(function(){
  const v = document.querySelector('.heroMedia');
  if(!v) return;
  const root = document.documentElement;
  const markNoVideo = () => root.classList.add('noHeroVideo');

  const tryPlay = async () => {
    try{
      v.muted = true;
      v.playsInline = true;
      // Some Safari builds need an explicit play() even with autoplay
      await v.play();
      if(v.paused) throw new Error('paused');
    }catch(e){
      markNoVideo();
    }
  };

  v.addEventListener('error', markNoVideo, { once:true });
  v.addEventListener('stalled', markNoVideo, { once:true });
  window.addEventListener('load', () => {
    tryPlay();
    // One more attempt after first paint
    setTimeout(tryPlay, 350);
  }, { once:true });
})();

const $ = (q) => document.querySelector(q);
const $$ = (q) => Array.from(document.querySelectorAll(q));

const STORAGE_KEY = "tropx_cart_v2";
const DROP_KEY = "tropx_drop_v1";
const FREE_SHIP_THRESHOLD = 100;

let CATALOG = [];
let cart = loadCart();

let activeCategory = "All";
let activeProductId = null;
let activeSize = null;

// Elements
const productGrid = $("#productGrid");
const featuredRail = $("#featuredRail");
const newRail = $("#newRail");

const searchInput = $("#searchInput");
const sortSelect = $("#sortSelect");
const chipRow = $("#chipRow");
const scrollToFeatured = $("#scrollToFeatured");

const modalBg = $("#modalBg");
const modalClose = $("#modalClose");
const modalImg = $("#modalImg");
const modalTitle = $("#modalTitle");
const modalPrice = $("#modalPrice");
const modalHint = $("#modalHint");
const modalDesc = $("#modalDesc");
const sizeRow = $("#sizeRow");
const similarGrid = $("#similarGrid");
const addToCartBtn = $("#addToCartBtn");
const quickCheckoutBtn = $("#quickCheckoutBtn");
const dropRow = $("#dropRow");
const dropTimer = $("#dropTimer");

const cartBtn = $("#cartBtn");
const cartDrop = $("#cartDrop");
const cartCount = $("#cartCount");
const cartItems = $("#cartItems");
const subtotalEl = $("#subtotal");
const shippingMotivation = $("#shippingMotivation");
const shipProg = $("#shipProg");
const shipProgFill = $("#shipProgFill");
const shipProgText = $("#shipProgText");
const checkoutBtn = $("#checkoutBtn");
const clearCartBtn = $("#clearCartBtn");
const estRow = $("#estRow");
const estShip = $("#estShip");

const toastEl = $("#toast");

function money(v){
  try{
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(Number(v || 0));
  }catch{
    return `$${Number(v||0).toFixed(2)}`;
  }
}

function escapeHtml(str){
  return String(str ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function debounce(fn, ms=120){
  let t=null;
  return (...args) => {
    clearTimeout(t);
    t=setTimeout(()=>fn(...args), ms);
  };
}

function showToast(msg){
  if(!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  toastEl.setAttribute("aria-hidden","false");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(()=>{
    toastEl.classList.remove("show");
    toastEl.setAttribute("aria-hidden","true");
  }, 1800);
}

function loadCart(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  }catch{
    return [];
  }
}
function saveCart(){
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(cart)); }catch{}
}

function keyFor(line){
  return `${line.id}__${line.size || ""}`;
}

function getProduct(id){
  return (CATALOG || []).find(p => p.id === id) || null;
}

function cartTotals(){
  let subtotal = 0;
  let count = 0;
  for(const line of cart){
    const p = getProduct(line.id);
    if(!p) continue;
    const qty = Number(line.qty || 0);
    subtotal += (Number(p.price) || 0) * qty;
    count += qty;
  }
  return { subtotal, count };
}

function addToCart(productId, size, qty=1){
  const p = getProduct(productId);
  if(!p) return;

  let chosen = size;
  if(!chosen && Array.isArray(p.sizes) && p.sizes.length){
    chosen = p.sizes[0];
  }
  const line = { id: productId, size: chosen || "", qty: Math.max(1, Number(qty || 1)) };

  // merge
  const idx = cart.findIndex(x => x.id === line.id && (x.size||"") === (line.size||""));
  if(idx >= 0){
    cart[idx].qty = Math.min(99, Number(cart[idx].qty || 0) + line.qty);
  }else{
    cart.push(line);
  }
  saveCart();
  renderCart();
}

function updateLineQty(id, size, delta){
  const idx = cart.findIndex(x => x.id === id && (x.size||"") === (size||""));
  if(idx < 0) return;
  const next = Number(cart[idx].qty || 0) + Number(delta || 0);
  if(next <= 0){
    cart.splice(idx, 1);
  }else{
    cart[idx].qty = Math.min(99, next);
  }
  saveCart();
  renderCart();
}

function removeLine(id, size){
  cart = cart.filter(x => !(x.id === id && (x.size||"") === (size||"")));
  saveCart();
  renderCart();
}

function clearCart(){
  cart = [];
  saveCart();
  renderCart();
}

function currentFulfillment(){
  const checked = document.querySelector('input[name="fulfillment"]:checked');
  return checked?.value || "ship";
}

function shippingEstimate(subtotal, fulfillment){
  if(fulfillment === "pickup") return 0;
  // Demo-friendly, plausible-ish tiers (not meant to be real pricing)
  if(subtotal >= FREE_SHIP_THRESHOLD) return 0;
  if(subtotal === 0) return 0;
  if(subtotal < 45) return 8.95;
  if(subtotal < 80) return 6.95;
  return 4.95;
}

function getDropMap(){
  // Always future-dated “limited drop” so the demo doesn’t expire on you.
  try{
    const raw = localStorage.getItem(DROP_KEY);
    if(raw){
      const parsed = JSON.parse(raw);
      if(parsed && typeof parsed === "object") return parsed;
    }
  }catch{}
  // Build new mapping: pick 4 products as limited, set end times 6–22 hours from now
  const map = {};
  const ids = (CATALOG || []).map(p=>p.id);
  const pick = shuffle(ids).slice(0, Math.min(4, ids.length));
  const now = Date.now();
  pick.forEach((id, i)=>{
    const hrs = 6 + Math.floor(Math.random()*17); // 6..22
    map[id] = { endsAt: now + hrs*60*60*1000, kind: i === 0 ? "hot" : "limited" };
  });
  try{ localStorage.setItem(DROP_KEY, JSON.stringify(map)); }catch{}
  return map;
}

function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function timeLeft(endsAt){
  const ms = Math.max(0, Number(endsAt || 0) - Date.now());
  const s = Math.floor(ms/1000);
  const h = Math.floor(s/3600);
  const m = Math.floor((s%3600)/60);
  const sec = s%60;
  if(h <= 0) return `${m}m ${sec}s`;
  return `${h}h ${m}m`;
}

function ensureChips(){
  if(!chipRow) return;
  const cats = ["All", ...Array.from(new Set((CATALOG||[]).map(p => p.category).filter(Boolean)))];
  chipRow.innerHTML = "";
  cats.forEach(cat => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (cat === activeCategory ? " active" : "");
    b.textContent = cat;
    b.addEventListener("click", () => {
      activeCategory = cat;
      $$(".chip").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      renderGrid();
    });
    chipRow.appendChild(b);
  });
}

function getVisibleCatalog(){
  const q = (searchInput?.value || "").trim().toLowerCase();
  const sort = sortSelect?.value || "featured";

  let items = (CATALOG || []).slice();

  if(activeCategory !== "All"){
    items = items.filter(p => String(p.category||"").toLowerCase() === activeCategory.toLowerCase());
  }

  if(q){
    items = items.filter(p => {
      const hay = `${p.name||""} ${(p.tags||[]).join(" ")} ${p.category||""}`.toLowerCase();
      return hay.includes(q);
    });
  }

  if(sort === "price-asc"){
    items.sort((a,b)=>Number(a.price||0)-Number(b.price||0));
  }else if(sort === "price-desc"){
    items.sort((a,b)=>Number(b.price||0)-Number(a.price||0));
  }else if(sort === "name"){
    items.sort((a,b)=>String(a.name||"").localeCompare(String(b.name||"")));
  }else{
    // “featured”: keep catalog order (curated)
  }

  return items;
}

function renderCard(p, dropMap){
  const el = document.createElement("div");
  el.className = "card";
  el.setAttribute("role","button");
  el.tabIndex = 0;

  const isNew = (p.tags||[]).some(t => String(t).toLowerCase() === "new");
  const isBest = (p.tags||[]).some(t => String(t).toLowerCase().includes("best"));
  const drop = dropMap?.[p.id];

  const badges = [];
  if(drop) badges.push(`<span class="badge ${drop.kind === "hot" ? "hot" : ""}">Limited Drop</span>`);
  if(isNew) badges.push(`<span class="badge new">New</span>`);
  if(isBest) badges.push(`<span class="badge">Best seller</span>`);

  el.innerHTML = `
    ${badges.length ? `<div class="badgeRow">${badges.join("")}</div>` : ""}
    <img class="cardImg" src="${p.image}" alt="${escapeHtml(p.name)}" loading="lazy">
    <div class="cardBody">
      <div class="cardTitle">${escapeHtml(p.name)}</div>
      <div class="cardMeta">
        <div class="cardPrice">${money(p.price)}</div>
        <button class="addBtn" type="button" aria-label="Add ${escapeHtml(p.name)} to cart">Add</button>
      </div>
    </div>
    <button class="cardQuick" type="button" aria-label="Quick view ${escapeHtml(p.name)}">Quick view</button>
  `;

  const addBtn = el.querySelector(".addBtn");
  const quickBtn = el.querySelector(".cardQuick");

  addBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    addToCart(p.id, p.sizes?.[0] || "", 1);
    showToast("Added to cart");
    setCartOpen(true);
  });

  quickBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    openProductModal(p.id);
  });

  el.addEventListener("click", () => openProductModal(p.id));
  el.addEventListener("keydown", (e) => {
    if(e.key === "Enter" || e.key === " "){
      e.preventDefault();
      openProductModal(p.id);
    }
  });

  return el;
}

function renderGrid(){
  const dropMap = getDropMap();

  const items = getVisibleCatalog();
  if(productGrid){
    productGrid.innerHTML = "";
    items.forEach(p => productGrid.appendChild(renderCard(p, dropMap)));
  }

  // Featured rail: best sellers first
  const featured = (CATALOG || []).filter(p => (p.tags||[]).some(t => String(t).toLowerCase().includes("best")));
  const featuredList = featured.length ? featured.slice(0,3) : (CATALOG || []).slice(0,3);

  if(featuredRail){
    featuredRail.innerHTML = "";
    featuredList.forEach(p => featuredRail.appendChild(renderCard(p, dropMap)));
  }

  // New rail: tag "new" or fallback
  const newList = (CATALOG || []).filter(p => (p.tags||[]).some(t => String(t).toLowerCase()==="new"));
  const finalNew = newList.length ? newList : (CATALOG || []).slice(2,6);

  if(newRail){
    newRail.innerHTML = "";
    finalNew.forEach(p => newRail.appendChild(renderCard(p, dropMap)));
  }
}

function setModalOpen(open){
  if(!modalBg) return;
  modalBg.setAttribute("aria-hidden", open ? "false" : "true");
  document.body.classList.toggle("modal-open", !!open);
  if(open){
    // simple focus
    modalClose?.focus?.();
  }
}

function setCartOpen(open){
  if(!cartDrop || !cartBtn) return;
  cartBtn.setAttribute("aria-expanded", open ? "true" : "false");
  cartDrop.setAttribute("aria-hidden", open ? "false" : "true");
}

function openProductModal(productId){
  const p = getProduct(productId);
  if(!p) return;

  activeProductId = p.id;
  activeSize = (p.sizes && p.sizes.length) ? p.sizes[0] : "";

  // Media
  if(modalImg){
    modalImg.src = p.image;
    modalImg.alt = p.name;
  }

  if(modalTitle) modalTitle.textContent = p.name;
  if(modalPrice) modalPrice.textContent = money(p.price);

  // Hint that sells speed
  const tags = (p.tags||[]).map(t => String(t).toLowerCase());
  const hint =
    tags.includes("best seller") ? "Best seller energy. Sells fast." :
    tags.includes("new") ? "Fresh drop. Early tap gets the good sizes." :
    "Premium fit. Clean finish. No compromises.";
  if(modalHint) modalHint.textContent = hint;

  if(modalDesc) modalDesc.textContent = p.description || "Premium materials, sharp silhouette, and built-for-repeat wear. This is the kind of piece that upgrades a whole outfit.";

  // Limited drop timer (session-based)
  const dropMap = getDropMap();
  const drop = dropMap?.[p.id];
  if(dropRow && dropTimer){
    if(drop){
      dropRow.setAttribute("aria-hidden","false");
      dropTimer.textContent = `Ends in ${timeLeft(drop.endsAt)}`;
      // update timer a few times
      clearInterval(openProductModal._t);
      openProductModal._t = setInterval(()=>{
        dropTimer.textContent = `Ends in ${timeLeft(drop.endsAt)}`;
      }, 1000);
    }else{
      dropRow.setAttribute("aria-hidden","true");
      clearInterval(openProductModal._t);
    }
  }

  // Sizes
  if(sizeRow){
    sizeRow.innerHTML = "";
    const sizes = Array.isArray(p.sizes) ? p.sizes : [];
    if(sizes.length){
      sizes.forEach(s => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "sizeBtn" + (s === activeSize ? " active" : "");
        b.textContent = s;
        b.addEventListener("click", () => {
          activeSize = s;
          $$(".sizeBtn").forEach(x => x.classList.remove("active"));
          b.classList.add("active");
        });
        sizeRow.appendChild(b);
      });
    }
  }

  // Similar
  if(similarGrid){
    const pool = (CATALOG || []).filter(x => x.id !== p.id && x.category === p.category);
    const list = (pool.length ? pool : (CATALOG || []).filter(x => x.id !== p.id)).slice(0, 3);
    similarGrid.innerHTML = "";
    list.forEach(sp => similarGrid.appendChild(renderCard(sp, dropMap)));
  }

  setModalOpen(true);
}

function closeProductModal(){
  setModalOpen(false);
  clearInterval(openProductModal._t);
}

function renderCart(){
  const { subtotal, count } = cartTotals();
  if(cartCount) cartCount.textContent = String(count);

  // Motivation + progress
  const fulfill = currentFulfillment();
  if(fulfill === "pickup"){
    if(shippingMotivation) shippingMotivation.textContent = "Pickup selected — no shipping needed.";
    if(shipProg) shipProg.setAttribute("aria-hidden","true");
    if(shipProgText) shipProgText.textContent = "";
  }else{
    const remaining = Math.max(0, FREE_SHIP_THRESHOLD - subtotal);
    if(subtotal <= 0){
      if(shippingMotivation) shippingMotivation.textContent = `Free shipping over ${money(FREE_SHIP_THRESHOLD)}.`;
      if(shipProg) shipProg.setAttribute("aria-hidden","true");
      if(shipProgText) shipProgText.textContent = "";
    }else if(remaining <= 0){
      if(shippingMotivation) shippingMotivation.textContent = "Free shipping unlocked.";
      if(shipProg) shipProg.setAttribute("aria-hidden","false");
      if(shipProgFill) shipProgFill.style.width = "100%";
      if(shipProgText) shipProgText.textContent = `You hit ${money(FREE_SHIP_THRESHOLD)} — shipping is on us.`;
    }else{
      if(shippingMotivation) shippingMotivation.textContent = `Add ${money(remaining)} more for free shipping.`;
      if(shipProg) shipProg.setAttribute("aria-hidden","false");
      const pct = Math.max(0, Math.min(100, (subtotal / FREE_SHIP_THRESHOLD) * 100));
      if(shipProgFill) shipProgFill.style.width = `${pct.toFixed(0)}%`;
      if(shipProgText) shipProgText.textContent = `${money(subtotal)} / ${money(FREE_SHIP_THRESHOLD)} toward free shipping.`;
    }
  }

  // Shipping estimate
  const est = shippingEstimate(subtotal, fulfill);
  if(estRow && estShip){
    if(fulfill === "pickup"){
      estRow.style.display = "none";
    }else{
      estRow.style.display = "flex";
      estShip.textContent = money(est);
    }
  }

  if(subtotalEl) subtotalEl.textContent = money(subtotal);
  if(checkoutBtn) checkoutBtn.disabled = cart.length === 0;

  // Render mini list (grouped)
  if(!cartItems) return;
  cartItems.innerHTML = "";

  if(cart.length === 0){
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.style.padding = "10px 0 2px";
    empty.textContent = "Your cart is empty. Add something that makes you feel powerful.";
    cartItems.appendChild(empty);
    return;
  }

  const grouped = new Map();
  for(const line of cart){
    const k = keyFor(line);
    const existing = grouped.get(k);
    if(existing){
      existing.qty += Number(line.qty || 0);
    }else{
      grouped.set(k, { ...line, qty: Number(line.qty || 0) });
    }
  }

  const groupArr = Array.from(grouped.values());

  // show up to 4 items for the dropdown
  groupArr.slice(0,4).forEach(line => {
    const p = getProduct(line.id);
    if(!p) return;

    const itemEl = document.createElement("div");
    itemEl.className = "cartItem";
    const lineTotal = (Number(p.price||0) * Number(line.qty||0));

    itemEl.innerHTML = `
      <img class="cartThumb" src="${p.image}" alt="">
      <div>
        <div class="cartLineTitle">${escapeHtml(p.name)}</div>
        <div class="cartLineMeta">${line.size ? `Size ${escapeHtml(line.size)} • ` : ""}${money(p.price)} each</div>
        <div class="qtyRow">
          <button class="qtyBtn" type="button" aria-label="Decrease quantity">−</button>
          <div class="qtyNum" aria-label="Quantity">${line.qty}</div>
          <button class="qtyBtn" type="button" aria-label="Increase quantity">+</button>
          <button class="removeBtn" type="button">Remove</button>
        </div>
      </div>
      <div style="text-align:right; font-weight:950;">${money(lineTotal)}</div>
    `;

    const [decBtn, incBtn] = itemEl.querySelectorAll(".qtyBtn");
    const removeBtn = itemEl.querySelector(".removeBtn");

    decBtn?.addEventListener("click", (e) => { e.stopPropagation(); updateLineQty(line.id, line.size, -1); });
    incBtn?.addEventListener("click", (e) => { e.stopPropagation(); updateLineQty(line.id, line.size, +1); });
    removeBtn?.addEventListener("click", (e) => { e.stopPropagation(); removeLine(line.id, line.size); });

    itemEl.addEventListener("click", () => openProductModal(p.id));
    cartItems.appendChild(itemEl);
  });

  if(groupArr.length > 4){
    const more = document.createElement("div");
    more.className = "muted tiny";
    more.style.padding = "6px 0 0";
    more.textContent = `+ ${groupArr.length - 4} more item(s) in cart`;
    cartItems.appendChild(more);
  }
}

async function checkout(){
  if(cart.length === 0) return;
  const items = cart.map(line => ({ id: line.id, size: line.size || "", qty: Number(line.qty||1) }));
  const fulfillment = currentFulfillment();

  try{
    const res = await fetch("/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, fulfillment })
    });
    const data = await res.json();
    if(data?.url){
      window.location.href = data.url;
      return;
    }
  }catch(e){
    // ignore
  }
  // Static fallback
  window.location.href = "/success.html?demo=1";
}

/* Event wiring */
function wire(){
  // Search/sort
  searchInput?.addEventListener("input", debounce(renderGrid, 120));
  sortSelect?.addEventListener("change", renderGrid);

  // Featured scroll button (hero)
  scrollToFeatured?.addEventListener("click", () => {
    document.querySelector("#featured")?.scrollIntoView({ behavior: "smooth" });
  });

  // Modal close
  modalClose?.addEventListener("click", closeProductModal);
  modalBg?.addEventListener("click", (e) => {
    if(e.target === modalBg) closeProductModal();
  });
  document.addEventListener("keydown", (e) => {
    if(e.key === "Escape"){
      // Close whichever is open
      const modalOpen = modalBg?.getAttribute("aria-hidden") === "false";
      const cartOpen = cartDrop?.getAttribute("aria-hidden") === "false";
      if(modalOpen) closeProductModal();
      if(cartOpen) setCartOpen(false);
    }
  });

  // Modal actions
  addToCartBtn?.addEventListener("click", () => {
    if(!activeProductId) return;
    addToCart(activeProductId, activeSize || "", 1);
    showToast("Added to cart");
    setModalOpen(false);
    setCartOpen(true);
  });

  quickCheckoutBtn?.addEventListener("click", () => {
    if(!activeProductId) return;
    addToCart(activeProductId, activeSize || "", 1);
    setModalOpen(false);
    setCartOpen(true);
    checkout();
  });

  // Cart dropdown
  cartBtn?.addEventListener("click", () => {
    const open = cartDrop?.getAttribute("aria-hidden") === "false";
    setCartOpen(!open);
  });

  document.addEventListener("click", (e) => {
    const open = cartDrop?.getAttribute("aria-hidden") === "false";
    if(!open) return;
    if(cartDrop?.contains(e.target) || cartBtn?.contains(e.target)) return;
    setCartOpen(false);
  });

  // Fulfillment changes should update progress/estimate
  $$('input[name="fulfillment"]').forEach(r => {
    r.addEventListener("change", renderCart);
  });

  clearCartBtn?.addEventListener("click", clearCart);
  checkoutBtn?.addEventListener("click", checkout);
}

/* Init */
(async function init(){
  wire();

  try{
    // Prefer server catalog when running with server.js
    const res = await fetch("/api/catalog", { cache: "no-store" });
    if(!res.ok) throw new Error("Server catalog unavailable");
    CATALOG = await res.json();
  }catch{
    // Static fallback
    try{
      const res2 = await fetch("./catalog.json", { cache: "no-store" });
      CATALOG = await res2.json();
    }catch{
      CATALOG = [];
    }
  }

  ensureChips();
  renderGrid();
  renderCart();
})();
