package com.jsanalyzer;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/**
 * 코어 로컬 HTTP 잡 API(M2) 클라이언트 — 잡 제출·폴링·리포트 취득만 담당한다.
 *   POST /jobs → id, GET /jobs/:id → 상태, GET /jobs/:id/report → HTML.
 */
public class CoreClient {
    private final String baseUrl;
    private final HttpClient http = HttpClient.newHttpClient();

    public CoreClient(String baseUrl) {
        this.baseUrl = baseUrl;
    }

    /** 잡 제출 → job id. body 는 RunOptions JSON(target, provider, seedFiles ...). */
    public String submit(String jobJson) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + "/jobs"))
                .header("content-type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(jobJson))
                .build();
        HttpResponse<String> r = http.send(req, HttpResponse.BodyHandlers.ofString());
        if (r.statusCode() != 202) throw new RuntimeException("submit failed: " + r.statusCode() + " " + r.body());
        return JsonParser.parseString(r.body()).getAsJsonObject().get("id").getAsString();
    }

    /** 완료(done/error)까지 폴링 후 상태 JSON 반환. */
    public JsonObject pollUntilDone(String id, int maxSeconds) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + "/jobs/" + id))
                .timeout(Duration.ofSeconds(10)).GET().build();
        for (int i = 0; i < maxSeconds; i++) {
            HttpResponse<String> r = http.send(req, HttpResponse.BodyHandlers.ofString());
            JsonObject o = JsonParser.parseString(r.body()).getAsJsonObject();
            String status = o.has("status") ? o.get("status").getAsString() : "";
            if (status.equals("done") || status.equals("error")) return o;
            Thread.sleep(1000);
        }
        throw new RuntimeException("job " + id + " did not finish in " + maxSeconds + "s");
    }

    /** 완료된 잡의 report.html 취득. */
    public String report(String id) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + "/jobs/" + id + "/report")).GET().build();
        return http.send(req, HttpResponse.BodyHandlers.ofString()).body();
    }
}
