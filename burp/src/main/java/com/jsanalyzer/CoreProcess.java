package com.jsanalyzer;

import java.io.IOException;
import java.io.InputStream;
import java.net.ServerSocket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * 번들된 코어 바이너리를 추출·기동한다(M5→코어 M2/M4 연결).
 *
 * 빌드 시 CI가 dist/core/(바이너리+rules+data)를 core.zip 으로 묶어
 * src/main/resources/core.zip 에 넣는다. 런타임에 이걸 임시 디렉터리에 풀고
 * `js-analyzer-core serve --port <free>` 로 로컬 HTTP 서버를 띄운다.
 * 얇은 유지: 분석 로직은 전혀 없고 프로세스 생명주기와 baseUrl만 관리(SRP).
 */
public class CoreProcess {
    private Process proc;
    private String baseUrl;

    public synchronized String ensureStarted(Map<String, String> extraEnv) throws IOException, InterruptedException {
        if (baseUrl != null) return baseUrl;

        Path dir = Files.createTempDirectory("js-analyzer-core");
        unzipResource("/core.zip", dir);

        Path bin = dir.resolve(binaryName());
        bin.toFile().setExecutable(true);

        int port = freePort();
        ProcessBuilder pb = new ProcessBuilder(
                bin.toString(), "serve", "--port", String.valueOf(port), "--host", "127.0.0.1");
        pb.environment().put("JS_ANALYZER_RULES_DIR", dir.resolve("rules").toString());
        pb.environment().put("JS_ANALYZER_DATA_DIR", dir.resolve("data").toString());
        if (extraEnv != null) pb.environment().putAll(extraEnv);
        pb.redirectErrorStream(true);
        proc = pb.start();

        String url = "http://127.0.0.1:" + port;
        waitForHealth(url);
        baseUrl = url;
        return baseUrl;
    }

    public synchronized void stop() {
        if (proc != null) proc.destroy();
    }

    private static String binaryName() {
        String os = System.getProperty("os.name", "").toLowerCase();
        return os.contains("win") ? "js-analyzer-core.exe" : "js-analyzer-core";
    }

    private void unzipResource(String resource, Path targetDir) throws IOException {
        try (InputStream in = getClass().getResourceAsStream(resource)) {
            if (in == null) throw new IOException("bundled " + resource + " not found in JAR");
            try (ZipInputStream zis = new ZipInputStream(in)) {
                ZipEntry e;
                while ((e = zis.getNextEntry()) != null) {
                    Path out = targetDir.resolve(e.getName()).normalize();
                    if (!out.startsWith(targetDir)) continue; // zip-slip guard
                    if (e.isDirectory()) {
                        Files.createDirectories(out);
                    } else {
                        Files.createDirectories(out.getParent());
                        Files.copy(zis, out);
                    }
                }
            }
        }
    }

    private static int freePort() throws IOException {
        try (ServerSocket s = new ServerSocket(0)) {
            return s.getLocalPort();
        }
    }

    private void waitForHealth(String url) throws InterruptedException {
        HttpClient http = HttpClient.newHttpClient();
        HttpRequest req = HttpRequest.newBuilder(URI.create(url + "/health")).build();
        for (int i = 0; i < 50; i++) {
            try {
                HttpResponse<String> r = http.send(req, HttpResponse.BodyHandlers.ofString());
                if (r.statusCode() == 200) return;
            } catch (Exception ignored) {
                // server not up yet
            }
            Thread.sleep(200);
        }
        throw new InterruptedException("core server did not become healthy at " + url);
    }
}
