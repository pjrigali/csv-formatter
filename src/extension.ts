import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(CsvEditorProvider.register(context));
}

class CsvEditorProvider implements vscode.CustomReadonlyEditorProvider {

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new CsvEditorProvider(context);
        const providerRegistration = vscode.window.registerCustomEditorProvider(CsvEditorProvider.viewType, provider);
        return providerRegistration;
    }

    private static readonly viewType = 'csvFormatter.preview';

    constructor(
        private readonly context: vscode.ExtensionContext
    ) { }

    async openCustomDocument(
        uri: vscode.Uri,
        openContext: vscode.CustomDocumentOpenContext,
        token: vscode.CancellationToken
    ): Promise<vscode.CustomDocument> {
        return { uri, dispose: () => { } };
    }

    async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true,
        };

        await this.updateWebview(document, webviewPanel.webview);

        // Listen for messages from the webview
        webviewPanel.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'updateConfig':
                    const config = vscode.workspace.getConfiguration('csvQuickTableView');
                    config.update(message.key, message.value, vscode.ConfigurationTarget.Global);
                    return;
            }
        });

        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                this.updateWebview(document, webviewPanel.webview);
            }
        });

        // Listen for configuration changes to update the view immediately
        const changeConfigSubscription = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('csvQuickTableView')) {
                this.updateWebview(document, webviewPanel.webview);
            }
        });

        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
            changeConfigSubscription.dispose();
        });
    }

    private async updateWebview(document: vscode.CustomDocument, webview: vscode.Webview) {
        const content = await vscode.workspace.fs.readFile(document.uri);
        const text = Buffer.from(content).toString('utf8');
        const config = vscode.workspace.getConfiguration('csvQuickTableView');
        webview.html = this.getHtmlForWebview(webview, text, config);
    }

    private getHtmlForWebview(webview: vscode.Webview, text: string, config: vscode.WorkspaceConfiguration): string {
        const rows = this.parseCsv(text);

        // Serialize data for client-side consumption
        const jsonRows = JSON.stringify(rows);

        const headerBg = config.get('headerBackground');
        const headerFg = config.get('headerForeground');
        const gridColor = config.get('gridColor');
        const valueColor = config.get('valueColor');

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <style>
                    :root {
                        --header-bg: ${headerBg};
                        --header-fg: ${headerFg};
                        --grid-color: ${gridColor};
                        --value-color: ${valueColor};
                    }
                    body { font-family: var(--vscode-font-family); padding: 10px; color: var(--vscode-editor-foreground); background-color: var(--vscode-editor-background); margin: 0; }
                    table { border-collapse: collapse; width: 100%; margin-top: 40px; margin-bottom: 50px; }
                    th, td { border: 1px solid var(--grid-color) !important; padding: 8px; text-align: left; color: var(--value-color) !important;}
                    th { background-color: var(--header-bg) !important; color: var(--header-fg) !important; position: sticky; top: 0; z-index: 1; }
                    tr { background-color: transparent !important; }
                    tr:hover { background-color: var(--vscode-list-hoverBackground) !important; }
                    
                    /* Settings UI */
                    #settings-btn {
                        position: fixed; top: 10px; right: 10px; z-index: 1001;
                        background: var(--vscode-button-background); color: var(--vscode-button-foreground);
                        border: none; padding: 6px; cursor: pointer; border-radius: 4px;
                    }
                    #settings-btn:hover { background: var(--vscode-button-hoverBackground); }
                    #settings-panel {
                        display: none; position: fixed; top: 40px; right: 10px; z-index: 1002;
                        background: var(--vscode-editor-background); border: 1px solid var(--vscode-widget-border);
                        padding: 10px; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                    }
                    .setting-item { margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
                    .setting-item label { font-size: 12px; color: var(--vscode-foreground); }
                    input[type="color"] { border: none; width: 20px; height: 20px; cursor: pointer; padding: 0; background: none; }

                    /* Pagination */
                    .pagination { position: fixed; bottom: 0; left: 0; right: 0; background: var(--vscode-editor-background); border-top: 1px solid var(--vscode-widget-border); padding: 8px; display: flex; align-items: center; justify-content: center; gap: 15px; z-index: 1000; box-shadow: 0 -2px 5px rgba(0,0,0,0.1); }
                    .pagination button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 5px 15px; cursor: pointer; border-radius: 2px; font-size: 13px; }
                    .pagination button:disabled { opacity: 0.5; cursor: not-allowed; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
                    .pagination button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
                    .page-info { font-size: 13px; font-family: monospace; }
                </style>
            </head>
            <body>
                <button id="settings-btn" title="Customize Colors">⚙️</button>
                <div id="settings-panel">
                    <div class="setting-item">
                        <label>Header BG</label>
                        <input type="color" id="headerBg" value="${headerBg}">
                    </div>
                    <div class="setting-item">
                        <label>Header Text</label>
                        <input type="color" id="headerFg" value="${headerFg}">
                    </div>
                    <div class="setting-item">
                        <label>Grid Lines</label>
                        <input type="color" id="gridColor" value="${gridColor}">
                    </div>
                    <div class="setting-item">
                        <label>Values</label>
                        <input type="color" id="valueColor" value="${valueColor}">
                    </div>
                </div>

                <div id="table-container"></div>

                <div class="pagination">
                    <button id="prevBtn">Previous</button>
                    <span id="pageInfo" class="page-info">Page 1 of 1</span>
                    <button id="nextBtn">Next</button>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();
                    const csvData = ${jsonRows};
                    const pageSize = 100;
                    let currentPage = 0;
                    const totalPages = Math.ceil((csvData.length - 1) / pageSize); // -1 for header

                    const tableContainer = document.getElementById('table-container');
                    const pageInfo = document.getElementById('pageInfo');
                    const prevBtn = document.getElementById('prevBtn');
                    const nextBtn = document.getElementById('nextBtn');

                    // Header is always the first row
                    const headerRow = csvData[0];

                    function renderTable(page) {
                        if (csvData.length === 0) return;

                        let html = '<table><thead><tr>';
                        // Render Header
                        headerRow.forEach(cell => {
                            html += '<th>' + escapeHtml(cell) + '</th>';
                        });
                        html += '</tr></thead><tbody>';

                        // Calculate slice
                        // Data rows start at index 1
                        const start = 1 + (page * pageSize);
                        const end = Math.min(start + pageSize, csvData.length);

                        for (let i = start; i < end; i++) {
                            html += '<tr>';
                            const row = csvData[i];
                            // Handle cases where row length doesn't match header
                            for (let j = 0; j < headerRow.length; j++) {
                                html += '<td>' + (row[j] ? escapeHtml(row[j]) : '') + '</td>';
                            }
                            html += '</tr>';
                        }
                        html += '</tbody></table>';
                        tableContainer.innerHTML = html;
                        updateControls();
                    }

                    function updateControls() {
                        pageInfo.textContent = 'Page ' + (currentPage + 1) + ' of ' + (totalPages || 1) + ' (' + (csvData.length - 1).toLocaleString() + ' rows)';
                        prevBtn.disabled = currentPage === 0;
                        nextBtn.disabled = currentPage >= totalPages - 1;
                    }

                    function escapeHtml(text) {
                        if (!text) return "";
                        return text
                            .replace(/&/g, "&amp;")
                            .replace(/</g, "&lt;")
                            .replace(/>/g, "&gt;")
                            .replace(/"/g, "&quot;")
                            .replace(/'/g, "&#039;");
                    }

                    prevBtn.addEventListener('click', () => {
                        if (currentPage > 0) {
                            currentPage--;
                            renderTable(currentPage);
                            window.scrollTo(0, 0);
                        }
                    });

                    nextBtn.addEventListener('click', () => {
                        if (currentPage < totalPages - 1) {
                            currentPage++;
                            renderTable(currentPage);
                            window.scrollTo(0, 0);
                        }
                    });

                    // Settings Logic
                    const settingsBtn = document.getElementById('settings-btn');
                    const settingsPanel = document.getElementById('settings-panel');
                    
                    settingsBtn.addEventListener('click', () => {
                        settingsPanel.style.display = settingsPanel.style.display === 'block' ? 'none' : 'block';
                    });

                    function updateConfig(key, value) {
                        vscode.postMessage({ command: 'updateConfig', key: key, value: value });
                    }

                    document.getElementById('headerBg').addEventListener('input', (e) => {
                        document.documentElement.style.setProperty('--header-bg', e.target.value);
                        updateConfig('headerBackground', e.target.value);
                    });
                    document.getElementById('headerFg').addEventListener('input', (e) => {
                        document.documentElement.style.setProperty('--header-fg', e.target.value);
                        updateConfig('headerForeground', e.target.value);
                    });
                     document.getElementById('gridColor').addEventListener('input', (e) => {
                        document.documentElement.style.setProperty('--grid-color', e.target.value);
                        updateConfig('gridColor', e.target.value);
                    });
                     document.getElementById('valueColor').addEventListener('input', (e) => {
                        document.documentElement.style.setProperty('--value-color', e.target.value);
                        updateConfig('valueColor', e.target.value);
                    });

                    // Initial Render
                    renderTable(currentPage);
                </script>
            </body>
            </html>
        `;
    }

    private parseCsv(text: string): string[][] {
        // Simple CSV parser: handles quoted fields
        const rows: string[][] = [];
        let currentRow: string[] = [];
        let currentField = '';
        let insideQuotes = false;

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const nextChar = text[i + 1];

            if (char === '"') {
                if (insideQuotes && nextChar === '"') {
                    currentField += '"';
                    i++; // Skip the escaped quote
                } else {
                    insideQuotes = !insideQuotes;
                }
            } else if (char === ',' && !insideQuotes) {
                currentRow.push(currentField);
                currentField = '';
            } else if ((char === '\r' && nextChar === '\n') || char === '\n') {
                if (!insideQuotes) {
                    currentRow.push(currentField);
                    rows.push(currentRow);
                    currentRow = [];
                    currentField = '';
                    if (char === '\r') i++; // Skip \n
                } else {
                    currentField += char;
                }
            } else {
                currentField += char;
            }
        }

        if (currentField || currentRow.length > 0) {
            currentRow.push(currentField);
            rows.push(currentRow);
        }

        return rows;
    }


}
