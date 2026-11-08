import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.StringJoiner;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

/**
 * Menti – anonyme Fragerunde.
 *
 * <p>Kleiner HTTP-Server ohne Abhängigkeiten: liefert die Web-Oberfläche aus {@code public/} und eine JSON-API.
 * Fragen werden in {@code data/fragen.json} gespeichert. Start: {@code java src/Menti.java [port]}.
 *
 * <ul>
 *   <li>{@code GET  /api/questions?since=v} – alle Fragen (204, wenn sich seit Version v nichts geändert hat)</li>
 *   <li>{@code POST /api/questions} {@code {"text":"…"}} – neue Frage (anonym)</li>
 *   <li>{@code POST /api/questions/{id}/like} {@code {"liked":true}} – Like setzen/entfernen</li>
 *   <li>{@code POST /api/admin/login} {@code {"password":"…"}} – Admin-Token</li>
 *   <li>{@code POST /api/questions/{id}/answered} {@code {"answered":true}} – als beantwortet markieren (Admin)</li>
 *   <li>{@code DELETE /api/questions/{id}} – Frage löschen (Admin)</li>
 * </ul>
 *
 * <p>Anonymität: Es werden keine Namen und keine IP-Adressen gespeichert. Jedes Gerät schickt eine zufällige
 * Kennung (Header {@code X-Client-Id}); gespeichert wird nur deren Hashwert, damit jedes Gerät pro Frage nur
 * einmal liken kann und seine eigenen Fragen als „Deine Frage“ sieht.
 */
public class Menti {

    static final int MAX_LEN = 300;
    static final int MAX_QUESTIONS = 5000;
    static final long POST_PAUSE_MS = 5_000;
    static final long TOKEN_TTL_MS = 24L * 60 * 60 * 1000;
    static final int MAX_BODY = 16 * 1024;
    static final Pattern CLIENT_ID = Pattern.compile("[A-Za-z0-9_-]{8,64}");
    static final SecureRandom RNG = new SecureRandom();

    static Path publicDir, dataDir, dataFile;
    static String adminPassword;

    /** Schützt {@link #questions} und {@link #version}. */
    static final Object LOCK = new Object();
    static final LinkedHashMap<String, Question> questions = new LinkedHashMap<>();
    static long version = 1;

    static final Map<String, Long> adminTokens = new ConcurrentHashMap<>();
    /** Letzter Fragezeitpunkt je Gerät (nur im Speicher, gegen versehentliches Doppelsenden/Spam). */
    static final Map<String, Long> lastPost = new ConcurrentHashMap<>();

    static final class Question {
        String id, text, author;
        long created, answeredAt;
        boolean answered;
        final Set<String> likes = new LinkedHashSet<>();

        /** Öffentliche Sicht für ein Gerät (ohne Kennungen). */
        String toJson(String client) {
            return "{\"id\":" + str(id) + ",\"text\":" + str(text) + ",\"created\":" + created
                    + ",\"answered\":" + answered + ",\"answeredAt\":" + answeredAt
                    + ",\"likes\":" + likes.size()
                    + ",\"liked\":" + (client != null && likes.contains(client))
                    + ",\"own\":" + (client != null && client.equals(author)) + "}";
        }

        String toStorage() {
            StringJoiner l = new StringJoiner(",", "[", "]");
            likes.forEach(x -> l.add(str(x)));
            return "{\"id\":" + str(id) + ",\"text\":" + str(text)
                    + ",\"author\":" + (author == null ? "null" : str(author))
                    + ",\"created\":" + created + ",\"answered\":" + answered + ",\"answeredAt\":" + answeredAt
                    + ",\"likes\":" + l + "}";
        }
    }

    /** Fehler mit HTTP-Status und Nachricht für die Oberfläche. */
    static final class HttpError extends RuntimeException {
        final int status;
        final String extra;

        HttpError(int status, String message) {
            this(status, message, null);
        }

        HttpError(int status, String message, String extraJsonFields) {
            super(message);
            this.status = status;
            this.extra = extraJsonFields;
        }
    }

    // ------------------------------------------------------------------ Start

    public static void main(String[] args) throws IOException {
        Path base = Path.of(System.getProperty("menti.home", ".")).toAbsolutePath().normalize();
        publicDir = base.resolve("public");
        dataDir = base.resolve("data");
        dataFile = dataDir.resolve("fragen.json");
        if (!Files.isRegularFile(publicDir.resolve("index.html"))) {
            System.err.println("public/index.html nicht gefunden – bitte im Projektordner starten (start.cmd).");
            System.exit(1);
        }
        Files.createDirectories(dataDir);
        try {
            load();
        } catch (RuntimeException e) {
            System.err.println("data/fragen.json ist beschädigt (" + e.getMessage() + ") – bitte prüfen oder umbenennen.");
            System.exit(1);
        }
        adminPassword = initAdminPassword();

        String portText = System.getenv("PORT") != null ? System.getenv("PORT") : (args.length > 0 ? args[0] : "8080");
        int port = Integer.parseInt(portText.trim());
        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
        server.createContext("/", Menti::handle);
        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        server.start();

        System.out.println();
        System.out.println("  Menti läuft.");
        System.out.println("  Auf diesem PC:   http://localhost:" + port);
        for (String ip : lanAddresses()) System.out.println("  Im WLAN (Handy): http://" + ip + ":" + port);
        System.out.println("  Erstellerzugang: http://localhost:" + port + "/admin");
        System.out.println("  Passwort:        " + adminPassword
                + (System.getenv("MENTI_ADMIN_PASSWORD") != null ? "  (aus MENTI_ADMIN_PASSWORD)" : "  (data/admin-passwort.txt)"));
        System.out.println("  Fragen:          " + questions.size() + " gespeichert in " + dataFile);
        System.out.println("  Beenden mit Strg+C.");
        System.out.println();
    }

    static String initAdminPassword() throws IOException {
        String env = System.getenv("MENTI_ADMIN_PASSWORD");
        if (env != null && !env.isBlank()) return env.trim();
        Path f = dataDir.resolve("admin-passwort.txt");
        if (Files.isRegularFile(f)) {
            String s = Files.readString(f, StandardCharsets.UTF_8).trim();
            if (!s.isEmpty()) return s;
        }
        String alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
        StringBuilder pw = new StringBuilder();
        for (int i = 0; i < 12; i++) {
            if (i > 0 && i % 4 == 0) pw.append('-');
            pw.append(alphabet.charAt(RNG.nextInt(alphabet.length())));
        }
        Files.writeString(f, pw + System.lineSeparator(), StandardCharsets.UTF_8);
        return pw.toString();
    }

    static List<String> lanAddresses() {
        List<String> out = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback() || ni.isVirtual()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses()))
                    if (a instanceof Inet4Address && a.isSiteLocalAddress()) out.add(a.getHostAddress());
            }
        } catch (IOException ignored) {
            // Nur Komfort-Ausgabe.
        }
        return out;
    }

    // ------------------------------------------------------------------ HTTP

    static void handle(HttpExchange ex) {
        try {
            securityHeaders(ex);
            String path = ex.getRequestURI().getPath();
            if (path.startsWith("/api/")) api(ex, ex.getRequestMethod(), path.substring(5));
            else serveStatic(ex, path);
        } catch (HttpError e) {
            trySend(ex, e.status, "{\"error\":" + str(e.getMessage()) + (e.extra == null ? "" : "," + e.extra) + "}");
        } catch (Exception e) {
            e.printStackTrace();
            trySend(ex, 500, "{\"error\":\"Interner Serverfehler.\"}");
        } finally {
            ex.close();
        }
    }

    static void api(HttpExchange ex, String method, String path) throws IOException {
        ex.getResponseHeaders().set("Cache-Control", "no-store");
        String[] p = path.split("/", -1);
        String client = clientHash(ex);
        if (p[0].equals("questions")) {
            if (p.length == 1) {
                if (method.equals("GET")) { list(ex, client); return; }
                if (method.equals("POST")) { create(ex, client); return; }
            } else if (p.length == 2 && method.equals("DELETE")) {
                requireAdmin(ex);
                delete(ex, p[1]);
                return;
            } else if (p.length == 3 && method.equals("POST")) {
                if (p[2].equals("like")) { like(ex, p[1], client); return; }
                if (p[2].equals("answered")) { requireAdmin(ex); answered(ex, p[1]); return; }
            }
        } else if (p[0].equals("admin") && p.length == 2) {
            if (p[1].equals("login") && method.equals("POST")) { login(ex); return; }
            if (p[1].equals("check") && method.equals("GET")) { requireAdmin(ex); sendJson(ex, 200, "{\"ok\":true}"); return; }
            if (p[1].equals("logout") && method.equals("POST")) { logout(ex); return; }
        }
        throw new HttpError(404, "Nicht gefunden.");
    }

    // ------------------------------------------------------------------ Endpunkte

    static void list(HttpExchange ex, String client) throws IOException {
        String since = queryParam(ex, "since");
        String body;
        synchronized (LOCK) {
            if (since != null && since.equals(Long.toString(version))) {
                ex.sendResponseHeaders(204, -1);
                return;
            }
            StringJoiner j = new StringJoiner(",", "[", "]");
            for (Question q : questions.values()) j.add(q.toJson(client));
            body = "{\"version\":" + version + ",\"questions\":" + j + "}";
        }
        sendJson(ex, 200, body);
    }

    static void create(HttpExchange ex, String client) throws IOException {
        Map<String, Object> body = readJson(ex);
        String text = clean(body.get("text") instanceof String s ? s : "");
        if (text.isEmpty()) throw new HttpError(400, "Bitte gib eine Frage ein.");
        if (text.codePointCount(0, text.length()) > MAX_LEN)
            throw new HttpError(400, "Die Frage ist zu lang (höchstens " + MAX_LEN + " Zeichen).");

        String key = client != null ? client : "ip:" + remoteIp(ex);
        long now = System.currentTimeMillis();
        Long last = lastPost.get(key);
        if (last != null && now - last < POST_PAUSE_MS)
            throw new HttpError(429, "Bitte warte kurz, bevor du die nächste Frage stellst.");

        String json;
        synchronized (LOCK) {
            String norm = normalize(text);
            for (Question o : questions.values())
                if (!o.answered && normalize(o.text).equals(norm))
                    throw new HttpError(409, "Diese Frage wurde schon gestellt – like sie einfach.", "\"id\":" + str(o.id));
            if (questions.size() >= MAX_QUESTIONS) throw new HttpError(503, "Es sind zu viele Fragen gespeichert.");
            Question q = new Question();
            q.id = randomToken(9);
            q.text = text;
            q.author = client;
            q.created = now;
            questions.put(q.id, q);
            changed();
            json = q.toJson(client);
        }
        if (lastPost.size() > 10_000) lastPost.values().removeIf(t -> now - t > POST_PAUSE_MS);
        lastPost.put(key, now);
        sendJson(ex, 201, json);
    }

    static void like(HttpExchange ex, String id, String client) throws IOException {
        if (client == null) throw new HttpError(400, "Fehlende Geräte-Kennung – bitte Seite neu laden.");
        Map<String, Object> body = readJson(ex);
        String json;
        synchronized (LOCK) {
            Question q = find(id);
            boolean want = body.get("liked") instanceof Boolean b ? b : !q.likes.contains(client);
            boolean changed = want ? q.likes.add(client) : q.likes.remove(client);
            if (changed) changed();
            json = q.toJson(client);
        }
        sendJson(ex, 200, json);
    }

    static void answered(HttpExchange ex, String id) throws IOException {
        Map<String, Object> body = readJson(ex);
        String client = clientHash(ex);
        String json;
        synchronized (LOCK) {
            Question q = find(id);
            boolean want = body.get("answered") instanceof Boolean b ? b : !q.answered;
            if (q.answered != want) {
                q.answered = want;
                q.answeredAt = want ? System.currentTimeMillis() : 0;
                changed();
            }
            json = q.toJson(client);
        }
        sendJson(ex, 200, json);
    }

    static void delete(HttpExchange ex, String id) throws IOException {
        synchronized (LOCK) {
            find(id);
            questions.remove(id);
            changed();
        }
        sendJson(ex, 200, "{\"ok\":true}");
    }

    static void login(HttpExchange ex) throws IOException {
        Map<String, Object> body = readJson(ex);
        String pw = body.get("password") instanceof String s ? s.trim() : "";
        if (!MessageDigest.isEqual(sha256(pw), sha256(adminPassword))) {
            try {
                Thread.sleep(800); // bremst Durchprobieren
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            throw new HttpError(401, "Falsches Passwort.");
        }
        long now = System.currentTimeMillis();
        adminTokens.values().removeIf(exp -> exp < now);
        String token = randomToken(32);
        adminTokens.put(token, now + TOKEN_TTL_MS);
        sendJson(ex, 200, "{\"token\":" + str(token) + "}");
    }

    static void logout(HttpExchange ex) throws IOException {
        String t = bearer(ex);
        if (t != null) adminTokens.remove(t);
        sendJson(ex, 200, "{\"ok\":true}");
    }

    // ------------------------------------------------------------------ Hilfen

    static Question find(String id) {
        Question q = questions.get(id);
        if (q == null) throw new HttpError(404, "Diese Frage gibt es nicht mehr.");
        return q;
    }

    /** Muss unter {@link #LOCK} aufgerufen werden. */
    static void changed() {
        version++;
        save();
    }

    static void requireAdmin(HttpExchange ex) {
        String t = bearer(ex);
        Long exp = t == null ? null : adminTokens.get(t);
        if (exp == null || exp < System.currentTimeMillis()) {
            if (t != null) adminTokens.remove(t);
            throw new HttpError(401, "Bitte über den Erstellerzugang anmelden.");
        }
    }

    static String bearer(HttpExchange ex) {
        String h = ex.getRequestHeaders().getFirst("Authorization");
        return h != null && h.startsWith("Bearer ") ? h.substring(7).trim() : null;
    }

    static String clientHash(HttpExchange ex) {
        String id = ex.getRequestHeaders().getFirst("X-Client-Id");
        if (id == null || !CLIENT_ID.matcher(id).matches()) return null;
        return HexFormat.of().formatHex(sha256("menti:" + id)).substring(0, 32);
    }

    static String remoteIp(HttpExchange ex) {
        String cf = ex.getRequestHeaders().getFirst("CF-Connecting-IP");
        if (cf != null && !cf.isBlank()) return cf.trim();
        String xff = ex.getRequestHeaders().getFirst("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) return xff.split(",")[0].trim();
        return ex.getRemoteAddress().getAddress().getHostAddress();
    }

    static String clean(String s) {
        s = s.replace("\r\n", "\n").replace('\r', '\n');
        StringBuilder b = new StringBuilder(s.length());
        s.codePoints().filter(c -> c == '\n' || !Character.isISOControl(c)).forEach(b::appendCodePoint);
        return b.toString()
                .replaceAll("[ \\t\\u00A0]+", " ")
                .replaceAll(" *\\n *", "\n")
                .replaceAll("\\n{3,}", "\n\n")
                .trim();
    }

    static String normalize(String s) {
        return s.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]+", " ").trim();
    }

    static String randomToken(int bytes) {
        byte[] b = new byte[bytes];
        RNG.nextBytes(b);
        return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }

    static byte[] sha256(String s) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    static String queryParam(HttpExchange ex, String name) {
        String q = ex.getRequestURI().getRawQuery();
        if (q == null) return null;
        for (String part : q.split("&")) {
            int i = part.indexOf('=');
            String k = i < 0 ? part : part.substring(0, i);
            if (k.equals(name)) return i < 0 ? "" : URLDecoder.decode(part.substring(i + 1), StandardCharsets.UTF_8);
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> readJson(HttpExchange ex) throws IOException {
        byte[] raw;
        try (InputStream in = ex.getRequestBody()) {
            raw = in.readNBytes(MAX_BODY + 1);
        }
        if (raw.length > MAX_BODY) throw new HttpError(413, "Anfrage zu groß.");
        String s = new String(raw, StandardCharsets.UTF_8).trim();
        if (s.isEmpty()) return Map.of();
        try {
            if (Json.parse(s) instanceof Map<?, ?> m) return (Map<String, Object>) m;
        } catch (IllegalArgumentException ignored) {
            // unten
        }
        throw new HttpError(400, "Ungültige Anfrage.");
    }

    static void securityHeaders(HttpExchange ex) {
        var h = ex.getResponseHeaders();
        h.set("X-Content-Type-Options", "nosniff");
        h.set("Referrer-Policy", "no-referrer");
        h.set("X-Frame-Options", "DENY");
        h.set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; "
                + "script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    }

    static void serveStatic(HttpExchange ex, String path) throws IOException {
        String m = ex.getRequestMethod();
        if (!m.equals("GET") && !m.equals("HEAD")) throw new HttpError(405, "Methode nicht erlaubt.");
        String rel = (path.equals("/") || path.equals("/admin") || path.equals("/admin/")) ? "index.html" : path.substring(1);
        Path f;
        try {
            f = publicDir.resolve(rel).normalize();
        } catch (InvalidPathException e) {
            f = null;
        }
        if (f == null || !f.startsWith(publicDir) || !Files.isRegularFile(f)) {
            sendText(ex, 404, "Nicht gefunden");
            return;
        }
        byte[] data = Files.readAllBytes(f);
        ex.getResponseHeaders().set("Content-Type", contentType(f.getFileName().toString()));
        ex.getResponseHeaders().set("Cache-Control", "no-cache");
        if (m.equals("HEAD")) {
            ex.sendResponseHeaders(200, -1);
            return;
        }
        ex.sendResponseHeaders(200, data.length);
        try (OutputStream o = ex.getResponseBody()) {
            o.write(data);
        }
    }

    static String contentType(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        if (n.endsWith(".html")) return "text/html; charset=utf-8";
        if (n.endsWith(".css")) return "text/css; charset=utf-8";
        if (n.endsWith(".js")) return "text/javascript; charset=utf-8";
        if (n.endsWith(".svg")) return "image/svg+xml";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".ico")) return "image/x-icon";
        if (n.endsWith(".webmanifest")) return "application/manifest+json";
        if (n.endsWith(".json")) return "application/json; charset=utf-8";
        return "application/octet-stream";
    }

    static void sendJson(HttpExchange ex, int status, String json) throws IOException {
        byte[] b = json.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        ex.sendResponseHeaders(status, b.length);
        try (OutputStream o = ex.getResponseBody()) {
            o.write(b);
        }
    }

    static void sendText(HttpExchange ex, int status, String text) throws IOException {
        byte[] b = text.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", "text/plain; charset=utf-8");
        ex.sendResponseHeaders(status, b.length);
        try (OutputStream o = ex.getResponseBody()) {
            o.write(b);
        }
    }

    static void trySend(HttpExchange ex, int status, String json) {
        try {
            sendJson(ex, status, json);
        } catch (IOException ignored) {
            // Antwort war schon unterwegs.
        }
    }

    // ------------------------------------------------------------------ Speicher

    /** Muss unter {@link #LOCK} aufgerufen werden. */
    static void save() {
        StringJoiner j = new StringJoiner(",\n", "{\"version\":" + version + ",\"questions\":[\n", "\n]}\n");
        for (Question q : questions.values()) j.add(q.toStorage());
        try {
            Path tmp = dataFile.resolveSibling("fragen.json.tmp");
            Files.writeString(tmp, j.toString(), StandardCharsets.UTF_8);
            try {
                Files.move(tmp, dataFile, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(tmp, dataFile, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            System.err.println("Speichern fehlgeschlagen: " + e.getMessage());
        }
    }

    static void load() throws IOException {
        if (!Files.isRegularFile(dataFile)) return;
        Object root = Json.parse(Files.readString(dataFile, StandardCharsets.UTF_8));
        if (!(root instanceof Map<?, ?> m)) throw new IllegalArgumentException("kein JSON-Objekt");
        // +1: Geräte mit altem Stand laden nach einem Neustart sicher neu.
        if (m.get("version") instanceof Number n) version = n.longValue() + 1;
        if (m.get("questions") instanceof List<?> list) {
            for (Object o : list) {
                if (!(o instanceof Map<?, ?> qm) || !(qm.get("id") instanceof String id) || !(qm.get("text") instanceof String text))
                    continue;
                Question q = new Question();
                q.id = id;
                q.text = text;
                q.author = qm.get("author") instanceof String a ? a : null;
                q.created = qm.get("created") instanceof Number c ? c.longValue() : 0;
                q.answered = Boolean.TRUE.equals(qm.get("answered"));
                q.answeredAt = qm.get("answeredAt") instanceof Number t ? t.longValue() : 0;
                if (qm.get("likes") instanceof List<?> likes)
                    for (Object l : likes) if (l instanceof String s) q.likes.add(s);
                questions.put(q.id, q);
            }
        }
    }

    // ------------------------------------------------------------------ JSON

    static String str(String s) {
        StringBuilder b = new StringBuilder(s.length() + 2).append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> b.append("\\\"");
                case '\\' -> b.append("\\\\");
                case '\n' -> b.append("\\n");
                case '\r' -> b.append("\\r");
                case '\t' -> b.append("\\t");
                default -> {
                    if (c < 0x20 || c == 0x2028 || c == 0x2029) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
                }
            }
        }
        return b.append('"').toString();
    }

    /** Minimaler JSON-Leser (Objekte, Listen, Texte, Zahlen, true/false/null). */
    static final class Json {
        private final String s;
        private int i;

        private Json(String s) {
            this.s = s;
        }

        static Object parse(String s) {
            Json j = new Json(s);
            Object v = j.value();
            j.ws();
            if (j.i != s.length()) throw j.err();
            return v;
        }

        private IllegalArgumentException err() {
            return new IllegalArgumentException("JSON-Fehler an Stelle " + i);
        }

        private void ws() {
            while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++;
        }

        private Object value() {
            ws();
            if (i >= s.length()) throw err();
            char c = s.charAt(i);
            return switch (c) {
                case '{' -> object();
                case '[' -> array();
                case '"' -> string();
                case 't' -> literal("true", Boolean.TRUE);
                case 'f' -> literal("false", Boolean.FALSE);
                case 'n' -> literal("null", null);
                default -> number();
            };
        }

        private Object literal(String word, Object v) {
            if (!s.startsWith(word, i)) throw err();
            i += word.length();
            return v;
        }

        private Map<String, Object> object() {
            Map<String, Object> m = new LinkedHashMap<>();
            i++;
            ws();
            if (i < s.length() && s.charAt(i) == '}') { i++; return m; }
            while (true) {
                ws();
                if (i >= s.length() || s.charAt(i) != '"') throw err();
                String k = string();
                ws();
                if (i >= s.length() || s.charAt(i) != ':') throw err();
                i++;
                m.put(k, value());
                ws();
                if (i >= s.length()) throw err();
                char c = s.charAt(i++);
                if (c == '}') return m;
                if (c != ',') throw err();
            }
        }

        private List<Object> array() {
            List<Object> l = new ArrayList<>();
            i++;
            ws();
            if (i < s.length() && s.charAt(i) == ']') { i++; return l; }
            while (true) {
                l.add(value());
                ws();
                if (i >= s.length()) throw err();
                char c = s.charAt(i++);
                if (c == ']') return l;
                if (c != ',') throw err();
            }
        }

        private String string() {
            StringBuilder b = new StringBuilder();
            i++;
            while (true) {
                if (i >= s.length()) throw err();
                char c = s.charAt(i++);
                if (c == '"') return b.toString();
                if (c != '\\') { b.append(c); continue; }
                if (i >= s.length()) throw err();
                char e = s.charAt(i++);
                switch (e) {
                    case '"', '\\', '/' -> b.append(e);
                    case 'b' -> b.append('\b');
                    case 'f' -> b.append('\f');
                    case 'n' -> b.append('\n');
                    case 'r' -> b.append('\r');
                    case 't' -> b.append('\t');
                    case 'u' -> {
                        if (i + 4 > s.length()) throw err();
                        try {
                            b.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
                        } catch (NumberFormatException ex) {
                            throw err();
                        }
                        i += 4;
                    }
                    default -> throw err();
                }
            }
        }

        private Number number() {
            int start = i;
            while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
            String n = s.substring(start, i);
            if (n.isEmpty()) throw err();
            try {
                if (n.contains(".") || n.contains("e") || n.contains("E")) return Double.parseDouble(n);
                return Long.parseLong(n);
            } catch (NumberFormatException e) {
                throw err();
            }
        }
    }
}
