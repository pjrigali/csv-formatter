import * as vscode from 'vscode';
import * as XLSX from 'xlsx';

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

        let debounceTimeout: NodeJS.Timeout | undefined;
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                if (debounceTimeout) {
                    clearTimeout(debounceTimeout);
                }
                debounceTimeout = setTimeout(() => {
                    this.updateWebview(document, webviewPanel.webview);
                }, 300);
            }
        });

        // Listen for configuration changes to update the view immediately
        const changeConfigSubscription = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('csvQuickTableView')) {
                const config = vscode.workspace.getConfiguration('csvQuickTableView');
                webviewPanel.webview.postMessage({
                    command: 'updateConfig',
                    config: {
                        headerBackground: config.get('headerBackground'),
                        headerForeground: config.get('headerForeground'),
                        gridColor: config.get('gridColor'),
                        valueColor: config.get('valueColor'),
                        rowsPerPage: config.get('rowsPerPage', 1000)
                    }
                });
            }
        });

        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
            changeConfigSubscription.dispose();
            if (debounceTimeout) {
                clearTimeout(debounceTimeout);
            }
        });
    }

    private async updateWebview(document: vscode.CustomDocument, webview: vscode.Webview) {
        const content = await vscode.workspace.fs.readFile(document.uri);
        const config = vscode.workspace.getConfiguration('csvQuickTableView');

        if (document.uri.fsPath.endsWith('.xlsx')) {
            webview.html = this.getHtmlForWebview(webview, '', config, true, content);
        } else {
            const text = Buffer.from(content).toString('utf8');
            webview.html = this.getHtmlForWebview(webview, text, config, false);
        }
    }

    private getHtmlForWebview(webview: vscode.Webview, text: string, config: vscode.WorkspaceConfiguration, isBinary: boolean = false, contentBuffer?: Uint8Array): string {
        let rows: string[][] = [];

        if (isBinary && contentBuffer) {
            try {
                const workbook = XLSX.read(contentBuffer, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];
                // Use header: 1 to get a 2D array of arrays
                const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

                // Convert all values to strings for consistent rendering
                rows = rawRows.map(row => row.map(cell => (cell === null || cell === undefined) ? '' : String(cell)));
            } catch (error) {
                console.error('Error parsing XLSX:', error);
                rows = [['Error parsing file']];
            }
        } else {
            rows = this.parseCsv(text);
        }

        // Serialize data for client-side consumption
        const jsonRows = JSON.stringify(rows);


        const headerBg = config.get('headerBackground');
        const headerFg = config.get('headerForeground');
        const gridColor = config.get('gridColor');
        const valueColor = config.get('valueColor');
        const rowsPerPage = config.get('rowsPerPage', 1000);

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
                        <input type="color" id="headerBg">
                    </div>
                    <div class="setting-item">
                        <label>Header Text</label>
                        <input type="color" id="headerFg">
                    </div>
                    <div class="setting-item">
                        <label>Grid Lines</label>
                        <input type="color" id="gridColor">
                    </div>
                    <div class="setting-item">
                        <label>Values</label>
                        <input type="color" id="valueColor">
                    </div>
                    <div class="setting-item">
                        <label>Rows/Page</label>
                        <input type="number" id="rowsPerPage" min="1" max="10000" style="width: 50px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);">
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
                    let pageSize = ${rowsPerPage};
                    let currentPage = 0;
                    let totalPages = csvData.length <= 1 ? 1 : Math.ceil((csvData.length - 1) / pageSize);

                    const tableContainer = document.getElementById('table-container');
                    const pageInfo = document.getElementById('pageInfo');
                    const prevBtn = document.getElementById('prevBtn');
                    const nextBtn = document.getElementById('nextBtn');
                    const rowsPerPageInput = document.getElementById('rowsPerPage');

                    // Header is always the first row (if data exists)
                    const headerRow = csvData.length > 0 ? csvData[0] : [];

                    function renderTable(page) {
                        if (csvData.length === 0) {
                            tableContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--vscode-disabledForeground);">No data to display</div>';
                            updateControls();
                            return;
                        }

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

                    // Update controls
                    function updateControls() {
                        const rowCount = csvData.length > 0 ? csvData.length - 1 : 0;
                        pageInfo.textContent = 'Page ' + (currentPage + 1) + ' of ' + (totalPages || 1) + ' (' + rowCount.toLocaleString() + ' rows)';
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

                    // Separation of input (live visual update) and change (persist to config)
                    function setupColorPicker(id, cssVar, configKey) {
                        const el = document.getElementById(id);
                        if (!el) return;
                        el.addEventListener('input', (e) => {
                            document.documentElement.style.setProperty(cssVar, e.target.value);
                        });
                        el.addEventListener('change', (e) => {
                            updateConfig(configKey, e.target.value);
                        });
                    }

                    setupColorPicker('headerBg', '--header-bg', 'headerBackground');
                    setupColorPicker('headerFg', '--header-fg', 'headerForeground');
                    setupColorPicker('gridColor', '--grid-color', 'gridColor');
                    setupColorPicker('valueColor', '--value-color', 'valueColor');

                    if (rowsPerPageInput) {
                        rowsPerPageInput.value = pageSize;
                        rowsPerPageInput.addEventListener('change', (e) => {
                            const val = parseInt(e.target.value);
                            if (val > 0) {
                                pageSize = val;
                                currentPage = 0; // Reset to first page
                                totalPages = csvData.length <= 1 ? 1 : Math.ceil((csvData.length - 1) / pageSize);
                                updateConfig('rowsPerPage', val);
                                renderTable(currentPage);
                            }
                        });
                    }

                    // Helper to resolve CSS properties / color names to hex
                    function resolveColorToHex(colorStr) {
                        if (!colorStr) return '#000000';
                        colorStr = colorStr.trim();
                        if (/^#[0-9A-F]{6}$/i.test(colorStr)) return colorStr;
                        if (/^#[0-9A-F]{3}$/i.test(colorStr)) {
                            return '#' + colorStr[1] + colorStr[1] + colorStr[2] + colorStr[2] + colorStr[3] + colorStr[3];
                        }
                        
                        const temp = document.createElement('div');
                        temp.style.color = colorStr;
                        document.body.appendChild(temp);
                        const computedColor = window.getComputedStyle(temp).color;
                        document.body.removeChild(temp);

                        const match = computedColor.match(/\d+/g);
                        if (match && match.length >= 3) {
                            const r = parseInt(match[0]);
                            const g = parseInt(match[1]);
                            const b = parseInt(match[2]);
                            return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
                        }
                        return '#000000';
                    }

                    function initColorPickers() {
                        const colors = {
                            headerBg: '${headerBg}',
                            headerFg: '${headerFg}',
                            gridColor: '${gridColor}',
                            valueColor: '${valueColor}'
                        };
                        for (const [id, val] of Object.entries(colors)) {
                            const input = document.getElementById(id);
                            if (input) {
                                input.value = resolveColorToHex(val);
                            }
                        }
                    }

                    // Listen for message from extension host to update configuration dynamically
                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.command) {
                            case 'updateConfig':
                                const config = message.config;
                                document.documentElement.style.setProperty('--header-bg', config.headerBackground);
                                document.documentElement.style.setProperty('--header-fg', config.headerForeground);
                                document.documentElement.style.setProperty('--grid-color', config.gridColor);
                                document.documentElement.style.setProperty('--value-color', config.valueColor);

                                if (document.getElementById('headerBg')) document.getElementById('headerBg').value = resolveColorToHex(config.headerBackground);
                                if (document.getElementById('headerFg')) document.getElementById('headerFg').value = resolveColorToHex(config.headerForeground);
                                if (document.getElementById('gridColor')) document.getElementById('gridColor').value = resolveColorToHex(config.gridColor);
                                if (document.getElementById('valueColor')) document.getElementById('valueColor').value = resolveColorToHex(config.valueColor);

                                if (config.rowsPerPage !== pageSize) {
                                    pageSize = config.rowsPerPage;
                                    currentPage = 0;
                                    totalPages = csvData.length <= 1 ? 1 : Math.ceil((csvData.length - 1) / pageSize);
                                    if (rowsPerPageInput) rowsPerPageInput.value = pageSize;
                                    renderTable(currentPage);
                                }
                                break;
                        }
                    });

                    // Initial Render & Setup
                    initColorPickers();
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
