package com.jsanalyzer;

import com.google.gson.JsonParser;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

/**
 * 코어 로컬 HTTP 잡 API 클라이언트 — 잡 제출과 라이브 URL 생성만 담당한다(M9).
 * 결과는 브라우저가 SSE(/jobs/:id/events)로 소비하므로 폴링/리포트 취득은 없다(D8).
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

    /** 브라우저로 열 라이브 결과 페이지 URL. */
    public String liveUrl(String id) {
        return baseUrl + "/jobs/" + id + "/live";
    }
}
