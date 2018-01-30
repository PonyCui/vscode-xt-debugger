/*---------------------------------------------------------
 * Copyright (C) XT Studio. All rights reserved.
 *--------------------------------------------------------*/
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const vscode = require("vscode");
function activate(context) {
    context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('xt', new XTDebuggerConfigurationProvider()));
}
exports.activate = activate;
function deactivate() {
    // nothing to do
}
exports.deactivate = deactivate;
class XTDebuggerConfigurationProvider {
    resolveDebugConfiguration(folder, config, token) {
        if (!config.program) {
            return vscode.window.showInformationMessage("Cannot find a program to debug").then(_ => {
                return undefined; // abort launch
            });
        }
        return config;
    }
}
//# sourceMappingURL=extension.js.map