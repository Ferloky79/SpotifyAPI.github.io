# Spotify API Lab

Aplicación web educativa para probar Spotify Web API desde el navegador. Usa OAuth 2.0 Authorization Code con PKCE, por lo que **no necesita ni expone un Client Secret**.

## Configuración en Spotify

1. Entra a [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) y crea una aplicación.
2. Copia el `Client ID` (no copies el Client Secret).
3. En la configuración de la app agrega una Redirect URI exacta:
   - Publicada: usa la dirección que muestra la propia aplicación.
   - Local: `http://127.0.0.1:8080/`
4. Guarda los cambios.

## Ejecutar localmente

Desde la carpeta `dist` inicia un servidor estático. Por ejemplo, si tienes Python:

```powershell
cd spotify-api-lab\dist
python -m http.server 8080 --bind 127.0.0.1
```

Abre `http://127.0.0.1:8080/`. Spotify no permite `http://localhost` como Redirect URI; para desarrollo usa la IP explícita `127.0.0.1`.

## Funciones incluidas

- Inicio de sesión seguro con PKCE.
- Renovación automática del access token.
- Perfil, playlists, top de canciones y reproducción actual.
- Búsqueda del catálogo.
- Controles Premium: anterior, reproducir/pausar y siguiente.
- Consola para probar endpoints con GET, POST, PUT y DELETE.
- Respuesta JSON, código HTTP, tiempo y explicación visual de `fetch` + `await`.
- Manejo de errores 401, 403 y 429.

Los comentarios principales están en `dist/app.js`, especialmente en las funciones `exchangeCodeForToken`, `refreshAccessToken` y `spotifyFetch`.
