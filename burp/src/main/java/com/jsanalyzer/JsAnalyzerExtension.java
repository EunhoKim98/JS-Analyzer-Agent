package com.jsanalyzer;

import burp.api.montoya.BurpExtension;
import burp.api.montoya.MontoyaApi;
import burp.api.montoya.http.message.HttpRequestResponse;
import burp.api.montoya.http.message.MimeType;
import burp.api.montoya.ui.contextmenu.ContextMenuEvent;
import burp.api.montoya.ui.contextmenu.ContextMenuItemsProvider;

import javax.swing.JMenuItem;
import java.awt.Component;
import java.awt.Desktop;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;

/**
 * JS Analyzer Burp 확장 진입점(M5). 우클릭 "Analyze JS (this host)" →
 * Burp history/sitemap에서 해당 호스트의 JS를 시드로 모아(D5) 번들 코어(M2/M4)에
 * 제출하고, 폴링 결과 report.html 을 Suite 탭에 렌더한다. 분석 로직은 없다(얇은 래퍼).
 */
public class JsAnalyzerExtension implements BurpExtension {
    private MontoyaApi api;
    private final AnalyzerConfig config = new AnalyzerConfig();
    private final CoreProcess core = new CoreProcess();
    private ConfigPanel panel;

    @Override
    public void initialize(MontoyaApi api) {
        this.api = api;
        api.extension().setName("JS Analyzer Agent");
        this.panel = new ConfigPanel(config);
        api.userInterface().registerSuiteTab("JS Analyzer", panel);
        api.userInterface().registerContextMenuItemsProvider(new MenuProvider());
        api.extension().registerUnloadingHandler(core::stop);
        api.logging().logToOutput("JS Analyzer Agent loaded. Right-click a request → Analyze JS (this host).");
    }

    private class MenuProvider implements ContextMenuItemsProvider {
        @Override
        public List<Component> provideMenuItems(ContextMenuEvent event) {
            String host = hostOf(event);
            if (host == null) return List.of();
            JMenuItem item = new JMenuItem("Analyze JS (this host): " + host);
            item.addActionListener(e -> new Thread(() -> analyze(host)).start());
            return List.of(item);
        }
    }

    private String hostOf(ContextMenuEvent event) {
        List<HttpRequestResponse> sel = event.selectedRequestResponses();
        String url = null;
        if (!sel.isEmpty()) {
            url = sel.get(0).request().url();
        } else if (event.messageEditorRequestResponse().isPresent()) {
            url = event.messageEditorRequestResponse().get().requestResponse().request().url();
        }
        if (url == null) return null;
        try {
            return URI.create(url).getHost();
        } catch (Exception e) {
            return null;
        }
    }

    // Burp sitemap에서 host의 JS 리소스(URL+본문)를 수집한다. 중복은 코어 전처리(M3)가 제거.
    private List<AnalyzerConfig.SeedFile> collectSeeds(String host) {
        List<AnalyzerConfig.SeedFile> seeds = new ArrayList<>();
        for (HttpRequestResponse rr : api.siteMap().requestResponses()) {
            if (rr.response() == null) continue;
            String url = rr.request().url();
            String h;
            try {
                h = URI.create(url).getHost();
            } catch (Exception e) {
                continue;
            }
            if (h == null || !h.equalsIgnoreCase(host)) continue;
            boolean isJs = url.matches("(?i).*\\.m?js(\\?.*)?$") || rr.response().mimeType() == MimeType.SCRIPT;
            if (!isJs) continue;
            String body = rr.response().bodyToString();
            if (body != null && !body.isBlank()) seeds.add(new AnalyzerConfig.SeedFile(url, body));
        }
        return seeds;
    }

    // 분석 제출 → 라이브 결과 페이지를 브라우저에서 연다(M9/D8). Swing 렌더·폴링 없음.
    private void analyze(String host) {
        try {
            List<AnalyzerConfig.SeedFile> seeds = collectSeeds(host);
            String target = "https://" + host + "/";
            panel.setStatus("코어 기동...");
            String base = core.ensureStarted(config.coreEnv());
            CoreClient client = new CoreClient(base);
            panel.setStatus("잡 제출 (" + seeds.size() + " seed JS)...");
            String id = client.submit(config.jobJson(target, seeds));
            String liveUrl = client.liveUrl(id);
            openBrowser(liveUrl);
            panel.setLiveLink("브라우저에서 라이브 결과가 열립니다 (" + seeds.size() + " seed JS)", liveUrl);
        } catch (Exception ex) {
            api.logging().logToError("analyze failed: " + ex);
            panel.setStatus("실패: " + ex.getMessage());
        }
    }

    private void openBrowser(String url) {
        try {
            if (Desktop.isDesktopSupported() && Desktop.getDesktop().isSupported(Desktop.Action.BROWSE)) {
                Desktop.getDesktop().browse(new URI(url));
                return;
            }
        } catch (Exception e) {
            api.logging().logToError("browse failed: " + e);
        }
        api.logging().logToOutput("라이브 결과 URL (수동으로 열기): " + url);
    }
}
