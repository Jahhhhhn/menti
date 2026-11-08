# Menti – anonyme Fragerunde

Web-App: Handy-Link zum anonymen Fragenstellen, Likes, optionaler Admin (beantwortet markieren, löschen).
Nutzer spricht Deutsch; UI-Texte und Kommentare deutsch. Design nach Apple HIG (iOS) – siehe `public/style.css`.

- Start: `java src/Menti.java [port]` im Projektordner (Java 21+, keine Abhängigkeiten, kein Build).
- Server `src/Menti.java` (JDK HttpServer, eigener Mini-JSON-Leser), Daten `data/fragen.json`,
  Admin-Passwort `MENTI_ADMIN_PASSWORD` oder `data/admin-passwort.txt`. `data/` nie committen.
- Oberfläche `public/` ohne Framework; strenge CSP (`script-src 'self'`, `style-src 'self'`) → keine Inline-Skripte/
  `style`-Attribute, nur `el.style.x = …` aus JS.
- Anonymität: keine Namen/IPs speichern; Geräte-Kennung nur gehasht.
