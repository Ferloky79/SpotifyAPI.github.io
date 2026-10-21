/*
 * Spotify API Lab
 * -----------------------------------------------------------------------------
 * Esta app utiliza Authorization Code con PKCE. Es el flujo correcto para una
 * aplicación que vive completamente en el navegador porque NO necesita guardar
 * un Client Secret. Busca los comentarios "API:" para seguir el recorrido de
 * autenticación, fetch, await, respuestas JSON y errores HTTP.
 */

const SPOTIFY = {
  authorizeUrl: "https://accounts.spotify.com/authorize",
  tokenUrl: "https://accounts.spotify.com/api/token",
  apiBaseUrl: "https://api.spotify.com/v1",
  scopes: [
    "user-read-private",
    "playlist-read-private",
    "user-top-read",
    "user-read-playback-state",
    "user-read-currently-playing",
    "user-modify-playback-state"
  ]
};

const STORAGE = {
  clientId: "spotify_lab_client_id",
  accessToken: "spotify_lab_access_token",
  refreshToken: "spotify_lab_refresh_token",
  expiresAt: "spotify_lab_expires_at",
  verifier: "spotify_lab_pkce_verifier",
  oauthState: "spotify_lab_oauth_state"
};

const PRESETS = {
  profile: { method: "GET", endpoint: "/me", label: "Perfil" },
  playlists: { method: "GET", endpoint: "/me/playlists?limit=12", label: "Playlists" },
  top: { method: "GET", endpoint: "/me/top/tracks?limit=12&time_range=medium_term", label: "Top canciones" },
  player: { method: "GET", endpoint: "/me/player?additional_types=track,episode", label: "Reproducción" }
};

const dom = {
  clientIdInput: document.querySelector("#clientIdInput"),
  clearClientIdButton: document.querySelector("#clearClientIdButton"),
  redirectUriOutput: document.querySelector("#redirectUriOutput"),
  copyRedirectButton: document.querySelector("#copyRedirectButton"),
  loginButton: document.querySelector("#loginButton"),
  logoutButton: document.querySelector("#logoutButton"),
  connectionDot: document.querySelector("#connectionDot"),
  connectionTitle: document.querySelector("#connectionTitle"),
  connectionDescription: document.querySelector("#connectionDescription"),
  searchForm: document.querySelector("#searchForm"),
  searchInput: document.querySelector("#searchInput"),
  requestForm: document.querySelector("#requestForm"),
  methodSelect: document.querySelector("#methodSelect"),
  endpointInput: document.querySelector("#endpointInput"),
  requestBodyInput: document.querySelector("#requestBodyInput"),
  sendRequestButton: document.querySelector("#sendRequestButton"),
  responseStatus: document.querySelector("#responseStatus"),
  responseTime: document.querySelector("#responseTime"),
  responseOutput: document.querySelector("#responseOutput code"),
  copyResponseButton: document.querySelector("#copyResponseButton"),
  requestSteps: [...document.querySelectorAll("#requestSteps li")],
  resultsSection: document.querySelector("#resultsSection"),
  resultsTitle: document.querySelector("#resultsTitle"),
  resultsNote: document.querySelector("#resultsNote"),
  visualResults: document.querySelector("#visualResults"),
  presetButtons: [...document.querySelectorAll("[data-preset]")],
  toast: document.querySelector("#toast")
};

const state = {
  accessToken: sessionStorage.getItem(STORAGE.accessToken),
  refreshToken: sessionStorage.getItem(STORAGE.refreshToken),
  expiresAt: Number(sessionStorage.getItem(STORAGE.expiresAt) || 0),
  lastResponse: null,
  isPlaying: false,
  toastTimer: null
};

/*
 * La URI de retorno debe coincidir EXACTAMENTE con la registrada en Spotify.
 * Quitamos ?code=... y #... porque esos valores son temporales del callback.
 */
function getRedirectUri() {
  const redirect = new URL(window.location.href);
  redirect.search = "";
  redirect.hash = "";
  return redirect.toString();
}

function showToast(message, type = "info") {
  window.clearTimeout(state.toastTimer);
  dom.toast.textContent = message;
  dom.toast.className = `toast visible ${type === "error" ? "error" : ""}`;
  state.toastTimer = window.setTimeout(() => {
    dom.toast.className = "toast";
  }, 4200);
}

function updateConnection(status, title, description) {
  dom.connectionDot.className = `status-dot ${status}`;
  dom.connectionTitle.textContent = title;
  dom.connectionDescription.textContent = description;
  dom.logoutButton.hidden = status !== "connected";
}

function setBusy(isBusy, label = "Enviando...") {
  dom.sendRequestButton.disabled = isBusy;
  dom.sendRequestButton.firstChild.textContent = isBusy ? `${label} ` : "Enviar petición ";
  dom.presetButtons.forEach((button) => {
    button.disabled = isBusy;
  });
}

function markStep(name, status = "active") {
  const stepOrder = ["token", "fetch", "await", "json"];
  const activeIndex = stepOrder.indexOf(name);

  dom.requestSteps.forEach((step, index) => {
    step.classList.remove("active", "done");
    if (status === "done" || index < activeIndex) step.classList.add("done");
    if (status !== "done" && index === activeIndex) step.classList.add("active");
  });
}

function displayResponse(data, statusCode, elapsedMs, ok = true) {
  state.lastResponse = data;
  dom.responseOutput.textContent = JSON.stringify(data, null, 2);
  dom.responseStatus.textContent = String(statusCode ?? "—");
  dom.responseStatus.className = ok ? "success" : "error";
  dom.responseTime.textContent = `${Math.round(elapsedMs || 0)} ms`;
}

function clearVisualResults() {
  dom.resultsSection.hidden = true;
  dom.visualResults.replaceChildren();
}

/* Genera texto aleatorio seguro para "state" y para el verificador PKCE. */
function randomString(length = 64) {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => characters[byte % characters.length]).join("");
}

/* Convierte un ArrayBuffer a Base64 URL-safe, formato requerido por PKCE. */
function base64UrlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/*
 * API / PKCE: Spotify no recibe el verificador secreto inicial. Recibe su hash
 * SHA-256 (challenge). Al volver del login enviaremos el verificador original;
 * así Spotify puede comprobar que inició y terminó el flujo el mismo navegador.
 */
async function createCodeChallenge(verifier) {
  const encodedVerifier = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", encodedVerifier);
  return base64UrlEncode(digest);
}

async function beginSpotifyLogin() {
  const clientId = dom.clientIdInput.value.trim();

  if (!clientId) {
    showToast("Copia primero el Client ID de tu aplicación de Spotify.", "error");
    dom.clientIdInput.focus();
    return;
  }

  if (window.location.protocol === "file:") {
    showToast("Abre la app con un servidor web; Spotify no acepta direcciones file://.", "error");
    return;
  }

  localStorage.setItem(STORAGE.clientId, clientId);

  const verifier = randomString(96);
  const oauthState = randomString(32);
  const challenge = await createCodeChallenge(verifier);

  sessionStorage.setItem(STORAGE.verifier, verifier);
  sessionStorage.setItem(STORAGE.oauthState, oauthState);

  const authorizationUrl = new URL(SPOTIFY.authorizeUrl);
  authorizationUrl.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: getRedirectUri(),
    scope: SPOTIFY.scopes.join(" "),
    code_challenge_method: "S256",
    code_challenge: challenge,
    state: oauthState
  }).toString();

  // API: redirigimos al servidor de autorización; allí Spotify pide permiso.
  window.location.assign(authorizationUrl.toString());
}

/* Guarda los tokens solo para esta pestaña. El Client Secret nunca participa. */
function saveTokenResponse(tokenData) {
  state.accessToken = tokenData.access_token;
  state.refreshToken = tokenData.refresh_token || state.refreshToken;
  state.expiresAt = Date.now() + tokenData.expires_in * 1000;

  sessionStorage.setItem(STORAGE.accessToken, state.accessToken);
  sessionStorage.setItem(STORAGE.expiresAt, String(state.expiresAt));
  if (state.refreshToken) sessionStorage.setItem(STORAGE.refreshToken, state.refreshToken);
}

/*
 * API / FETCH + AWAIT (autenticación):
 * 1. fetch() INICIA una petición HTTP POST al endpoint de tokens.
 * 2. await PAUSA solamente esta función async; la página no se congela.
 * 3. Al llegar los headers, "response" contiene status, ok, headers, etc.
 * 4. Un segundo await espera a que el body se lea y convierta desde JSON.
 */
async function exchangeCodeForToken(code) {
  const verifier = sessionStorage.getItem(STORAGE.verifier);
  const clientId = localStorage.getItem(STORAGE.clientId);

  if (!verifier || !clientId) {
    throw new Error("No se encontró el verificador PKCE. Inicia la conexión nuevamente.");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: getRedirectUri(),
    client_id: clientId,
    code_verifier: verifier
  });

  const response = await fetch(SPOTIFY.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const tokenData = await response.json();
  if (!response.ok) {
    throw new Error(tokenData.error_description || "Spotify no pudo entregar el access token.");
  }

  saveTokenResponse(tokenData);
  sessionStorage.removeItem(STORAGE.verifier);
  sessionStorage.removeItem(STORAGE.oauthState);
}

/*
 * API / TOKEN: los access tokens duran un tiempo limitado. Antes de cada llamada
 * comprobamos su vencimiento. Si faltan menos de 60 segundos, intercambiamos el
 * refresh token por uno nuevo para evitar que una petición falle a mitad de uso.
 */
async function refreshAccessToken() {
  const clientId = localStorage.getItem(STORAGE.clientId);
  if (!state.refreshToken || !clientId) throw new Error("La sesión venció. Conecta Spotify otra vez.");

  const response = await fetch(SPOTIFY.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: state.refreshToken,
      client_id: clientId
    })
  });

  const tokenData = await response.json();
  if (!response.ok) throw new Error(tokenData.error_description || "No se pudo renovar la sesión.");
  saveTokenResponse(tokenData);
  return state.accessToken;
}

async function getValidAccessToken() {
  if (!state.accessToken) throw new Error("Primero debes conectar tu cuenta de Spotify.");

  const expiresSoon = Date.now() >= state.expiresAt - 60_000;
  return expiresSoon ? refreshAccessToken() : state.accessToken;
}

class SpotifyApiError extends Error {
  constructor(message, status, data, retryAfter = null) {
    super(message);
    this.name = "SpotifyApiError";
    this.status = status;
    this.data = data;
    this.retryAfter = retryAfter;
  }
}

/*
 * API / FUNCIÓN CENTRAL:
 * Todas las consultas pasan por spotifyFetch(). Esto evita repetir el token,
 * los headers, la conversión JSON y el manejo de errores en cada botón.
 *
 * IMPORTANTE: fetch() solo rechaza su Promise ante un fallo de red. Un 404 o 500
 * siguen siendo respuestas HTTP válidas; por eso comprobamos response.ok.
 */
async function spotifyFetch(endpoint, options = {}, retryUnauthorized = true) {
  markStep("token");
  const token = await getValidAccessToken();
  const normalizedEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = `${SPOTIFY.apiBaseUrl}${normalizedEndpoint}`;
  const method = options.method || "GET";
  const headers = {
    Authorization: `Bearer ${token}`,
    ...options.headers
  };

  if (options.body) headers["Content-Type"] = "application/json";

  markStep("fetch");
  const startedAt = performance.now();

  // API: await espera la respuesta sin bloquear botones, animaciones ni pestañas.
  markStep("await");
  const response = await fetch(url, { ...options, method, headers });
  const elapsedMs = performance.now() - startedAt;

  // 204 significa éxito sin contenido; no debemos intentar ejecutar .json().
  let data = null;
  if (response.status !== 204) {
    markStep("json");
    const contentType = response.headers.get("content-type") || "";
    data = contentType.includes("application/json")
      ? await response.json()
      : await response.text();
  }

  // Si el token fue invalidado antes de tiempo, lo renovamos una sola vez.
  if (response.status === 401 && state.refreshToken && retryUnauthorized) {
    await refreshAccessToken();
    return spotifyFetch(endpoint, options, false);
  }

  if (!response.ok) {
    const apiMessage = data?.error?.message || data?.error_description || `Error HTTP ${response.status}`;
    throw new SpotifyApiError(
      apiMessage,
      response.status,
      data,
      response.headers.get("Retry-After")
    );
  }

  markStep("json", "done");
  return { data, status: response.status, elapsedMs, url, method };
}

function parseRequestBody(method) {
  const rawBody = dom.requestBodyInput.value.trim();
  if (["GET", "DELETE"].includes(method) || !rawBody) return undefined;

  try {
    return JSON.stringify(JSON.parse(rawBody));
  } catch {
    throw new Error("El Body no contiene JSON válido. Revisa comas, llaves y comillas.");
  }
}

async function executeRequest(request = {}) {
  const { method, endpoint, body, visualizer } = request;
  const requestMethod = method || dom.methodSelect.value;
  const requestEndpoint = endpoint || dom.endpointInput.value.trim();

  if (!requestEndpoint.startsWith("/")) {
    showToast("El endpoint debe comenzar con /, por ejemplo /me.", "error");
    dom.endpointInput.focus();
    return;
  }

  if (requestMethod === "DELETE") {
    const confirmed = window.confirm("Esta petición DELETE puede modificar tu cuenta. ¿Deseas continuar?");
    if (!confirmed) return;
  }

  setBusy(true);
  clearVisualResults();
  const startedAt = performance.now();

  try {
    // Si quien llama incluyó explícitamente `body` (aunque sea null), lo respetamos.
    // Así los controles del reproductor no reutilizan por accidente el JSON escrito
    // en la consola. Solo una petición manual lee el textarea.
    const hasExplicitBody = Object.prototype.hasOwnProperty.call(request, "body");
    const requestBody = hasExplicitBody ? body : parseRequestBody(requestMethod);
    const result = await spotifyFetch(requestEndpoint, {
      method: requestMethod,
      body: requestBody
    });

    displayResponse(result.data ?? { mensaje: "Petición completada sin contenido." }, result.status, result.elapsedMs, true);
    updateConnection("connected", "Spotify conectado", "El token se guarda solo durante esta pestaña.");
    if (visualizer) renderVisualResult(visualizer, result.data);
    showToast(`Petición completada: HTTP ${result.status}`);
  } catch (error) {
    const elapsedMs = performance.now() - startedAt;
    const status = error.status || "ERROR";
    const details = {
      error: error.message,
      status: error.status || null,
      respuesta: error.data || null
    };

    if (error.retryAfter) details.reintentar_en_segundos = Number(error.retryAfter);
    displayResponse(details, status, elapsedMs, false);
    updateConnection(error.status === 401 ? "error" : state.accessToken ? "connected" : "", error.status === 401 ? "Sesión vencida" : "Petición rechazada", error.message);
    showToast(getFriendlyError(error), "error");
  } finally {
    setBusy(false);
  }
}

function getFriendlyError(error) {
  if (error.status === 401) return "Token inválido o vencido. Vuelve a conectar Spotify.";
  if (error.status === 403) return "Spotify rechazó el permiso. Revisa los scopes o las restricciones de tu app.";
  if (error.status === 429) return `Límite de peticiones alcanzado. Espera ${error.retryAfter || "unos"} segundos.`;
  return error.message || "No se pudo completar la petición.";
}

function createImage(src, alt, className) {
  const image = document.createElement("img");
  image.className = className;
  image.src = src || createPlaceholderDataUrl();
  image.alt = alt;
  image.loading = "lazy";
  return image;
}

function createPlaceholderDataUrl() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#202421"/><circle cx="200" cy="200" r="72" fill="none" stroke="#1ed760" stroke-width="18"/><path d="M143 190c38-12 82-8 116 10M151 220c32-9 68-6 98 8M160 248c25-7 52-4 76 6" fill="none" stroke="#1ed760" stroke-width="12" stroke-linecap="round"/></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function renderVisualResult(type, data) {
  dom.visualResults.replaceChildren();
  dom.resultsSection.hidden = false;

  if (type === "profile") renderProfile(data);
  if (type === "playlists") renderCards(data?.items || [], "playlist");
  if (type === "top" || type === "search") renderCards(data?.items || data?.tracks?.items || [], "track");
  if (type === "player") renderPlayer(data);

  dom.resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderProfile(profile) {
  dom.resultsTitle.textContent = "Tu perfil";
  dom.resultsNote.textContent = "GET /me";

  const wrapper = document.createElement("article");
  wrapper.className = "profile-view";
  wrapper.append(createImage(profile?.images?.[0]?.url, "Foto de perfil", "profile-image"));

  const copy = document.createElement("div");
  copy.className = "profile-copy";
  copy.innerHTML = `
    <p class="section-kicker">Cuenta conectada</p>
    <h4></h4>
    <p class="profile-meta"></p>
  `;
  copy.querySelector("h4").textContent = profile?.display_name || "Usuario de Spotify";
  copy.querySelector(".profile-meta").textContent = `ID estable: ${profile?.account_id || profile?.id || "No disponible"}`;
  wrapper.append(copy);
  dom.visualResults.append(wrapper);
}

function renderCards(items, kind) {
  dom.resultsTitle.textContent = kind === "playlist" ? "Tus playlists" : "Canciones";
  dom.resultsNote.textContent = `${items.length} resultados`;

  if (!items.length) {
    dom.visualResults.innerHTML = '<div class="empty-state">Spotify no devolvió resultados para esta petición.</div>';
    return;
  }

  const grid = document.createElement("div");
  grid.className = "result-grid";

  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "result-card";
    const link = document.createElement("a");
    link.href = item?.external_urls?.spotify || "#";
    link.target = "_blank";
    link.rel = "noreferrer";

    const imageUrl = kind === "playlist" ? item?.images?.[0]?.url : item?.album?.images?.[0]?.url;
    link.append(createImage(imageUrl, `Portada de ${item?.name || "resultado"}`, "item-cover"));

    const title = document.createElement("h4");
    title.textContent = item?.name || "Sin nombre";
    const subtitle = document.createElement("p");
    subtitle.textContent = kind === "playlist"
      ? `${item?.items?.total ?? item?.tracks?.total ?? 0} elementos`
      : item?.artists?.map((artist) => artist.name).join(", ") || "Artista desconocido";

    link.append(title, subtitle);
    card.append(link);
    grid.append(card);
  });

  dom.visualResults.append(grid);
}

function renderPlayer(playback) {
  dom.resultsTitle.textContent = "Reproducción actual";
  dom.resultsNote.textContent = "Controles disponibles para Premium";

  if (!playback?.item) {
    dom.visualResults.innerHTML = '<div class="empty-state">No hay reproducción activa. Abre Spotify, reproduce algo y vuelve a probar.</div>';
    return;
  }

  state.isPlaying = Boolean(playback.is_playing);
  const item = playback.item;
  const imageUrl = item?.album?.images?.[0]?.url || item?.images?.[0]?.url;
  const wrapper = document.createElement("article");
  wrapper.className = "player-view";
  wrapper.append(createImage(imageUrl, `Portada de ${item.name}`, "player-cover"));

  const copy = document.createElement("div");
  copy.className = "player-copy";
  copy.innerHTML = `
    <p class="section-kicker">${state.isPlaying ? "Reproduciendo ahora" : "En pausa"}</p>
    <h4></h4>
    <p class="player-meta"></p>
    <div class="player-actions">
      <button class="button button-ghost" type="button" data-player-action="previous" aria-label="Canción anterior">← Anterior</button>
      <button class="button button-primary" type="button" data-player-action="toggle">${state.isPlaying ? "Pausar" : "Reproducir"}</button>
      <button class="button button-ghost" type="button" data-player-action="next" aria-label="Siguiente canción">Siguiente →</button>
    </div>
  `;
  copy.querySelector("h4").textContent = item.name || "Contenido sin nombre";
  copy.querySelector(".player-meta").textContent = `${item.artists?.map((artist) => artist.name).join(", ") || item.show?.name || "Spotify"} · ${playback.device?.name || "Dispositivo activo"}`;
  wrapper.append(copy);
  dom.visualResults.append(wrapper);
}

async function runPlayerAction(action) {
  const actionMap = {
    previous: { method: "POST", endpoint: "/me/player/previous" },
    next: { method: "POST", endpoint: "/me/player/next" },
    toggle: { method: "PUT", endpoint: state.isPlaying ? "/me/player/pause" : "/me/player/play" }
  };
  const request = actionMap[action];
  if (!request) return;

  await executeRequest(request);
  window.setTimeout(() => executeRequest({ ...PRESETS.player, visualizer: "player" }), 650);
}

async function handleOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const returnedState = params.get("state");
  const oauthError = params.get("error");

  if (oauthError) {
    history.replaceState({}, document.title, getRedirectUri());
    throw new Error(`Spotify canceló la autorización: ${oauthError}`);
  }

  if (!code) return;

  const expectedState = sessionStorage.getItem(STORAGE.oauthState);
  if (!expectedState || returnedState !== expectedState) {
    throw new Error("El parámetro state no coincide. Se detuvo el login por seguridad.");
  }

  updateConnection("", "Conectando…", "Intercambiando el código por un token seguro.");
  await exchangeCodeForToken(code);
  history.replaceState({}, document.title, getRedirectUri());
}

function logout() {
  Object.values(STORAGE)
    .filter((key) => key !== STORAGE.clientId)
    .forEach((key) => sessionStorage.removeItem(key));
  state.accessToken = null;
  state.refreshToken = null;
  state.expiresAt = 0;
  clearVisualResults();
  updateConnection("", "Sin conexión", "Tu token temporal fue eliminado.");
  showToast("Sesión local cerrada.");
}

function bindEvents() {
  dom.loginButton.addEventListener("click", beginSpotifyLogin);
  dom.logoutButton.addEventListener("click", logout);

  dom.clearClientIdButton.addEventListener("click", () => {
    dom.clientIdInput.value = "";
    localStorage.removeItem(STORAGE.clientId);
    dom.clientIdInput.focus();
  });

  dom.copyRedirectButton.addEventListener("click", async () => {
    await navigator.clipboard.writeText(getRedirectUri());
    showToast("Redirect URI copiada.");
  });

  dom.copyResponseButton.addEventListener("click", async () => {
    await navigator.clipboard.writeText(dom.responseOutput.textContent);
    showToast("Respuesta JSON copiada.");
  });

  dom.requestForm.addEventListener("submit", (event) => {
    event.preventDefault();
    executeRequest();
  });

  dom.requestBodyInput.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      dom.requestForm.requestSubmit();
    }
  });

  dom.searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = dom.searchInput.value.trim();
    if (!query) {
      showToast("Escribe una canción o artista para buscar.", "error");
      return;
    }

    const endpoint = `/search?q=${encodeURIComponent(query)}&type=track&limit=12`;
    dom.methodSelect.value = "GET";
    dom.endpointInput.value = endpoint;
    dom.requestBodyInput.value = "";
    executeRequest({ method: "GET", endpoint, visualizer: "search" });
  });

  dom.presetButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const presetName = button.dataset.preset;
      const preset = PRESETS[presetName];
      dom.methodSelect.value = preset.method;
      dom.endpointInput.value = preset.endpoint;
      dom.requestBodyInput.value = "";
      dom.presetButtons.forEach((item) => item.classList.toggle("active", item === button));
      executeRequest({ ...preset, visualizer: presetName });
    });
  });

  dom.visualResults.addEventListener("click", (event) => {
    const control = event.target.closest("[data-player-action]");
    if (control) runPlayerAction(control.dataset.playerAction);
  });
}

async function init() {
  dom.redirectUriOutput.textContent = getRedirectUri();
  dom.redirectUriOutput.title = getRedirectUri();
  dom.clientIdInput.value = localStorage.getItem(STORAGE.clientId) || "";
  bindEvents();

  try {
    await handleOAuthCallback();

    if (state.accessToken) {
      updateConnection("connected", "Spotify conectado", "El token se guarda solo durante esta pestaña.");
      await executeRequest({ ...PRESETS.profile, visualizer: "profile" });
    }
  } catch (error) {
    updateConnection("error", "No se pudo conectar", error.message);
    displayResponse({ error: error.message }, "ERROR", 0, false);
    showToast(error.message, "error");
  }
}

init();
