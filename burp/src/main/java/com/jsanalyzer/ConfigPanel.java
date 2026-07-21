package com.jsanalyzer;

import javax.swing.*;
import java.awt.*;
import java.awt.Desktop;
import java.net.URI;

/**
 * Suite 탭 UI(M5·M9) — provider 선택(SDK/Claude Code/Codex)과 SDK URL·토큰 입력, 상태 표시,
 * 그리고 라이브 결과 링크. 결과 렌더는 브라우저(라이브 웹 UI)가 담당하므로 Swing 렌더는 없다(D8).
 */
public class ConfigPanel extends JPanel {
    private final AnalyzerConfig config;
    private final JComboBox<String> providerBox = new JComboBox<>(new String[]{"sdk", "claude-cli", "codex"});
    private final JTextField urlField = new JTextField(30);
    private final JPasswordField tokenField = new JPasswordField(30);
    private final JLabel status = new JLabel("대기 중");
    private final JButton liveLink = new JButton("라이브 결과 열기");
    private String liveUrl;

    public ConfigPanel(AnalyzerConfig config) {
        super(new BorderLayout(8, 8));
        this.config = config;

        JPanel top = new JPanel(new GridBagLayout());
        GridBagConstraints c = new GridBagConstraints();
        c.insets = new Insets(4, 6, 4, 6);
        c.anchor = GridBagConstraints.WEST;

        c.gridx = 0; c.gridy = 0; top.add(new JLabel("LLM provider:"), c);
        c.gridx = 1; top.add(providerBox, c);
        c.gridx = 0; c.gridy = 1; top.add(new JLabel("SDK base URL:"), c);
        c.gridx = 1; top.add(urlField, c);
        c.gridx = 0; c.gridy = 2; top.add(new JLabel("SDK token:"), c);
        c.gridx = 1; top.add(tokenField, c);
        c.gridx = 0; c.gridy = 3; top.add(new JLabel("상태:"), c);
        c.gridx = 1; top.add(status, c);
        c.gridx = 1; c.gridy = 4; top.add(liveLink, c);

        liveLink.setVisible(false);
        liveLink.addActionListener(e -> openLive());
        providerBox.addActionListener(e -> syncFromUi());
        urlField.getDocument().addUndoableEditListener(e -> syncFromUi());
        tokenField.getDocument().addUndoableEditListener(e -> syncFromUi());
        updateEnabled();

        add(top, BorderLayout.NORTH);
        JTextArea help = new JTextArea(
                "우클릭 → \"Analyze JS (this host)\" 하면 Burp history에서 그 호스트의 JS를 시드로 모아\n"
              + "번들 코어에 제출하고, 결과가 브라우저 라이브 페이지에 실시간으로 흘러내립니다.");
        help.setEditable(false);
        help.setOpaque(false);
        help.setBorder(BorderFactory.createEmptyBorder(8, 8, 8, 8));
        add(help, BorderLayout.CENTER);
    }

    private void syncFromUi() {
        config.provider = (String) providerBox.getSelectedItem();
        config.sdkUrl = urlField.getText();
        config.sdkToken = new String(tokenField.getPassword());
        updateEnabled();
    }

    private void updateEnabled() {
        boolean sdk = "sdk".equals(providerBox.getSelectedItem());
        urlField.setEnabled(sdk);
        tokenField.setEnabled(sdk);
    }

    public void setStatus(String text) {
        SwingUtilities.invokeLater(() -> {
            status.setText(text);
            liveLink.setVisible(false);
        });
    }

    public void setLiveLink(String text, String url) {
        SwingUtilities.invokeLater(() -> {
            status.setText(text);
            this.liveUrl = url;
            liveLink.setVisible(true);
        });
    }

    private void openLive() {
        if (liveUrl == null) return;
        try {
            if (Desktop.isDesktopSupported()) Desktop.getDesktop().browse(new URI(liveUrl));
        } catch (Exception ignored) {
            // best-effort; URL is also logged by the extension
        }
    }
}
