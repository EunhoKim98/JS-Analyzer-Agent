package com.jsanalyzer;

import javax.swing.*;
import java.awt.*;

/**
 * Suite 탭 UI(M5) — provider 선택(SDK/Claude Code/Codex)과 SDK URL·토큰 입력,
 * 그리고 결과 report.html 렌더 영역. SDK 선택 시에만 URL/토큰 필드가 활성화된다.
 */
public class ConfigPanel extends JPanel {
    private final AnalyzerConfig config;
    private final JComboBox<String> providerBox = new JComboBox<>(new String[]{"sdk", "claude-cli", "codex"});
    private final JTextField urlField = new JTextField(30);
    private final JPasswordField tokenField = new JPasswordField(30);
    private final JEditorPane resultPane = new JEditorPane("text/html", "<i>결과가 여기에 표시됩니다.</i>");
    private final JLabel status = new JLabel("대기 중");

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
        c.gridx = 0; c.gridy = 3; c.gridwidth = 2; top.add(status, c);

        providerBox.addActionListener(e -> syncFromUi());
        urlField.getDocument().addUndoableEditListener(e -> syncFromUi());
        tokenField.getDocument().addUndoableEditListener(e -> syncFromUi());
        updateEnabled();

        resultPane.setEditable(false);
        add(top, BorderLayout.NORTH);
        add(new JScrollPane(resultPane), BorderLayout.CENTER);
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
        SwingUtilities.invokeLater(() -> status.setText(text));
    }

    public void showReport(String html) {
        SwingUtilities.invokeLater(() -> {
            resultPane.setText(html);
            resultPane.setCaretPosition(0);
        });
    }
}
