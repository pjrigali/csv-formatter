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

        // Listen for changes to the file
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                this.updateWebview(document, webviewPanel.webview);
            }
        });

        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });
    }

    private async updateWebview(document: vscode.CustomDocument, webview: vscode.Webview) {
        const content = await vscode.workspace.fs.readFile(document.uri);
        const text = Buffer.from(content).toString('utf8');
        webview.html = this.getHtmlForWebview(webview, text);
    }

    private getHtmlForWebview(webview: vscode.Webview, text: string): string {
        const rows = this.parseCsv(text);
        const tableHtml = this.generateTableHtml(rows);

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <style>
                    body { font-family: var(--vscode-font-family); padding: 10px; color: var(--vscode-editor-foreground); background-color: var(--vscode-editor-background); }
                    table { border-collapse: collapse; width: 100%; }
                    th, td { border: 1px solid #444 !important; padding: 8px; text-align: left; }
                    th { background-color: #333 !important; color: #fff !important; }
                    tr { background-color: transparent !important; }
                    tr:hover { background-color: var(--vscode-list-hoverBackground) !important; }
                </style>
            </head>
            <body>
                ${tableHtml}
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

    private generateTableHtml(rows: string[][]): string {
        if (rows.length === 0) {
            return '<p>No data</p>';
        }

        let html = '<table>';

        // Header
        // Assuming first row is header for now, or just treat all as data?
        // Let's assume first row is header if it exists.
        if (rows.length > 0) {
            html += '<thead><tr>';
            for (const cell of rows[0]) {
                html += `<th>${this.escapeHtml(cell)}</th>`;
            }
            html += '</tr></thead>';
        }

        // Body
        html += '<tbody>';
        for (let i = 1; i < rows.length; i++) {
            html += '<tr>';
            for (const cell of rows[i]) {
                html += `<td>${this.escapeHtml(cell)}</td>`;
            }
            html += '</tr>';
        }
        html += '</tbody></table>';
        return html;
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
}
