package com.jsanalyzer;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 확장 설정 — provider 선택(D4)과 SDK URL/토큰을 보관하고, 코어 잡 JSON(RunOptions)을
 * 조립한다. SDK provider의 base URL/토큰은 코어 프로세스 env(ANTHROPIC_BASE_URL/
 * ANTHROPIC_AUTH_TOKEN)로 전달된다(코어 LlmClient가 그걸 읽음).
 */
public class AnalyzerConfig {
    public volatile String provider = "sdk"; // sdk | claude-cli | codex
    public volatile String sdkUrl = "";      // sdk 선택 시 base URL
    public volatile String sdkToken = "";    // sdk 선택 시 토큰

    /** 코어 프로세스에 넘길 환경변수(SDK provider의 게이트웨이/토큰). */
    public Map<String, String> coreEnv() {
        Map<String, String> env = new HashMap<>();
        if ("sdk".equals(provider)) {
            if (!sdkUrl.isBlank()) env.put("ANTHROPIC_BASE_URL", sdkUrl.trim());
            if (!sdkToken.isBlank()) env.put("ANTHROPIC_AUTH_TOKEN", sdkToken.trim());
        }
        return env;
    }

    /** target(호스트 루트)과 Burp history 시드로 잡 JSON을 만든다. */
    public String jobJson(String target, List<SeedFile> seed) {
        JsonObject o = new JsonObject();
        o.addProperty("target", target);
        o.addProperty("provider", provider);
        JsonArray arr = new JsonArray();
        for (SeedFile s : seed) {
            JsonObject f = new JsonObject();
            f.addProperty("name", s.name);
            f.addProperty("code", s.code);
            arr.add(f);
        }
        o.add("seedFiles", arr);
        return o.toString();
    }

    /** Burp history에서 뽑은 JS 리소스 하나. */
    public static class SeedFile {
        public final String name;
        public final String code;
        public SeedFile(String name, String code) {
            this.name = name;
            this.code = code;
        }
    }
}
